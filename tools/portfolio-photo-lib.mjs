import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPortfolioItems,
  buildPortfolioThemes,
  emptyPortfolioAdditions,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import {
  buildStyleLibrary,
  normalizeStyleCatalog,
  styleSlotId,
} from "../apps/portfolio-v2/style-library.js";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const sourcePhotoRoot = join(root, "apps/portfolio/assets/photos");
export const sourceAdditionsPath = join(root, "apps/portfolio-v2/catalog-additions.json");
export const sourceStyleCatalogPath = join(root, "apps/portfolio-v2/style-catalog.json");
export const sourceStyleAssignmentsPath = join(root, "apps/portfolio-v2/style-slot-assignments.json");
export const styleTransactionRoot = join(root, ".local/portfolio-style-transactions");
export const backupRoot = join(root, ".local/portfolio-photo-backups");
export const transactionRoot = join(root, ".local/portfolio-photo-transactions");
// 这是对外唯一入口。内部项目目录以后可以升级，客户链接始终保持 /p/。
export const onlinePortfolioUrl = "https://wdmm630202.github.io/nbo-smart-system/p/";

const binaryCandidates = {
  ffmpeg: [
    "/Users/nanbosheyingimacpro/.local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ],
  ffprobe: [
    "/Users/nanbosheyingimacpro/.local/bin/ffprobe",
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
  ],
};
const allowedIncomingPhotoCodecs = new Set(["mjpeg", "jpeg", "png", "webp"]);

export function slotCode(id) {
  return `NB-${String(id).padStart(3, "0")}`;
}

export function assertPublicAssetCode(code) {
  const match = typeof code === "string" ? code.match(/^NB-(\d{3,})$/) : null;
  const numericId = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(numericId) || numericId < 1 || slotCode(numericId) !== code) {
    throw new Error("公开资产编号必须是 NB-001 或更大的规范编号");
  }
  return numericId;
}

export function slotFilename(id) {
  return `photo-${String(id).padStart(3, "0")}`;
}

function photoOperationalError(code, message, status = 400) {
  const error = new Error(message);
  error.apiCode = code;
  error.status = status;
  return error;
}

export function assertPhotoId(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1 || numericId > portfolioCatalog.photoCount) {
    throw photoOperationalError("INVALID_PHOTO_ID", "客片编号无效");
  }
  return numericId;
}

function assetPathsAt(id, photoRootPath) {
  const numericId = assertPhotoId(id);
  const base = slotFilename(numericId);
  return {
    full: join(photoRootPath, "full", `${base}.jpg`),
    thumb: join(photoRootPath, "thumbs", `${base}.webp`),
    featured: portfolioCatalog.heroAssetIds.includes(numericId)
      ? join(photoRootPath, "featured", `${base}.webp`)
      : null,
  };
}

export function assetPaths(id) {
  return assetPathsAt(id, sourcePhotoRoot);
}

function photoStoreOptions(options = {}) {
  const localStateRoot = options.localStateRoot || join(root, ".local");
  return {
    photoRoot: options.photoRoot || sourcePhotoRoot,
    backupRoot: options.backupRoot || join(localStateRoot, "portfolio-photo-backups"),
    transactionRoot: options.transactionRoot || join(localStateRoot, "portfolio-photo-transactions"),
    faults: options.faults || {},
  };
}

function requirePhotoOperationId(operationId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(operationId || ""))) {
    throw new Error("操作编号无效");
  }
  return String(operationId).toLowerCase();
}

function photoOperationFingerprint(label, parts) {
  return createHash("sha256").update(JSON.stringify([label, ...parts])).digest("hex");
}

async function fileDigest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function assetStateFingerprint(paths) {
  const entries = [];
  for (const [key, path] of Object.entries(paths)) {
    if (path) entries.push([key, await fileDigest(path)]);
  }
  return photoOperationFingerprint("photo-asset-state", entries);
}

async function isExecutable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBinary(name) {
  for (const candidate of binaryCandidates[name] || []) {
    if (await isExecutable(candidate)) return candidate;
  }
  return name;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({
          code,
          stdout: options.preserveWhitespace ? stdout.replace(/(?:\r?\n)+$/, "") : stdout.trim(),
          stderr: stderr.trim(),
        });
        return;
      }
      const detail = stderr.trim().split("\n").slice(-8).join("\n") || stdout.trim();
      reject(new Error(detail || `${command} 执行失败（${code}）`));
    });
  });
}

export async function probeImage(path) {
  const ffprobe = await resolveBinary("ffprobe");
  const result = await run(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height:stream_tags=rotate:stream_side_data=rotation",
    "-of", "json",
    path,
  ]);
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("无法读取这张图片的尺寸");
  const rotation = Number(stream.tags?.rotate || stream.side_data_list?.[0]?.rotation || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    codec: String(stream.codec_name || "").toLowerCase(),
    width: rotated ? stream.height : stream.width,
    height: rotated ? stream.width : stream.height,
    rotation,
  };
}

export function validateIncomingImage({ width, height }) {
  const ratio = width / height;
  if (width < 900 || height < 1200) {
    throw photoOperationalError("INVALID_IMAGE_DIMENSIONS", "图片至少需要 900×1200 像素");
  }
  if (Math.abs(ratio - 0.75) > 0.02) {
    throw photoOperationalError("INVALID_IMAGE_RATIO", "图片必须裁成 3:4，系统不会自动裁掉人物");
  }
  return { width, height };
}

async function renderAsset(ffmpeg, input, output, width, height, type) {
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  const codecArgs = type === "jpg"
    ? ["-q:v", "2", "-pix_fmt", "yuvj420p"]
    : ["-c:v", "libwebp", "-quality", type === "featured" ? "88" : "82", "-compression_level", "6", "-pix_fmt", "yuv420p"];
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-map_metadata", "-1",
    "-vf", filter,
    "-frames:v", "1",
    ...codecArgs,
    output,
  ]);
}

export async function renderPhotoDerivatives(inputPath, { full, thumb }) {
  const ffmpeg = await resolveBinary("ffmpeg");
  await renderAsset(ffmpeg, inputPath, full, 1080, 1440, "jpg");
  await renderAsset(ffmpeg, inputPath, thumb, 480, 640, "webp");
}

async function copyExistingAssets(paths, destination) {
  await mkdir(destination, { recursive: true });
  await copyFile(paths.full, join(destination, "full.jpg"));
  await copyFile(paths.thumb, join(destination, "thumb.webp"));
  if (paths.featured) await copyFile(paths.featured, join(destination, "featured.webp"));
}

function timestampName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assetFileName(key) {
  return key === "full" ? "full.jpg" : `${key}.webp`;
}

async function installAssetDirectory(directory, targets) {
  for (const [key, target] of Object.entries(targets)) {
    if (!target) continue;
    await rename(join(directory, assetFileName(key)), target);
  }
}

async function restoreTransaction(transactionDir, targets) {
  const restoreDir = join(transactionDir, "restore");
  await rm(restoreDir, { recursive: true, force: true });
  await copyExistingAssets({
    full: join(transactionDir, "before/full.jpg"),
    thumb: join(transactionDir, "before/thumb.webp"),
    featured: targets.featured ? join(transactionDir, "before/featured.webp") : null,
  }, restoreDir);
  await installAssetDirectory(restoreDir, targets);
}

const photoTransactionStatuses = new Set(["preparing", "prepared", "committing", "recovering", "committed"]);
const photoTransactionOperations = new Set(["replace", "undo"]);

function isPathInside(base, target) {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${sep}`);
}

function requirePhotoHistoryBackupId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("客片事务备份标识无效");
  }
  return value;
}

function assertPhotoTransactionDirectoryName(name, id) {
  const pattern = new RegExp(`^${slotFilename(id)}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-[0-9a-f]{10}$`);
  if (typeof name !== "string" || !pattern.test(name)) {
    throw new Error("客片事务目录与照片位不匹配");
  }
}

function validatePhotoTransactionMeta(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("客片事务记录格式无效");
  }
  const allowed = new Set(["schemaVersion", "id", "operation", "status", "historyBackupId", "historyMetaPath", "createdAt"]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`客片事务记录不允许字段 ${unknown}`);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new Error("客片事务记录版本无效");
  }
  const id = assertPhotoId(value.id);
  if (!photoTransactionOperations.has(value.operation) || !photoTransactionStatuses.has(value.status)) {
    throw new Error("客片事务记录操作或状态无效");
  }
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("客片事务记录时间无效");
  }
  if (value.historyBackupId !== undefined && value.historyMetaPath !== undefined) {
    throw new Error("客片事务记录不能同时保存备份标识和路径");
  }
  if (value.historyBackupId !== undefined) requirePhotoHistoryBackupId(value.historyBackupId);
  if (value.historyMetaPath !== undefined && typeof value.historyMetaPath !== "string") {
    throw new Error("客片事务旧备份路径无效");
  }
  return { ...value, id };
}

async function assertExistingPhotoPathInside(rootPath, path, label, kind = "file") {
  const resolvedRoot = resolve(rootPath);
  const resolvedPath = resolve(path);
  if (!isPathInside(resolvedRoot, resolvedPath)) throw new Error(`${label}越出客片本地目录`);
  const segments = relative(resolvedRoot, resolvedPath).split(sep).filter(Boolean);
  let cursor = resolvedRoot;
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) cursor = join(cursor, segments[index]);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`${label}不能是符号链接`);
    if (index < segments.length - 1 && !info.isDirectory()) throw new Error(`${label}父目录无效`);
    if (index === segments.length - 1 && kind === "file" && !info.isFile()) throw new Error(`${label}必须是普通文件`);
    if (index === segments.length - 1 && kind === "directory" && !info.isDirectory()) throw new Error(`${label}必须是目录`);
  }
  const [canonicalRoot, canonicalPath] = await Promise.all([realpath(resolvedRoot), realpath(resolvedPath)]);
  if (!isPathInside(canonicalRoot, canonicalPath)) throw new Error(`${label}通过符号链接越界`);
  return canonicalPath;
}

async function photoHistoryMetaPath(meta, configured) {
  if (meta.historyBackupId === undefined && !meta.historyMetaPath) return "";
  const slotRoot = join(configured.backupRoot, slotFilename(meta.id));
  let backupId = meta.historyBackupId;
  if (backupId === undefined) {
    if (meta.historyMetaPath.split(/[\\/]+/).includes("..")) {
      throw new Error("客片事务旧备份路径不能包含上级目录");
    }
    const legacyPath = resolve(meta.historyMetaPath);
    if (basename(legacyPath) !== "meta.json" || resolve(dirname(dirname(legacyPath))) !== resolve(slotRoot)) {
      throw new Error("客片事务旧备份路径与照片位不匹配");
    }
    backupId = basename(dirname(legacyPath));
  }
  const expectedPath = join(slotRoot, requirePhotoHistoryBackupId(backupId), "meta.json");
  await assertExistingPhotoPathInside(configured.backupRoot, expectedPath, "客片事务备份记录");
  return expectedPath;
}

async function updateHistoryAfterTransaction(meta, completed, configured) {
  const historyMetaPath = await photoHistoryMetaPath(meta, configured);
  if (!historyMetaPath) return true;
  let history;
  try {
    history = await readJson(historyMetaPath);
  } catch {
    return false;
  }
  if (!history || Array.isArray(history) || history.id !== meta.id) {
    throw new Error("客片事务备份记录与照片位不匹配");
  }
  if (meta.operation === "replace") {
    history.status = completed ? "available" : "failed";
  } else if (meta.operation === "undo" && completed) {
    history.status = "restored";
    history.restoredAt = history.restoredAt || new Date().toISOString();
  }
  try {
    await (completed ? configured.faults.beforeCommitHistoryWrite : configured.faults.beforeRollbackHistoryWrite)?.({
      id: meta.id,
      operation: meta.operation,
    });
    await assertExistingPhotoPathInside(configured.backupRoot, historyMetaPath, "客片事务备份记录");
    await writeJson(historyMetaPath, history);
    return true;
  } catch {
    return false;
  }
}

async function persistTransactionStatus(metaPath, meta, status) {
  const next = { ...meta, status };
  await writeJson(metaPath, next);
  Object.assign(meta, next);
}

async function runAssetTransaction(id, desired, operation, historyBackupId = "", options = {}) {
  const numericId = assertPhotoId(id);
  const configured = photoStoreOptions(options);
  const token = randomBytes(5).toString("hex");
  const transactionDir = join(configured.transactionRoot, `${slotFilename(numericId)}-${timestampName()}-${token}`);
  const metaPath = join(transactionDir, "transaction.json");
  const targets = assetPathsAt(numericId, configured.photoRoot);
  const meta = {
    schemaVersion: 1,
    id: numericId,
    operation,
    status: "preparing",
    createdAt: new Date().toISOString(),
    ...(historyBackupId ? { historyBackupId: requirePhotoHistoryBackupId(historyBackupId) } : {}),
  };
  await mkdir(transactionDir, { recursive: true });

  try {
    await copyExistingAssets(targets, join(transactionDir, "before"));
    await copyExistingAssets(desired, join(transactionDir, "next"));
    await persistTransactionStatus(metaPath, meta, "prepared");
    await persistTransactionStatus(metaPath, meta, "committing");
    await configured.faults.beforeAssetInstall?.({ id: numericId, operation });
    await installAssetDirectory(join(transactionDir, "next"), targets);
    await persistTransactionStatus(metaPath, meta, "committed");
  } catch (error) {
    if (meta.status === "committing") {
      try {
        await persistTransactionStatus(metaPath, meta, "recovering");
        await restoreTransaction(transactionDir, targets);
      } catch {
        throw new Error(`${error.message}；自动恢复未完成，请立即交给 Codex 处理 ${transactionDir}`);
      }
    }
    const historyUpdated = await updateHistoryAfterTransaction(meta, false, configured);
    if (historyUpdated) await rm(transactionDir, { recursive: true, force: true });
    throw error;
  }

  // 资产已完整安装且 committed 标记已落盘。之后的记账或清理失败不应
  // 把已成功的换图误报为失败；保留事务目录，下次启动会再完成记账。
  const historyUpdated = await updateHistoryAfterTransaction(meta, true, configured);
  if (historyUpdated) {
    await configured.faults.afterAssetHistoryCommit?.({ id: numericId, operation });
    await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
  }
  return { committed: true, reconciliationPending: !historyUpdated };
}

export async function recoverIncompletePhotoTransactions(options = {}) {
  const configured = photoStoreOptions(options);
  let entries = [];
  try {
    await assertExistingPhotoPathInside(configured.transactionRoot, configured.transactionRoot, "客片事务目录", "directory");
    entries = (await readdir(configured.transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return [];
  }
  const recovered = [];
  for (const entry of entries) {
    const transactionDir = join(configured.transactionRoot, entry.name);
    const metaPath = join(transactionDir, "transaction.json");
    let rawMeta;
    try {
      await assertExistingPhotoPathInside(configured.transactionRoot, transactionDir, "客片事务记录目录", "directory");
      await assertExistingPhotoPathInside(configured.transactionRoot, metaPath, "客片事务记录");
      rawMeta = await readFile(metaPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        // 事务标记在任何目标文件更改之前写入，没有标记说明还在准备阶段。
        await rm(transactionDir, { recursive: true, force: true });
        continue;
      }
      throw error;
    }
    let meta;
    try {
      meta = validatePhotoTransactionMeta(JSON.parse(rawMeta));
      assertPhotoTransactionDirectoryName(entry.name, meta.id);
    } catch (error) {
      if (error?.message?.includes("越界") || error?.message?.includes("符号链接")) throw error;
      throw new Error(`客片事务记录损坏，已停止管理台以保护图片：${transactionDir}`);
    }
    if (meta.status === "committing" || meta.status === "recovering") {
      await persistTransactionStatus(metaPath, meta, "recovering");
      await restoreTransaction(transactionDir, assetPathsAt(meta.id, configured.photoRoot));
      const historyUpdated = await updateHistoryAfterTransaction(meta, false, configured);
      if (!historyUpdated) {
        throw new Error(`已恢复 ${slotCode(meta.id)}，但本地备份记录尚未完成；请交给 Codex 处理：${transactionDir}`);
      }
      recovered.push(slotCode(meta.id));
    } else if (meta.status === "committed") {
      const historyUpdated = await updateHistoryAfterTransaction(meta, true, configured);
      if (!historyUpdated) {
        throw new Error(`已安装 ${slotCode(meta.id)}，但本地备份记录尚未完成；请交给 Codex 处理：${transactionDir}`);
      }
    } else if (["preparing", "prepared"].includes(meta.status)) {
      const historyUpdated = await updateHistoryAfterTransaction(meta, false, configured);
      if (!historyUpdated) {
        throw new Error(`未提交 ${slotCode(meta.id)}，但本地备份记录尚未完成；请交给 Codex 处理：${transactionDir}`);
      }
    } else {
      throw new Error(`客片事务状态无法识别，已停止管理台：${transactionDir}`);
    }
    await rm(transactionDir, { recursive: true, force: true });
  }
  return recovered;
}

async function findPhotoOperations(configured, operationId) {
  let slots = [];
  try {
    slots = (await readdir(configured.backupRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const matches = [];
  for (const slot of slots) {
    const slotRoot = join(configured.backupRoot, slot.name);
    let entries = [];
    try {
      entries = (await readdir(slotRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".pending-"));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const metaPath = join(slotRoot, entry.name, "meta.json");
      let meta;
      try {
        meta = await readJson(metaPath);
      } catch {
        continue;
      }
      for (const type of ["replace", "undo"]) {
        const record = meta[`${type}Operation`];
        if (record?.operationId === operationId) {
          matches.push({ directory: join(slotRoot, entry.name), meta, metaPath, record, type });
        }
      }
    }
  }
  return matches;
}

function rejectPhotoOperationMismatch() {
  throw new Error("操作编号与重试内容或当前客片状态不一致");
}

export async function replacePhoto(id, inputPath, originalName = "", options = {}) {
  const numericId = assertPhotoId(id);
  const configured = photoStoreOptions(options);
  const operationId = options.operationId ? requirePhotoOperationId(options.operationId) : "";
  const targets = assetPathsAt(numericId, configured.photoRoot);
  let requestFingerprint = "";
  if (operationId) {
    requestFingerprint = photoOperationFingerprint("replace-photo-request", [numericId, originalName, await fileDigest(inputPath)]);
    const existing = await findPhotoOperations(configured, operationId);
    if (existing.length) {
      if (existing.some((match) => match.type !== "replace"
        || match.meta.id !== numericId
        || match.record.requestFingerprint !== requestFingerprint)) rejectPhotoOperationMismatch();
      const currentStateFingerprint = await assetStateFingerprint(targets);
      const committed = existing.find((match) => match.meta.status === "available"
        && match.record.resultStateFingerprint === currentStateFingerprint
        && match.record.result);
      if (committed) return committed.record.result;
      const allRolledBack = existing.every((match) => match.meta.status === "failed"
        && match.record.expectedStateFingerprint === currentStateFingerprint);
      if (!allRolledBack) rejectPhotoOperationMismatch();
    }
  }
  let sourceInfo;
  try {
    sourceInfo = await probeImage(inputPath);
    if (!allowedIncomingPhotoCodecs.has(sourceInfo.codec)) throw new Error("unsupported input image codec");
  } catch {
    throw photoOperationalError("INVALID_IMAGE_FORMAT", "图片无法读取，请重新导出 JPG、PNG 或 WebP 图片");
  }
  validateIncomingImage(sourceInfo);

  const ffmpeg = await resolveBinary("ffmpeg");
  const temporaryDir = await mkdtemp(join(tmpdir(), `nanbo-${slotFilename(numericId)}-`));
  const generated = {
    full: join(temporaryDir, "full.jpg"),
    thumb: join(temporaryDir, "thumb.webp"),
    featured: portfolioCatalog.heroAssetIds.includes(numericId) ? join(temporaryDir, "featured.webp") : null,
  };
  const slotBackupRoot = join(configured.backupRoot, slotFilename(numericId));
  const backupName = `${timestampName()}-${randomBytes(5).toString("hex")}`;
  const pendingBackupDir = join(slotBackupRoot, `.pending-${backupName}`);
  const backupDir = join(slotBackupRoot, backupName);

  try {
    await renderPhotoDerivatives(inputPath, generated);
    if (generated.featured) await renderAsset(ffmpeg, inputPath, generated.featured, 900, 1200, "featured");

    const [fullInfo, thumbInfo] = await Promise.all([probeImage(generated.full), probeImage(generated.thumb)]);
    if (fullInfo.width !== 1080 || fullInfo.height !== 1440 || thumbInfo.width !== 480 || thumbInfo.height !== 640) {
      throw new Error("生成图片尺寸校验失败，旧图未被覆盖");
    }

    await copyExistingAssets(targets, pendingBackupDir);
    const pendingHistoryMetaPath = join(pendingBackupDir, "meta.json");
    const history = {
      id: numericId,
      code: slotCode(numericId),
      originalName,
      sourceSize: sourceInfo,
      createdAt: new Date().toISOString(),
      restoredAt: null,
      status: "pending",
    };
    if (operationId) {
      const sizes = {};
      for (const [name, path] of Object.entries(generated)) {
        if (path) sizes[name] = (await stat(path)).size;
      }
      const result = { id: numericId, code: slotCode(numericId), sourceInfo, sizes };
      history.replaceOperation = {
        operationId,
        requestFingerprint,
        expectedStateFingerprint: await assetStateFingerprint(targets),
        resultStateFingerprint: await assetStateFingerprint(generated),
        result,
      };
    }
    await writeJson(pendingHistoryMetaPath, history);
    await rename(pendingBackupDir, backupDir);
    await runAssetTransaction(numericId, generated, "replace", backupName, configured);

    return operationId
      ? history.replaceOperation.result
      : { id: numericId, code: slotCode(numericId), sourceInfo, sizes: Object.fromEntries(await Promise.all(Object.entries(targets)
        .filter(([, path]) => path)
        .map(async ([name, path]) => [name, (await stat(path)).size]))) };
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
    await rm(pendingBackupDir, { recursive: true, force: true });
  }
}

export async function undoLatestPhotoReplacement(id, options = {}) {
  const numericId = assertPhotoId(id);
  const configured = photoStoreOptions(options);
  const operationId = options.operationId ? requirePhotoOperationId(options.operationId) : "";
  const requestFingerprint = operationId
    ? photoOperationFingerprint("undo-photo-request", [numericId])
    : "";
  const targets = assetPathsAt(numericId, configured.photoRoot);
  if (operationId) {
    const existing = await findPhotoOperations(configured, operationId);
    if (existing.length) {
      if (existing.some((match) => match.type !== "undo"
        || match.meta.id !== numericId
        || match.record.requestFingerprint !== requestFingerprint)) rejectPhotoOperationMismatch();
      const currentStateFingerprint = await assetStateFingerprint(targets);
      const committed = existing.find((match) => match.meta.status === "restored"
        && match.record.resultStateFingerprint === currentStateFingerprint
        && match.record.result);
      if (committed) return committed.record.result;
      const allRolledBack = existing.every((match) => match.meta.status === "available"
        && match.record.expectedStateFingerprint === currentStateFingerprint);
      if (!allRolledBack) rejectPhotoOperationMismatch();
    }
  }
  const slotBackupRoot = join(configured.backupRoot, slotFilename(numericId));
  let entries = [];
  try {
    entries = (await readdir(slotBackupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".pending-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw photoOperationalError("NO_UNDO_BACKUP", "没有可恢复的本地备份", 409);
    }
    throw error;
  }

  for (const entry of entries) {
    const directory = join(slotBackupRoot, entry);
    const metaPath = join(directory, "meta.json");
    let meta;
    try {
      meta = await readJson(metaPath);
      if (meta.id !== numericId || meta.restoredAt || meta.status !== "available") continue;
      await Promise.all([
        access(join(directory, "full.jpg")),
        access(join(directory, "thumb.webp")),
        ...(targets.featured ? [access(join(directory, "featured.webp"))] : []),
      ]);
    } catch {
      // 跳过损坏或未完成的备份，继续寻找更早的有效版本。
      continue;
    }
    if (operationId) {
      const desired = {
        full: join(directory, "full.jpg"),
        thumb: join(directory, "thumb.webp"),
        featured: targets.featured ? join(directory, "featured.webp") : null,
      };
      meta.undoOperation = {
        operationId,
        requestFingerprint,
        expectedStateFingerprint: await assetStateFingerprint(targets),
        resultStateFingerprint: await assetStateFingerprint(desired),
        result: { id: numericId, code: slotCode(numericId) },
      };
      await writeJson(metaPath, meta);
    }
    const desired = {
      full: join(directory, "full.jpg"),
      thumb: join(directory, "thumb.webp"),
      featured: targets.featured ? join(directory, "featured.webp") : null,
    };
    await runAssetTransaction(numericId, desired, "undo", entry, configured);
    return operationId ? meta.undoOperation.result : { id: numericId, code: slotCode(numericId) };
  }
  throw photoOperationalError("NO_UNDO_BACKUP", "没有可恢复的本地备份", 409);
}

export function createPortfolioPhotoStore(options = {}) {
  const configured = photoStoreOptions(options);
  return {
    replacePhoto({ id, inputPath, originalName = "", operationId }) {
      return replacePhoto(id, inputPath, originalName, { ...configured, operationId });
    },
    undoLatestPhotoReplacement({ id, operationId }) {
      return undoLatestPhotoReplacement(id, { ...configured, operationId });
    },
    recoverIncompletePhotoTransactions() {
      return recoverIncompletePhotoTransactions(configured);
    },
  };
}

export function validateChangedPhotoBundles(sourceFiles) {
  const bySlot = new Map();
  const errors = [];
  for (const path of sourceFiles) {
    const match = path.match(/^apps\/portfolio\/assets\/photos\/(full|thumbs|featured)\/photo-(\d{3,})\.(jpg|webp)$/);
    if (!match) {
      errors.push(`无法识别客片改动 ${path}`);
      continue;
    }
    let id;
    try {
      id = assertPublicAssetCode(`NB-${match[2]}`);
    } catch {
      const numericId = Number(match[2]);
      const expectedName = Number.isSafeInteger(numericId) && numericId > 0
        ? slotFilename(numericId)
        : "photo-001";
      errors.push(`客片编号必须使用规范文件名 ${expectedName}：${path}`);
      continue;
    }
    if (!bySlot.has(id)) bySlot.set(id, new Set());
    bySlot.get(id).add(match[1]);
  }
  for (const [id, parts] of bySlot) {
    const required = ["full", "thumbs", ...(portfolioCatalog.heroAssetIds.includes(id) ? ["featured"] : [])];
    const missing = required.filter((part) => !parts.has(part));
    if (missing.length) {
      const labels = { full: "高清图", thumbs: "缩略图", featured: "首页图" };
      errors.push(`${slotCode(id)} 缺少${missing.map((part) => labels[part]).join("、")}`);
    }
  }
  return { ok: errors.length === 0, errors, slots: [...bySlot.keys()].sort((a, b) => a - b) };
}

function exactSeriesCoverage(groups, expectedCount, label) {
  const counts = new Map();
  for (const group of groups) {
    for (const series of group.series) counts.set(series, (counts.get(series) || 0) + 1);
  }
  const errors = [];
  for (let series = 1; series <= expectedCount; series += 1) {
    if (!counts.has(series)) errors.push(`${label}缺少第 ${series} 组`);
    if ((counts.get(series) || 0) > 1) errors.push(`${label}第 ${series} 组重复分类`);
  }
  for (const series of counts.keys()) {
    if (series < 1 || series > expectedCount) errors.push(`${label}包含越界组号 ${series}`);
  }
  return errors;
}

function additionAssetPaths(id, photoRoot) {
  const base = slotFilename(id);
  return {
    full: join(photoRoot, "full", `${base}.jpg`),
    thumb: join(photoRoot, "thumbs", `${base}.webp`),
  };
}

async function readPortfolioAdditions(path) {
  return normalizePortfolioAdditions(JSON.parse(await readFile(path, "utf8")));
}

function validatePortfolioAdditions(additions, catalog) {
  const errors = [];
  const categoryIds = new Set(catalog.categories.map(({ id }) => id));
  const sceneIds = new Set(catalog.scenes.filter(({ id }) => id !== "all").map(({ id }) => id));
  const themes = new Map([
    ...catalog.themes.map((theme) => [theme.id, theme]),
    ...additions.themes.map((theme) => [theme.id, theme]),
  ]);
  const photosById = new Map(additions.photos.map((photo) => [photo.id, photo]));
  const sortedIds = [...photosById.keys()].sort((a, b) => a - b);
  sortedIds.forEach((id, index) => {
    const expected = catalog.photoCount + index + 1;
    if (id !== expected) errors.push(`新增客片编号断号：缺少 ${slotCode(expected)}`);
  });

  for (const theme of additions.themes) {
    if (!sceneIds.has(theme.scene)) errors.push(`新增主题 ${theme.id} 的场景 ${String(theme.scene)} 无效`);
    if (typeof theme.label !== "string" || !theme.label.trim()) errors.push(`新增主题 ${theme.id} 缺少名称`);
    if (typeof theme.description !== "string" || !theme.description.trim()) errors.push(`新增主题 ${theme.id} 缺少说明`);
    const cover = photosById.get(Number(theme.coverPhotoId));
    if (!cover || cover.theme !== theme.id) errors.push(`新增主题 ${theme.id} 的封面编号无效`);
    const hasPublishedPhotos = additions.photos.some((photo) => photo.theme === theme.id && photo.visibility === "published");
    if (hasPublishedPhotos && cover?.visibility !== "published") {
      errors.push(`新增主题 ${theme.id} 有公开照片时必须使用公开封面`);
    }
  }

  for (const photo of additions.photos) {
    const theme = themes.get(photo.theme);
    if (!theme) errors.push(`${slotCode(photo.id)} 引用未知主题 ${String(photo.theme)}`);
    if (!sceneIds.has(photo.scene)) errors.push(`${slotCode(photo.id)} 的场景 ${String(photo.scene)} 无效`);
    if (theme && photo.scene !== theme.scene) errors.push(`${slotCode(photo.id)} 的场景与主题 ${photo.theme} 不一致`);
    if (!categoryIds.has(photo.category)) errors.push(`${slotCode(photo.id)} 的风格 ${String(photo.category)} 无效`);
    if (typeof photo.title !== "string" || !photo.title.trim()) errors.push(`${slotCode(photo.id)} 缺少主题名称`);
    if (typeof photo.styleTitle !== "string" || !photo.styleTitle.trim()) errors.push(`${slotCode(photo.id)} 缺少风格名称`);
  }
  return errors;
}

const publicStyleSlotKeys = new Set(["assetId", "poseLabel", "source", "updatedAt"]);
const privatePublicationPattern = /\.local(?:[\\/]|$)|portfolio-style-(?:transactions|batches)|slotIdentities/;

function containsLocalAbsolutePath(value) {
  return /file:\/\//i.test(value)
    || /[A-Za-z]:[\\/]/.test(value)
    || /\\\\[^\\/\s]+[\\/][^\s]*/.test(value)
    || /(?:^|[\s("'=])\/\/[^/\s]+\/[^\s]*/.test(value)
    || /(?:^|[\s("'=])\/(?!\/)[^\s"')]+/.test(value);
}

function collectPrivateManifestStrings(value, label, errors) {
  if (typeof value === "string") {
    if (privatePublicationPattern.test(value) || containsLocalAbsolutePath(value)) {
      errors.push(`${label} 包含本机绝对路径或私有路径`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectPrivateManifestStrings(entry, `${label}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    collectPrivateManifestStrings(entry, `${label}.${key}`, errors);
  }
}

function stableSlotLabel(styleId, index) {
  try {
    return styleSlotId(styleId, index + 1);
  } catch {
    return `${styleId}-P${String(index + 1).padStart(2, "0")}`;
  }
}

function preflightStyleAssignments(rawCatalog, rawAssignments, assetMap) {
  const errors = [];
  let catalog;
  try {
    catalog = normalizeStyleCatalog(rawCatalog);
  } catch (error) {
    return { catalog: null, errors: [error.message] };
  }
  const assignments = rawAssignments?.assignments;
  if (!assignments || Array.isArray(assignments) || typeof assignments !== "object") {
    return { catalog, errors: ["照片位分配格式无效"] };
  }
  for (const style of catalog.styles) {
    const layout = assignments[style.id];
    if (!layout) {
      errors.push(`风格 ${style.id} 缺少照片位分配`);
      continue;
    }
    if (!Number.isInteger(layout.coverPosition) || layout.coverPosition < 1 || layout.coverPosition > 9) {
      errors.push(`风格 ${style.id} 封面位置无效`);
    }
    if (!Array.isArray(layout.slots)) {
      errors.push(`风格 ${style.id} 照片位格式无效`);
      continue;
    }
    const firstPositionByAsset = new Map();
    layout.slots.forEach((slot, index) => {
      const label = typeof layout.slotIds?.[index] === "string" && layout.slotIds[index]
        ? layout.slotIds[index]
        : stableSlotLabel(style.id, index);
      if (!slot || Array.isArray(slot) || typeof slot !== "object") {
        errors.push(`${label} 格式无效`);
        return;
      }
      const unknownKey = Object.keys(slot).find((key) => !publicStyleSlotKeys.has(key));
      if (unknownKey) errors.push(`${label} 不允许字段 ${unknownKey}`);
      if (!Number.isInteger(slot.assetId) || !assetMap.has(slot.assetId)) {
        errors.push(`${label} 引用未知资产 NB-${String(slot.assetId).padStart(3, "0")}`);
      } else if (assetMap.get(slot.assetId).scene !== style.scene) {
        errors.push(`${label} 资产场景与风格不一致`);
      }
      if (firstPositionByAsset.has(slot.assetId)) {
        errors.push(`${label} 与 ${stableSlotLabel(style.id, firstPositionByAsset.get(slot.assetId))} 重复资产`);
      } else {
        firstPositionByAsset.set(slot.assetId, index);
      }
      if (slot.source === "upload" && (typeof slot.updatedAt !== "string" || Number.isNaN(Date.parse(slot.updatedAt)))) {
        errors.push(`${label} upload 来源必须设置有效更新时间`);
      }
      if (slot.source === "seed" && slot.updatedAt !== null) errors.push(`${label} seed 来源更新时间必须为 null`);
      for (const value of Object.values(slot)) {
        if (typeof value === "string" && (privatePublicationPattern.test(value) || containsLocalAbsolutePath(value))) {
          errors.push(`${label} 包含本机绝对路径或私有路径`);
        }
      }
    });
  }
  return { catalog, errors };
}

async function readStyleProofs(transactionRootPath) {
  const origins = new Map();
  const confirmations = new Map();
  let entries = [];
  try {
    entries = await readdir(transactionRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { confirmations, origins };
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = await readJson(join(transactionRootPath, entry.name, "meta.json"));
      if (meta?.status !== "committed") continue;
      if (meta.operation === "replace-slot" && typeof meta.slotId === "string" && Number.isInteger(meta.assetId)) {
        origins.set(meta.assetId, meta.slotId.replace(/-P0[1-9]$/, ""));
      }
      if (meta.operation === "replace-style-batch" && typeof meta.styleId === "string" && Array.isArray(meta.assetIds)) {
        for (const assetId of meta.assetIds) if (Number.isInteger(assetId)) origins.set(assetId, meta.styleId);
      }
      if (meta.operation === "update-layout" && meta.maturity === "complete"
        && typeof meta.styleId === "string" && Array.isArray(meta.assetIds)) {
        confirmations.set(meta.styleId, [...meta.assetIds].sort((left, right) => left - right));
      }
    } catch {
      // 损坏或无关的本机历史不能证明公开成熟度。
    }
  }
  return { confirmations, origins };
}

async function validateStylePublication({ rawCatalog, rawAssignments, assets, additions, transactionRootPath }) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const preflight = preflightStyleAssignments(rawCatalog, rawAssignments, assetMap);
  const errors = [...preflight.errors];
  collectPrivateManifestStrings(rawCatalog, "风格目录", errors);
  collectPrivateManifestStrings(rawAssignments, "照片位分配", errors);
  let library = null;
  if (!errors.length) {
    try {
      library = buildStyleLibrary({
        catalog: rawCatalog,
        assignments: rawAssignments,
        assets,
        requireExplicitSlotIds: true,
      });
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (library) {
    const publishedAdditionIds = new Set(additions.photos
      .filter(({ visibility }) => visibility === "published")
      .map(({ id }) => id));
    const { confirmations, origins } = await readStyleProofs(transactionRootPath);
    for (const style of library.styles) {
      const uploaded = style.slots.filter(({ source }) => source === "upload");
      const provenUploads = uploaded.filter(({ assetId }) => publishedAdditionIds.has(assetId)
        && origins.get(assetId) === style.id);
      for (const slot of uploaded) {
        if (!publishedAdditionIds.has(slot.assetId) || origins.get(slot.assetId) !== style.id) {
          errors.push(`${slot.id} upload 来源缺少公开增量和同风格事务证明`);
        }
      }
      const assetIds = style.slots.map(({ assetId }) => assetId);
      const confirmed = confirmations.get(style.id);
      const completeProof = uploaded.length === 9
        && provenUploads.length === 9
        && new Set(assetIds).size === 9
        && confirmed
        && JSON.stringify([...assetIds].sort((left, right) => left - right)) === JSON.stringify(confirmed);
      const derivedMaturity = uploaded.length === 0 ? "reference" : (completeProof ? "complete" : "updating");
      if (style.maturity !== derivedMaturity) {
        errors.push(`风格 ${style.id} 成熟度必须为 ${derivedMaturity}`);
      }
    }
  }
  return {
    errors,
    library,
    styleCount: library?.styles.length || 0,
    styleSlotCount: library?.slots.length || 0,
    uniqueStyleAssetCount: library ? new Set(library.slots.map(({ assetId }) => assetId)).size : 0,
  };
}

export async function validatePortfolioLibrary(options = {}) {
  const errors = [];
  const warnings = [];
  const catalog = portfolioCatalog;
  const photoRoot = options.photoRoot || sourcePhotoRoot;
  const additionsPath = options.additionsPath || sourceAdditionsPath;
  const styleCatalogPath = options.styleCatalogPath || sourceStyleCatalogPath;
  const styleAssignmentsPath = options.styleAssignmentsPath || sourceStyleAssignmentsPath;
  const transactionRootPath = options.styleTransactionRoot || styleTransactionRoot;
  let additions = emptyPortfolioAdditions;

  try {
    additions = await readPortfolioAdditions(additionsPath);
    errors.push(...validatePortfolioAdditions(additions, catalog));
  } catch (error) {
    errors.push(`公开增量清单无效：${error.message}`);
  }

  if (catalog.photoCount !== catalog.pairCount * 2) errors.push("照片数与双图组数不一致");
  const categoryIds = catalog.categories.map((category) => category.id);
  const themeIds = catalog.themes.map((theme) => theme.id);
  const sceneIds = catalog.scenes.map((scene) => scene.id);
  if (new Set(categoryIds).size !== categoryIds.length) errors.push("气质 ID 有重复");
  if (new Set(themeIds).size !== themeIds.length) errors.push("主题 ID 有重复");
  if (new Set(sceneIds).size !== sceneIds.length) errors.push("场景 ID 有重复");
  for (const categoryId of Object.keys(catalog.categorySeries)) {
    if (!categoryIds.includes(categoryId)) errors.push(`气质分组 ${categoryId} 没有对应名称`);
  }
  for (const categoryId of categoryIds) {
    if (!(categoryId in catalog.categorySeries)) errors.push(`气质 ${categoryId} 没有系列分组`);
  }
  errors.push(...exactSeriesCoverage(
    Object.entries(catalog.categorySeries).map(([id, series]) => ({ id, series })),
    catalog.pairCount,
    "气质",
  ));
  errors.push(...exactSeriesCoverage(catalog.themes, catalog.pairCount, "主题"));

  const validScenes = new Set(sceneIds);
  for (const theme of catalog.themes) {
    if (!validScenes.has(theme.scene) || theme.scene === "all") errors.push(`主题 ${theme.id} 的场景无效`);
  }

  const featuredIds = new Set(catalog.featuredIds);
  if (featuredIds.size !== catalog.featuredIds.length) errors.push("首批展示顺序中有重复编号");
  for (const id of [...catalog.featuredIds, ...catalog.heroAssetIds]) {
    if (!Number.isInteger(id) || id < 1 || id > catalog.photoCount) errors.push(`首图编号 ${id} 越界`);
  }

  try {
    const legacyItems = buildPortfolioItems(catalog);
    if (legacyItems.length !== catalog.photoCount) errors.push(`历史清单生成 ${legacyItems.length} 张，应为 ${catalog.photoCount} 张`);
    if (new Set(legacyItems.map((item) => item.id)).size !== catalog.photoCount) errors.push("历史清单中有重复客片编号");
  } catch (error) {
    errors.push(error.message);
  }

  const expected = {
    full: new Set(Array.from({ length: catalog.photoCount }, (_, index) => `${slotFilename(index + 1)}.jpg`)),
    thumbs: new Set(Array.from({ length: catalog.photoCount }, (_, index) => `${slotFilename(index + 1)}.webp`)),
    featured: new Set(catalog.heroAssetIds.map((id) => `${slotFilename(id)}.webp`)),
  };
  for (const photo of additions.photos) {
    expected.full.add(`${slotFilename(photo.id)}.jpg`);
    expected.thumbs.add(`${slotFilename(photo.id)}.webp`);
  }
  const assetLabels = { full: "高清图", thumbs: "缩略图", featured: "首页图" };
  for (const [directory, names] of Object.entries(expected)) {
    let actual = [];
    try {
      actual = (await readdir(join(photoRoot, directory))).filter((name) => !name.startsWith("."));
    } catch {
      errors.push(`缺少图片目录 ${directory}`);
      continue;
    }
    for (const name of names) {
      if (actual.includes(name)) continue;
      const id = Number(name.match(/photo-(\d+)\./)?.[1]);
      errors.push(Number.isInteger(id) ? `${slotCode(id)} 缺少${assetLabels[directory]}` : `${directory} 缺少 ${name}`);
    }
    for (const name of actual) if (!names.has(name)) errors.push(`${directory} 有未记录文件 ${name}，为防止误公开已停止发布`);
  }

  let items = [];
  let themes = [];
  try {
    items = buildPortfolioItems(catalog, additions);
    themes = buildPortfolioThemes(catalog, additions);
  } catch (error) {
    errors.push(error.message);
  }

  let styleResult = { styleCount: 0, styleSlotCount: 0, uniqueStyleAssetCount: 0 };
  try {
    const [rawCatalog, rawAssignments] = await Promise.all([
      readJson(styleCatalogPath),
      readJson(styleAssignmentsPath),
    ]);
    const assets = items.map((item) => ({
      ...item,
      thumb: `../portfolio/assets/photos/thumbs/${slotFilename(item.id)}.webp`,
      full: `../portfolio/assets/photos/full/${slotFilename(item.id)}.jpg`,
    }));
    styleResult = await validateStylePublication({
      rawCatalog,
      rawAssignments,
      assets,
      additions,
      transactionRootPath,
    });
    errors.push(...styleResult.errors);
  } catch (error) {
    errors.push(`风格公开清单无效：${error.message}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    photoCount: items.length || catalog.photoCount,
    themeCount: themes.length || catalog.themes.length,
    heroAssetCount: catalog.heroAssetIds.length,
    styleCount: styleResult.styleCount,
    styleSlotCount: styleResult.styleSlotCount,
    uniqueStyleAssetCount: styleResult.uniqueStyleAssetCount,
  };
}

export async function buildPortfolioVersion(options = {}) {
  const photoRoot = options.photoRoot || sourcePhotoRoot;
  const additionsPath = options.additionsPath || sourceAdditionsPath;
  const interactionModelPath = options.interactionModelPath || join(root, "apps/portfolio-v2/interaction-model.js");
  const defaultStyleVersionPaths = Object.fromEntries([
    "style-catalog.json",
    "style-slot-assignments.json",
    "style-library.js",
    "style-explorer-model.js",
    "style-preferences.js",
    "style-explorer.js",
  ].map((filename) => [filename, join(root, "apps/portfolio-v2", filename)]));
  const styleVersionPaths = { ...defaultStyleVersionPaths, ...(options.styleVersionPaths || {}) };
  const additions = await readPortfolioAdditions(additionsPath);
  const hash = createHash("sha256");
  const files = [
    join(root, "apps/portfolio-v2/index.html"),
    join(root, "apps/portfolio-v2/styles.css"),
    join(root, "apps/portfolio-v2/app.js"),
    interactionModelPath,
    join(root, "apps/portfolio-v2/analytics.js"),
    join(root, "apps/portfolio-v2/catalog.js"),
    join(root, "apps/portfolio-v2/portfolio-runtime.js"),
    join(root, "apps/portfolio-v2/wechat-share.js"),
    join(root, "apps/portfolio-v2/wechat-contact-qr.png"),
    join(root, "apps/portfolio-v2/privacy.html"),
    join(root, "apps/portfolio-v2/share-card.jpg"),
    additionsPath,
    ...Object.values(styleVersionPaths),
  ];
  for (let id = 1; id <= portfolioCatalog.photoCount; id += 1) {
    const paths = {
      ...additionAssetPaths(id, photoRoot),
      featured: portfolioCatalog.heroAssetIds.includes(id)
        ? join(photoRoot, "featured", `${slotFilename(id)}.webp`)
        : null,
    };
    files.push(paths.full, paths.thumb);
    if (paths.featured) files.push(paths.featured);
  }
  for (const photo of additions.photos) {
    const paths = additionAssetPaths(photo.id, photoRoot);
    files.push(paths.full, paths.thumb);
  }
  for (const path of files.sort()) {
    hash.update(relative(root, path));
    hash.update(await readFile(path));
  }
  return `pv2-${hash.digest("hex").slice(0, 12)}`;
}

export async function writeUploadToTemporaryFile(buffer, extension = ".upload") {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-upload-"));
  const path = join(directory, `incoming${extension}`);
  await writeFile(path, buffer);
  return { directory, path };
}

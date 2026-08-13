import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPortfolioItems, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const sourcePhotoRoot = join(root, "apps/portfolio/assets/photos");
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

export function slotCode(id) {
  return `NB-${String(id).padStart(3, "0")}`;
}

export function slotFilename(id) {
  return `photo-${String(id).padStart(3, "0")}`;
}

export function assertPhotoId(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1 || numericId > portfolioCatalog.photoCount) {
    throw new Error(`客片编号必须在 1–${portfolioCatalog.photoCount} 之间`);
  }
  return numericId;
}

export function assetPaths(id) {
  const numericId = assertPhotoId(id);
  const base = slotFilename(numericId);
  return {
    full: join(sourcePhotoRoot, "full", `${base}.jpg`),
    thumb: join(sourcePhotoRoot, "thumbs", `${base}.webp`),
    featured: portfolioCatalog.heroAssetIds.includes(numericId)
      ? join(sourcePhotoRoot, "featured", `${base}.webp`)
      : null,
  };
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
    "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
    "-of", "json",
    path,
  ]);
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("无法读取这张图片的尺寸");
  const rotation = Number(stream.tags?.rotate || stream.side_data_list?.[0]?.rotation || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    width: rotated ? stream.height : stream.width,
    height: rotated ? stream.width : stream.height,
    rotation,
  };
}

function validateIncomingDimensions({ width, height }) {
  const ratio = width / height;
  if (width < 900 || height < 1200) {
    throw new Error(`图片只有 ${width}×${height}，请使用至少 900×1200 像素的精修图`);
  }
  if (Math.abs(ratio - 0.75) > 0.005) {
    throw new Error(`图片比例是 ${width}:${height}，请先在像素蛋糕或 Photoshop 裁成 3:4，系统不会自动裁掉人物`);
  }
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

async function updateHistoryAfterTransaction(meta, completed) {
  if (!meta.historyMetaPath) return true;
  let history;
  try {
    history = await readJson(meta.historyMetaPath);
  } catch {
    return false;
  }
  if (meta.operation === "replace") {
    history.status = completed ? "available" : "failed";
  } else if (meta.operation === "undo" && completed) {
    history.status = "restored";
    history.restoredAt = history.restoredAt || new Date().toISOString();
  }
  try {
    await writeJson(meta.historyMetaPath, history);
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

async function runAssetTransaction(id, desired, operation, historyMetaPath = "") {
  const numericId = assertPhotoId(id);
  const token = randomBytes(5).toString("hex");
  const transactionDir = join(transactionRoot, `${slotFilename(numericId)}-${timestampName()}-${token}`);
  const metaPath = join(transactionDir, "transaction.json");
  const targets = assetPaths(numericId);
  const meta = {
    id: numericId,
    operation,
    status: "preparing",
    historyMetaPath,
    createdAt: new Date().toISOString(),
  };
  await mkdir(transactionDir, { recursive: true });

  try {
    await copyExistingAssets(targets, join(transactionDir, "before"));
    await copyExistingAssets(desired, join(transactionDir, "next"));
    await persistTransactionStatus(metaPath, meta, "prepared");
    await persistTransactionStatus(metaPath, meta, "committing");
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
    await updateHistoryAfterTransaction(meta, false);
    await rm(transactionDir, { recursive: true, force: true });
    throw error;
  }

  // 资产已完整安装且 committed 标记已落盘。之后的记账或清理失败不应
  // 把已成功的换图误报为失败；保留事务目录，下次启动会再完成记账。
  const historyUpdated = await updateHistoryAfterTransaction(meta, true);
  if (historyUpdated) await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
  return { committed: true, reconciliationPending: !historyUpdated };
}

export async function recoverIncompletePhotoTransactions() {
  let entries = [];
  try {
    entries = (await readdir(transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const recovered = [];
  for (const entry of entries) {
    const transactionDir = join(transactionRoot, entry.name);
    const metaPath = join(transactionDir, "transaction.json");
    let rawMeta;
    try {
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
      meta = JSON.parse(rawMeta);
    } catch {
      throw new Error(`客片事务记录损坏，已停止管理台以保护图片：${transactionDir}`);
    }
    if (meta.status === "committing" || meta.status === "recovering") {
      await persistTransactionStatus(metaPath, meta, "recovering");
      await restoreTransaction(transactionDir, assetPaths(meta.id));
      await updateHistoryAfterTransaction(meta, false);
      recovered.push(slotCode(meta.id));
    } else if (meta.status === "committed") {
      const historyUpdated = await updateHistoryAfterTransaction(meta, true);
      if (!historyUpdated) {
        throw new Error(`已安装 ${slotCode(meta.id)}，但本地备份记录尚未完成；请交给 Codex 处理：${transactionDir}`);
      }
    } else if (["preparing", "prepared"].includes(meta.status)) {
      await updateHistoryAfterTransaction(meta, false);
    } else {
      throw new Error(`客片事务状态无法识别，已停止管理台：${transactionDir}`);
    }
    await rm(transactionDir, { recursive: true, force: true });
  }
  return recovered;
}

export async function replacePhoto(id, inputPath, originalName = "") {
  const numericId = assertPhotoId(id);
  const sourceInfo = await probeImage(inputPath);
  validateIncomingDimensions(sourceInfo);

  const ffmpeg = await resolveBinary("ffmpeg");
  const temporaryDir = await mkdtemp(join(tmpdir(), `nanbo-${slotFilename(numericId)}-`));
  const generated = {
    full: join(temporaryDir, "full.jpg"),
    thumb: join(temporaryDir, "thumb.webp"),
    featured: portfolioCatalog.heroAssetIds.includes(numericId) ? join(temporaryDir, "featured.webp") : null,
  };
  const targets = assetPaths(numericId);
  const slotBackupRoot = join(backupRoot, slotFilename(numericId));
  const backupName = `${timestampName()}-${randomBytes(5).toString("hex")}`;
  const pendingBackupDir = join(slotBackupRoot, `.pending-${backupName}`);
  const backupDir = join(slotBackupRoot, backupName);

  try {
    await renderAsset(ffmpeg, inputPath, generated.full, 1080, 1440, "jpg");
    await renderAsset(ffmpeg, inputPath, generated.thumb, 480, 640, "thumb");
    if (generated.featured) await renderAsset(ffmpeg, inputPath, generated.featured, 900, 1200, "featured");

    const [fullInfo, thumbInfo] = await Promise.all([probeImage(generated.full), probeImage(generated.thumb)]);
    if (fullInfo.width !== 1080 || fullInfo.height !== 1440 || thumbInfo.width !== 480 || thumbInfo.height !== 640) {
      throw new Error("生成图片尺寸校验失败，旧图未被覆盖");
    }

    await copyExistingAssets(targets, pendingBackupDir);
    const pendingHistoryMetaPath = join(pendingBackupDir, "meta.json");
    await writeJson(pendingHistoryMetaPath, {
      id: numericId,
      code: slotCode(numericId),
      originalName,
      sourceSize: sourceInfo,
      createdAt: new Date().toISOString(),
      restoredAt: null,
      status: "pending",
    });
    await rename(pendingBackupDir, backupDir);
    const historyMetaPath = join(backupDir, "meta.json");
    await runAssetTransaction(numericId, generated, "replace", historyMetaPath);

    const sizes = {};
    for (const [name, path] of Object.entries(targets)) {
      if (path) sizes[name] = (await stat(path)).size;
    }
    return { id: numericId, code: slotCode(numericId), sourceInfo, sizes, backupDir };
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
    await rm(pendingBackupDir, { recursive: true, force: true });
  }
}

export async function undoLatestPhotoReplacement(id) {
  const numericId = assertPhotoId(id);
  const slotBackupRoot = join(backupRoot, slotFilename(numericId));
  let entries = [];
  try {
    entries = (await readdir(slotBackupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".pending-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    throw new Error(`${slotCode(numericId)} 还没有可恢复的本地备份`);
  }

  for (const entry of entries) {
    const directory = join(slotBackupRoot, entry);
    const metaPath = join(directory, "meta.json");
    const targets = assetPaths(numericId);
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
    await runAssetTransaction(numericId, {
      full: join(directory, "full.jpg"),
      thumb: join(directory, "thumb.webp"),
      featured: targets.featured ? join(directory, "featured.webp") : null,
    }, "undo", metaPath);
    return { id: numericId, code: slotCode(numericId), backupDir: directory };
  }
  throw new Error(`${slotCode(numericId)} 没有更早的可用备份`);
}

export function validateChangedPhotoBundles(sourceFiles) {
  const bySlot = new Map();
  const errors = [];
  for (const path of sourceFiles) {
    const match = path.match(/^apps\/portfolio\/assets\/photos\/(full|thumbs|featured)\/photo-(\d{3})\.(jpg|webp)$/);
    if (!match) {
      errors.push(`无法识别客片改动 ${path}`);
      continue;
    }
    const id = Number(match[2]);
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

export async function validatePortfolioLibrary() {
  const errors = [];
  const warnings = [];
  const catalog = portfolioCatalog;

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
    const items = buildPortfolioItems(catalog);
    if (items.length !== catalog.photoCount) errors.push(`清单生成 ${items.length} 张，应为 ${catalog.photoCount} 张`);
    if (new Set(items.map((item) => item.id)).size !== catalog.photoCount) errors.push("清单中有重复客片编号");
  } catch (error) {
    errors.push(error.message);
  }

  const expected = {
    full: new Set(Array.from({ length: catalog.photoCount }, (_, index) => `${slotFilename(index + 1)}.jpg`)),
    thumbs: new Set(Array.from({ length: catalog.photoCount }, (_, index) => `${slotFilename(index + 1)}.webp`)),
    featured: new Set(catalog.heroAssetIds.map((id) => `${slotFilename(id)}.webp`)),
  };
  for (const [directory, names] of Object.entries(expected)) {
    let actual = [];
    try {
      actual = (await readdir(join(sourcePhotoRoot, directory))).filter((name) => !name.startsWith("."));
    } catch {
      errors.push(`缺少图片目录 ${directory}`);
      continue;
    }
    for (const name of names) if (!actual.includes(name)) errors.push(`${directory} 缺少 ${name}`);
    for (const name of actual) if (!names.has(name)) errors.push(`${directory} 有未记录文件 ${name}，为防止误公开已停止发布`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    photoCount: catalog.photoCount,
    themeCount: catalog.themes.length,
    heroAssetCount: catalog.heroAssetIds.length,
  };
}

export async function buildPortfolioVersion() {
  const hash = createHash("sha256");
  const files = [
    join(root, "apps/portfolio-v2/index.html"),
    join(root, "apps/portfolio-v2/styles.css"),
    join(root, "apps/portfolio-v2/app.js"),
    join(root, "apps/portfolio-v2/catalog.js"),
  ];
  for (let id = 1; id <= portfolioCatalog.photoCount; id += 1) {
    const paths = assetPaths(id);
    files.push(paths.full, paths.thumb);
    if (paths.featured) files.push(paths.featured);
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

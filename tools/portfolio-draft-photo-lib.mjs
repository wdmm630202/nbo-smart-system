import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { normalizePortfolioAdditions, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
import {
  probeImage,
  renderPhotoDerivatives,
  root,
  slotCode,
  slotFilename,
  validateIncomingImage,
} from "./portfolio-photo-lib.mjs";

const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedPhotoExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const decodedCodecsByExtension = new Map([
  [".jpg", new Set(["mjpeg", "jpeg"])],
  [".jpeg", new Set(["mjpeg", "jpeg"])],
  [".png", new Set(["png"])],
  [".webp", new Set(["webp"])],
]);
const photoLabelsByExtension = new Map([
  [".jpg", "JPG"],
  [".jpeg", "JPEG"],
  [".png", "PNG"],
  [".webp", "WebP"],
]);
const maxPhotoBytes = 50 * 1024 * 1024;
const publicationQueues = new Map();
const defaultPublicationTransactionRoot = join(root, ".local/portfolio-publication-transactions");
const publicationTransactionStatuses = new Set([
  "prepared",
  "committing",
  "full-installed",
  "bundle-installed",
  "manifest-installed",
  "committed",
]);

function assertSupportedPhoto(originalName, contentType) {
  const extension = extname(originalName).toLowerCase();
  if (!allowedPhotoExtensions.has(extension) || !allowedPhotoTypes.has(contentType)) {
    throw new Error("只支持 JPG、PNG 或 WebP 图片");
  }
  return extension;
}

function assertDecodedPhoto(extension, codec) {
  if (!decodedCodecsByExtension.get(extension)?.has(codec)) {
    throw new Error(`图片实际格式 ${codec || "未知"} 与 ${photoLabelsByExtension.get(extension)} 扩展名不一致`);
  }
}

export async function ingestDraftPhoto({ inputPath, originalName, contentType, store, rootDir, publicIds }) {
  const selectedName = basename(originalName);
  const extension = assertSupportedPhoto(selectedName, contentType);
  if ((await stat(inputPath)).size > maxPhotoBytes) throw new Error("单张图片不能超过 50 MB");
  const sourceInfo = await probeImage(inputPath);
  assertDecodedPhoto(extension, sourceInfo.codec);
  validateIncomingImage(sourceInfo);

  const id = await store.allocateId(publicIds);
  const uuid = randomBytes(12).toString("hex");
  const targets = {
    original: join(rootDir, "assets/originals", `${uuid}${extension}`),
    full: join(rootDir, "assets/full", `${uuid}.jpg`),
    thumb: join(rootDir, "assets/thumbs", `${uuid}.webp`),
  };
  await Promise.all(Object.values(targets).map((path) => mkdir(dirname(path), { recursive: true })));

  try {
    await copyFile(inputPath, targets.original);
    await renderPhotoDerivatives(inputPath, targets);
    const record = await store.addPhoto({
      id,
      uuid,
      originalName: `${slotCode(id)}${extension}`,
      status: "draft",
      approvedForPublicUse: false,
    });
    return { ...record, selectedName };
  } catch (error) {
    await Promise.all(Object.values(targets).map((path) => rm(path, { force: true }).catch(() => {})));
    throw error;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function enqueuePublication(path, operation) {
  const previous = publicationQueues.get(path) || Promise.resolve();
  const result = previous.then(operation);
  const settled = result.catch(() => {});
  publicationQueues.set(path, settled);
  settled.finally(() => {
    if (publicationQueues.get(path) === settled) publicationQueues.delete(path);
  });
  return result;
}

function parsePublicAdditions(contents) {
  const value = JSON.parse(contents);
  normalizePortfolioAdditions(value);
  return value;
}

export async function loadPublicAdditions(path) {
  return clone(parsePublicAdditions(await readFile(path, "utf8")));
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${extname(path) || "json"}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`);
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function jsonContents(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function transactionRootFor(options) {
  return options.publicationTransactionRoot || defaultPublicationTransactionRoot;
}

function publicAssetPaths(id, publicPhotoRoot) {
  const base = slotFilename(id);
  return {
    full: join(publicPhotoRoot, "full", `${base}.jpg`),
    thumb: join(publicPhotoRoot, "thumbs", `${base}.webp`),
  };
}

async function persistPublicationTransaction(metaPath, meta, status) {
  if (!publicationTransactionStatuses.has(status)) throw new Error(`公开事务状态无效：${status}`);
  const next = { ...meta, status };
  await writeAtomic(metaPath, jsonContents(next));
  Object.assign(meta, next);
}

async function recoverPublicationTransaction(transactionDir, options) {
  const metaPath = join(transactionDir, "transaction.json");
  let rawMeta;
  try {
    rawMeta = await readFile(metaPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
      return null;
    }
    throw error;
  }

  let meta;
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    throw new Error(`公开事务记录损坏，已停止操作：${transactionDir}`);
  }
  if (meta?.schemaVersion !== 1 || meta.operation !== "stage" || !Number.isInteger(meta.id)
    || meta.id <= portfolioCatalog.photoCount || !publicationTransactionStatuses.has(meta.status)) {
    throw new Error(`公开事务记录无效，已停止操作：${transactionDir}`);
  }
  if (meta.status === "committed") {
    await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  const previousAdditions = await readFile(join(transactionDir, "before-additions.json"), "utf8");
  parsePublicAdditions(previousAdditions);
  const assets = publicAssetPaths(meta.id, options.publicPhotoRoot);
  await writeAtomic(options.additionsPath, previousAdditions);
  await Promise.all([
    rm(assets.full, { force: true }),
    rm(assets.thumb, { force: true }),
  ]);
  await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
  return slotCode(meta.id);
}

async function recoverIncompletePublicationTransactionsInternal(options) {
  const transactionRoot = transactionRootFor(options);
  let entries;
  try {
    entries = (await readdir(transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const recovered = [];
  for (const entry of entries) {
    const code = await recoverPublicationTransaction(join(transactionRoot, entry.name), options);
    if (code) recovered.push(code);
  }
  return recovered;
}

export function recoverIncompletePublicationTransactions(options) {
  return enqueuePublication(options.additionsPath, () => recoverIncompletePublicationTransactionsInternal(options));
}

function assertUuid(uuid) {
  if (typeof uuid !== "string" || !/^[0-9a-f]{24}$/.test(uuid)) {
    throw new Error("草稿图片标识无效");
  }
}

function resolvePublicationMetadata(draft, state, additions) {
  if (draft.status !== "ready") throw new Error("只有待公开草稿可以安装到公开库");
  if (!draft.scene || !draft.theme || !draft.category || draft.approvedForPublicUse !== true) {
    throw new Error("进入待公开前必须填写场景、主题、风格和公开授权");
  }
  assertUuid(draft.uuid);

  const category = portfolioCatalog.categories.find(({ id }) => id === draft.category);
  if (!category) throw new Error(`草稿风格 ${draft.category} 无效`);
  const theme = portfolioCatalog.themes.find(({ id }) => id === draft.theme)
    || additions.themes.find(({ id }) => id === draft.theme)
    || state.themes.find(({ id }) => id === draft.theme);
  if (!theme) throw new Error(`草稿主题 ${draft.theme} 无效`);
  if (theme.scene !== draft.scene) throw new Error(`草稿主题 ${draft.theme} 与场景不一致`);
  return { category, theme };
}

function buildNextAdditions(additions, draft, state, publishedAt) {
  if (additions.photos.some(({ id }) => Number(id) === draft.id)) {
    throw new Error(`${slotCode(draft.id)} 已在公开增量清单中`);
  }
  const { category, theme } = resolvePublicationMetadata(draft, state, additions);
  const next = clone(additions);
  const legacyTheme = portfolioCatalog.themes.some(({ id }) => id === draft.theme);
  let publicTheme = next.themes.find(({ id }) => id === draft.theme);
  if (!legacyTheme && !publicTheme) {
    publicTheme = {
      id: theme.id,
      scene: theme.scene,
      label: theme.label,
      description: theme.description,
      coverPhotoId: draft.id,
    };
    next.themes.push(publicTheme);
  } else if (publicTheme && !next.photos.some((photo) => photo.theme === draft.theme && photo.visibility === "published")) {
    publicTheme.coverPhotoId = draft.id;
  }

  next.photos.push({
    id: draft.id,
    scene: draft.scene,
    theme: draft.theme,
    category: draft.category,
    title: theme.label,
    styleTitle: category.label,
    featured: draft.featured === true,
    visibility: "published",
    publishedAt,
  });
  normalizePortfolioAdditions(next);
  return next;
}

async function assertPathAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`公开图片已存在，为防止覆盖已停止：${path}`);
}

export function stageDraftForPublication(id, options) {
  const { store, draftRoot, additionsPath, publicPhotoRoot } = options;
  return enqueuePublication(additionsPath, async () => {
    await recoverIncompletePublicationTransactionsInternal(options);
    const originalAdditions = await readFile(additionsPath, "utf8");
    const additions = parsePublicAdditions(originalAdditions);
    const state = await store.read();
    const draft = state.photos.find((photo) => photo.id === Number(id));
    if (!draft) throw new Error(`找不到草稿 ${slotCode(id)}`);
    const stagedAt = new Date().toISOString();
    const nextAdditions = buildNextAdditions(additions, draft, state, stagedAt);

    const draftAssets = {
      full: join(draftRoot, "assets/full", `${draft.uuid}.jpg`),
      thumb: join(draftRoot, "assets/thumbs", `${draft.uuid}.webp`),
    };
    const publicAssets = publicAssetPaths(draft.id, publicPhotoRoot);
    await Promise.all([assertPathAbsent(publicAssets.full), assertPathAbsent(publicAssets.thumb)]);
    const [fullInfo, thumbInfo] = await Promise.all([probeImage(draftAssets.full), probeImage(draftAssets.thumb)]);
    if (fullInfo.width !== 1080 || fullInfo.height !== 1440 || thumbInfo.width !== 480 || thumbInfo.height !== 640) {
      throw new Error("草稿衍生图尺寸无效，已停止公开");
    }

    const transactionRoot = transactionRootFor(options);
    await mkdir(transactionRoot, { recursive: true });
    const transactionDir = await mkdtemp(join(transactionRoot, `${slotFilename(draft.id)}-`));
    const metaPath = join(transactionDir, "transaction.json");
    const prepared = {
      full: join(transactionDir, "full.jpg"),
      thumb: join(transactionDir, "thumb.webp"),
      additions: join(transactionDir, "catalog-additions.json"),
    };
    const meta = {
      schemaVersion: 1,
      operation: "stage",
      id: draft.id,
      status: "prepared",
      createdAt: stagedAt,
    };
    let journalReady = false;
    let committed = false;
    try {
      await Promise.all([
        copyFile(draftAssets.full, prepared.full),
        copyFile(draftAssets.thumb, prepared.thumb),
        writeFile(prepared.additions, jsonContents(nextAdditions)),
        writeFile(join(transactionDir, "before-additions.json"), originalAdditions),
        mkdir(dirname(publicAssets.full), { recursive: true }),
        mkdir(dirname(publicAssets.thumb), { recursive: true }),
      ]);
      await persistPublicationTransaction(metaPath, meta, "prepared");
      journalReady = true;
      await persistPublicationTransaction(metaPath, meta, "committing");
      await rename(prepared.full, publicAssets.full);
      await persistPublicationTransaction(metaPath, meta, "full-installed");
      await rename(prepared.thumb, publicAssets.thumb);
      await persistPublicationTransaction(metaPath, meta, "bundle-installed");
      await rename(prepared.additions, additionsPath);
      await persistPublicationTransaction(metaPath, meta, "manifest-installed");
      await store.markStaged(draft.id, stagedAt);
      await persistPublicationTransaction(metaPath, meta, "committed");
      committed = true;
    } catch (error) {
      if (!journalReady) {
        await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      try {
        await recoverPublicationTransaction(transactionDir, options);
      } catch (recoveryError) {
        throw new Error(`${error.message}；已保留事务日志，自动恢复未完成：${recoveryError.message}`);
      }
      throw error;
    }
    if (committed) await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
    return clone(nextAdditions.photos.at(-1));
  });
}

export function setPublishedPhotoVisibility(id, visibility, options) {
  const { additionsPath } = options;
  if (visibility !== "published" && visibility !== "archived") {
    return Promise.reject(new Error("公开客片只能设为 published 或 archived"));
  }
  return enqueuePublication(additionsPath, async () => {
    await recoverIncompletePublicationTransactionsInternal(options);
    const additions = await loadPublicAdditions(additionsPath);
    const photo = additions.photos.find((item) => item.id === Number(id));
    if (!photo) throw new Error(`公开增量中找不到 ${slotCode(id)}`);
    photo.visibility = visibility;
    normalizePortfolioAdditions(additions);
    await writeAtomic(additionsPath, jsonContents(additions));
    return clone(photo);
  });
}

import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import { normalizePortfolioAdditions, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
import {
  probeImage,
  renderPhotoDerivatives,
  slotCode,
  slotFilename,
  validateIncomingImage,
} from "./portfolio-photo-lib.mjs";

const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedPhotoExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const maxPhotoBytes = 50 * 1024 * 1024;
const publicationQueues = new Map();

function assertSupportedPhoto(originalName, contentType) {
  const extension = extname(originalName).toLowerCase();
  if (!allowedPhotoExtensions.has(extension) || !allowedPhotoTypes.has(contentType)) {
    throw new Error("只支持 JPG、PNG 或 WebP 图片");
  }
  return extension;
}

export async function ingestDraftPhoto({ inputPath, originalName, contentType, store, rootDir, publicIds }) {
  const extension = assertSupportedPhoto(originalName, contentType);
  if ((await stat(inputPath)).size > maxPhotoBytes) throw new Error("单张图片不能超过 50 MB");
  validateIncomingImage(await probeImage(inputPath));

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
    return { ...record, selectedName: originalName };
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
    const base = slotFilename(draft.id);
    const publicAssets = {
      full: join(publicPhotoRoot, "full", `${base}.jpg`),
      thumb: join(publicPhotoRoot, "thumbs", `${base}.webp`),
    };
    await Promise.all([assertPathAbsent(publicAssets.full), assertPathAbsent(publicAssets.thumb)]);
    const [fullInfo, thumbInfo] = await Promise.all([probeImage(draftAssets.full), probeImage(draftAssets.thumb)]);
    if (fullInfo.width !== 1080 || fullInfo.height !== 1440 || thumbInfo.width !== 480 || thumbInfo.height !== 640) {
      throw new Error("草稿衍生图尺寸无效，已停止公开");
    }

    const transactionDir = await mkdtemp(join(dirname(additionsPath), ".nanbo-publication-stage-"));
    const prepared = {
      full: join(transactionDir, "full.jpg"),
      thumb: join(transactionDir, "thumb.webp"),
      additions: join(transactionDir, "catalog-additions.json"),
    };
    let fullInstalled = false;
    let thumbInstalled = false;
    let additionsInstalled = false;
    try {
      await Promise.all([
        copyFile(draftAssets.full, prepared.full),
        copyFile(draftAssets.thumb, prepared.thumb),
        writeFile(prepared.additions, jsonContents(nextAdditions)),
        mkdir(dirname(publicAssets.full), { recursive: true }),
        mkdir(dirname(publicAssets.thumb), { recursive: true }),
      ]);
      await rename(prepared.full, publicAssets.full);
      fullInstalled = true;
      await rename(prepared.thumb, publicAssets.thumb);
      thumbInstalled = true;
      await rename(prepared.additions, additionsPath);
      additionsInstalled = true;
      await store.markStaged(draft.id, stagedAt);
      return clone(nextAdditions.photos.at(-1));
    } catch (error) {
      const rollbackErrors = [];
      if (additionsInstalled) {
        await writeAtomic(additionsPath, originalAdditions).catch((rollbackError) => rollbackErrors.push(rollbackError));
      }
      if (thumbInstalled) await rm(publicAssets.thumb, { force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError));
      if (fullInstalled) await rm(publicAssets.full, { force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError));
      if (rollbackErrors.length) {
        throw new Error(`${error.message}；回滚未完成：${rollbackErrors.map(({ message }) => message).join("；")}`);
      }
      throw error;
    } finally {
      await rm(transactionDir, { recursive: true, force: true });
    }
  });
}

export function setPublishedPhotoVisibility(id, visibility, { additionsPath }) {
  if (visibility !== "published" && visibility !== "archived") {
    return Promise.reject(new Error("公开客片只能设为 published 或 archived"));
  }
  return enqueuePublication(additionsPath, async () => {
    const additions = await loadPublicAdditions(additionsPath);
    const photo = additions.photos.find((item) => item.id === Number(id));
    if (!photo) throw new Error(`公开增量中找不到 ${slotCode(id)}`);
    photo.visibility = visibility;
    normalizePortfolioAdditions(additions);
    await writeAtomic(additionsPath, jsonContents(additions));
    return clone(photo);
  });
}

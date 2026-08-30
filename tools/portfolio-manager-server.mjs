import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import { buildPortfolioItems, buildPortfolioThemes, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
import {
  ingestDraftPhoto,
  loadPublicAdditions,
  recoverIncompletePublicationTransactions,
  setPublishedPhotoVisibility,
  stageDraftForPublication,
} from "./portfolio-draft-photo-lib.mjs";
import { createDraftStore, draftRoot } from "./portfolio-draft-store.mjs";
import {
  buildPortfolioVersion,
  onlinePortfolioUrl,
  recoverIncompletePhotoTransactions,
  replacePhoto,
  root,
  run,
  slotCode,
  sourcePhotoRoot,
  undoLatestPhotoReplacement,
  validateChangedPhotoBundles,
  validatePortfolioLibrary,
  writeUploadToTemporaryFile,
} from "./portfolio-photo-lib.mjs";

const host = "127.0.0.1";
const requestedPort = Number(process.env.NANBO_PORTFOLIO_PORT || 4174);
const managerRoot = join(root, "tools/portfolio-manager");
const previewRoot = join(root, "apps/portfolio-v2");
const sharedPortfolioRoot = join(root, "apps/portfolio");
const configuredDraftRoot = process.env.NANBO_PORTFOLIO_DRAFT_ROOT || draftRoot;
const additionsPath = process.env.NANBO_PORTFOLIO_ADDITIONS_PATH || join(root, "apps/portfolio-v2/catalog-additions.json");
const publicPhotoRoot = process.env.NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT || sourcePhotoRoot;
const draftStore = createDraftStore({ rootDir: configuredDraftRoot, legacyMaxId: portfolioCatalog.photoCount });
const publicationOptions = {
  store: draftStore,
  draftRoot: configuredDraftRoot,
  additionsPath,
  publicPhotoRoot,
  ...(process.env.NANBO_PORTFOLIO_DRAFT_ROOT
    ? { publicationTransactionRoot: join(configuredDraftRoot, "publication-transactions") }
    : {}),
};
const sessionToken = randomBytes(24).toString("hex");
const uploadLimit = 50 * 1024 * 1024;
let activeMutation = "";
let serverReady = false;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedPhotoExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const publishPrefixes = [
  "apps/portfolio/assets/photos/",
  "apps/portfolio-v2/catalog-additions.json",
  "docs/projects/portfolio/assets/photos/",
  "docs/projects/portfolio-v2/",
  "docs/p/",
];
const allowedHosts = new Set([`${host}:${requestedPort}`, `localhost:${requestedPort}`]);

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function errorJson(response, error, status = 400) {
  json(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
}

function beginMutation(label) {
  if (activeMutation) throw new Error(`正在${activeMutation}，请等当前操作完成`);
  activeMutation = label;
}

function finishMutation() {
  activeMutation = "";
}

function safePath(base, requestedPath) {
  const decoded = decodeURIComponent(requestedPath);
  const target = resolve(base, `.${normalize(`/${decoded}`)}`);
  const basePath = resolve(base);
  if (target !== basePath && !target.startsWith(`${basePath}${sep}`)) throw new Error("文件路径无效");
  return target;
}

function isPathInside(base, path) {
  const basePath = resolve(base);
  const target = resolve(path);
  return target === basePath || target.startsWith(`${basePath}${sep}`);
}

async function sendFile(response, path, cache = "no-cache", allowedRoots = [managerRoot, previewRoot, sharedPortfolioRoot]) {
  try {
    const allowedBase = allowedRoots.find((base) => isPathInside(base, path));
    if (!allowedBase) throw new Error("文件路径无效");
    const info = await stat(path);
    if (!info.isFile()) throw new Error("不是文件");
    const [realBase, realTarget] = await Promise.all([realpath(allowedBase), realpath(path)]);
    if (!isPathInside(realBase, realTarget)) throw new Error("文件路径无效");
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("文件不存在");
  }
}

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end("文件不存在");
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > uploadLimit) throw new Error("图片超过 50 MB，请先导出精修 JPG");
    chunks.push(chunk);
  }
  if (!size) throw new Error("请先选择要替换的图片");
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const content = await readBody(request);
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("提交的数据不是有效 JSON");
  }
}

async function git(args, options = {}) {
  return run("git", args, { cwd: root, ...options });
}

function parseStatusLine(line) {
  const path = line.slice(3).trim().split(" -> ").at(-1);
  return { state: line.slice(0, 2), path };
}

async function repositoryStatus() {
  const [{ stdout: porcelain }, { stdout: head }, { stdout: branch }, additions] = await Promise.all([
    git(["status", "--porcelain=v1", "--untracked-files=all"], { preserveWhitespace: true }),
    git(["rev-parse", "--short", "HEAD"]),
    git(["branch", "--show-current"]),
    readPublicAdditions(),
  ]);
  const files = porcelain ? porcelain.split("\n").filter(Boolean).map(parseStatusLine) : [];
  const changedFiles = files.map((item) => item.path);
  const sourcePhotoChanges = changedFiles.filter((path) => path.startsWith("apps/portfolio/assets/photos/"));
  const registeredIds = new Set([
    ...Array.from({ length: portfolioCatalog.photoCount }, (_, index) => index + 1),
    ...additions.photos.map(({ id }) => Number(id)),
  ]);
  const sourcePhotoId = (path) => {
    const match = path.match(/photo-(\d{3,})\.(?:jpg|webp)$/i);
    return match ? Number(match[1]) : null;
  };
  const dirtySlots = [...new Set(sourcePhotoChanges.flatMap((path) => {
    const id = sourcePhotoId(path);
    return id !== null && registeredIds.has(id) ? [id] : [];
  }))].sort((a, b) => a - b);
  const unrelatedFiles = changedFiles.filter((path) => !publishPrefixes.some((prefix) => path.startsWith(prefix))
    || (path.startsWith("apps/portfolio/assets/photos/") && !registeredIds.has(sourcePhotoId(path))));
  return {
    head,
    branch,
    dirtySlots,
    changedFiles,
    unrelatedFiles,
    buildVersion: await buildPortfolioVersion(),
  };
}

async function readPublicAdditions() {
  return loadPublicAdditions(additionsPath);
}

async function catalogPayload() {
  const [version, additions, draftState] = await Promise.all([
    buildPortfolioVersion(),
    readPublicAdditions(),
    draftStore.read(),
  ]);
  const items = buildPortfolioItems(portfolioCatalog, additions).map((item) => ({
    ...item,
    isHeroAsset: portfolioCatalog.heroAssetIds.includes(item.id),
    thumbUrl: `/media/thumb/${item.id}?v=${version}`,
    fullUrl: `/media/full/${item.id}?v=${version}`,
  }));
  const publicThemes = buildPortfolioThemes(portfolioCatalog, additions);
  const publicThemeIds = new Set(publicThemes.map(({ id }) => id));
  const themes = [
    ...publicThemes,
    ...draftState.themes.filter(({ id }) => !publicThemeIds.has(id)),
  ].map((theme) => {
    const result = {
      ...theme,
      count: items.filter((item) => item.theme === theme.id).length,
    };
    delete result.series;
    return result;
  });
  const drafts = draftState.photos.map((draft) => ({
    ...draft,
    thumbUrl: `/media/draft/thumb/${draft.uuid}?token=${sessionToken}`,
    fullUrl: `/media/draft/full/${draft.uuid}?token=${sessionToken}`,
  }));
  const counts = {
    public: items.length,
    draft: drafts.filter(({ status }) => status === "draft").length,
    ready: drafts.filter(({ status }) => status === "ready").length,
    published: drafts.filter(({ status }) => status === "published").length,
    archived: drafts.filter(({ status }) => status === "archived").length,
  };
  return {
    items,
    drafts,
    counts,
    scenes: portfolioCatalog.scenes,
    themes,
    photoCount: portfolioCatalog.photoCount,
    onlineUrl: onlinePortfolioUrl,
    version,
  };
}

function numericDraftId(url) {
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= portfolioCatalog.photoCount) throw new Error("草稿编号无效");
  return id;
}

function decodedUploadName(request) {
  try {
    return decodeURIComponent(String(request.headers["x-file-name"] || "未命名图片"));
  } catch {
    throw new Error("图片文件名无效");
  }
}

function requireSession(request) {
  const origin = String(request.headers.origin || "");
  const fetchSite = String(request.headers["sec-fetch-site"] || "");
  const allowedOrigins = new Set([`http://${host}:${requestedPort}`, `http://localhost:${requestedPort}`]);
  if ((origin && !allowedOrigins.has(origin)) || fetchSite === "cross-site") {
    const error = new Error("为保护本地客片，已拒绝其他网页发起的操作");
    error.status = 403;
    throw error;
  }
  if (request.headers["x-nanbo-token"] !== sessionToken) {
    const error = new Error("管理台会话已过期，请刷新页面后重试");
    error.status = 403;
    throw error;
  }
}

async function replacePhotoRequest(request, response, url) {
  requireSession(request);
  beginMutation("替换客片");
  try {
    await recoverIncompletePhotoTransactions();
    const id = Number(url.searchParams.get("id"));
    const originalName = decodeURIComponent(String(request.headers["x-file-name"] || "未命名图片"));
    const extension = extname(originalName).toLowerCase();
    const contentType = String(request.headers["content-type"] || "").split(";")[0];
    if (!allowedPhotoTypes.has(contentType) && !allowedPhotoExtensions.has(extension)) {
      throw new Error("只支持 JPG、PNG 或 WebP 图片");
    }
    const buffer = await readBody(request);
    const temporary = await writeUploadToTemporaryFile(buffer, allowedPhotoExtensions.has(extension) ? extension : ".jpg");
    try {
      const result = await replacePhoto(id, temporary.path, originalName);
      json(response, 200, { ok: true, result, status: await repositoryStatus() });
    } finally {
      await rm(temporary.directory, { recursive: true, force: true });
    }
  } finally {
    finishMutation();
  }
}

async function undoPhotoRequest(request, response, url) {
  requireSession(request);
  beginMutation("恢复客片");
  try {
    await recoverIncompletePhotoTransactions();
    const result = await undoLatestPhotoReplacement(Number(url.searchParams.get("id")));
    json(response, 200, { ok: true, result, status: await repositoryStatus() });
  } finally {
    finishMutation();
  }
}

async function draftUploadRequest(request, response) {
  requireSession(request);
  beginMutation("新增草稿");
  try {
    const originalName = decodedUploadName(request);
    const extension = extname(originalName).toLowerCase();
    const contentType = String(request.headers["content-type"] || "").split(";")[0];
    const buffer = await readBody(request);
    const temporary = await writeUploadToTemporaryFile(buffer, allowedPhotoExtensions.has(extension) ? extension : ".upload");
    try {
      const additions = await readPublicAdditions();
      const result = await ingestDraftPhoto({
        inputPath: temporary.path,
        originalName,
        contentType,
        store: draftStore,
        rootDir: configuredDraftRoot,
        publicIds: additions.photos.map(({ id }) => id),
      });
      json(response, 200, { ok: true, result, catalog: await catalogPayload() });
    } finally {
      await rm(temporary.directory, { recursive: true, force: true });
    }
  } finally {
    finishMutation();
  }
}

async function draftUpdateRequest(request, response, url) {
  requireSession(request);
  beginMutation("保存草稿");
  try {
    const id = numericDraftId(url);
    const patch = await readJsonBody(request);
    if (!patch || Array.isArray(patch) || typeof patch !== "object") throw new Error("草稿更新数据无效");
    const allowedKeys = new Set(["scene", "theme", "category", "approvedForPublicUse", "featured"]);
    const invalidKey = Object.keys(patch).find((key) => !allowedKeys.has(key));
    if (invalidKey) throw new Error(`不允许通过草稿更新修改 ${invalidKey}`);
    for (const key of ["scene", "theme", "category"]) {
      if (key in patch && typeof patch[key] !== "string") throw new Error(`草稿${key}必须是文本`);
    }
    for (const key of ["approvedForPublicUse", "featured"]) {
      if (key in patch && typeof patch[key] !== "boolean") throw new Error(`草稿${key}必须是布尔值`);
    }
    const [state, additions] = await Promise.all([draftStore.read(), readPublicAdditions()]);
    const current = state.photos.find((photo) => photo.id === id);
    if (!current) throw new Error(`找不到草稿 ${slotCode(id)}`);
    const next = { ...current, ...patch };
    const scenes = new Set(portfolioCatalog.scenes.filter(({ id: sceneId }) => sceneId !== "all").map(({ id: sceneId }) => sceneId));
    const categories = new Set(portfolioCatalog.categories.map(({ id: categoryId }) => categoryId));
    const themes = [...portfolioCatalog.themes, ...additions.themes, ...state.themes];
    if (next.scene && !scenes.has(next.scene)) throw new Error(`草稿场景 ${next.scene} 无效`);
    if (next.category && !categories.has(next.category)) throw new Error(`草稿风格 ${next.category} 无效`);
    const theme = next.theme ? themes.find(({ id: themeId }) => themeId === next.theme) : null;
    if (next.theme && !theme) throw new Error(`草稿主题 ${next.theme} 无效`);
    if (theme && next.scene && theme.scene !== next.scene) throw new Error(`草稿主题 ${next.theme} 与场景不一致`);
    const result = await draftStore.updatePhoto(id, patch);
    json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  } finally {
    finishMutation();
  }
}

async function draftTransitionRequest(request, response, url, nextStatus, label) {
  requireSession(request);
  beginMutation(label);
  try {
    const result = await draftStore.transitionPhoto(numericDraftId(url), nextStatus);
    json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  } finally {
    finishMutation();
  }
}

async function draftStageRequest(request, response, url) {
  requireSession(request);
  beginMutation("安装待公开客片");
  try {
    const result = await stageDraftForPublication(numericDraftId(url), publicationOptions);
    json(response, 200, { ok: true, result, catalog: await catalogPayload(), status: await repositoryStatus() });
  } finally {
    finishMutation();
  }
}

function stringLength(value) {
  return typeof value === "string" ? Array.from(value.trim()).length : 0;
}

async function draftThemeRequest(request, response) {
  requireSession(request);
  beginMutation("新建草稿主题");
  try {
    const body = await readJsonBody(request);
    const allowedKeys = new Set(["id", "label", "scene", "description"]);
    const extraKey = Object.keys(body).find((key) => !allowedKeys.has(key));
    if (extraKey) throw new Error(`不允许保存主题字段 ${extraKey}`);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const scene = typeof body.scene === "string" ? body.scene.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("主题英文标识只能使用小写字母、数字和中划线");
    if (stringLength(label) < 2 || stringLength(label) > 12) throw new Error("主题名称需要 2–12 个字符");
    if (!portfolioCatalog.scenes.some((item) => item.id === scene && item.id !== "all")) throw new Error("主题场景无效");
    if (stringLength(description) < 2 || stringLength(description) > 30) throw new Error("主题描述需要 2–30 个字符");
    const [draftState, additions] = await Promise.all([draftStore.read(), readPublicAdditions()]);
    const allThemes = [...portfolioCatalog.themes, ...additions.themes, ...draftState.themes];
    if (allThemes.some((theme) => theme.id === id)) throw new Error(`主题编号 ${id} 已存在`);
    if (allThemes.some((theme) => theme.label === label)) throw new Error(`主题名称 ${label} 已存在`);
    const result = await draftStore.addTheme({ id, label, scene, description });
    json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  } finally {
    finishMutation();
  }
}

async function publicVisibilityRequest(request, response, url) {
  requireSession(request);
  beginMutation("更新公开状态");
  try {
    const { visibility } = await readJsonBody(request);
    const id = numericDraftId(url);
    const result = await setPublishedPhotoVisibility(id, visibility, publicationOptions);
    const state = await draftStore.read();
    const draft = state.photos.find((photo) => photo.id === id);
    if (draft && visibility === "archived" && (draft.status === "ready" || draft.status === "published")) {
      await draftStore.transitionPhoto(id, "archived");
    } else if (draft && visibility === "published" && draft.status === "archived" && !draft.publishedCommit) {
      await draftStore.transitionPhoto(id, "draft");
      await draftStore.transitionPhoto(id, "ready");
    }
    json(response, 200, { ok: true, result, catalog: await catalogPayload(), status: await repositoryStatus() });
  } finally {
    finishMutation();
  }
}

async function markStagedDraftsPublished(commit) {
  const [state, additions] = await Promise.all([draftStore.read(), readPublicAdditions()]);
  const publishedIds = new Set(additions.photos.filter(({ visibility }) => visibility === "published").map(({ id }) => Number(id)));
  const ids = state.photos.filter((photo) => publishedIds.has(photo.id)
    && ((photo.status === "ready" && photo.stagedAt) || (photo.status === "archived" && photo.publishedCommit)))
    .map(({ id }) => id);
  if (ids.length) await draftStore.markPublished(ids, commit);
  return ids;
}

async function sourcePhotoFilesFromGit() {
  const { stdout } = await git(
    ["status", "--porcelain=v1", "--untracked-files=all", "--", "apps/portfolio/assets/photos", "apps/portfolio-v2/catalog-additions.json"],
    { preserveWhitespace: true },
  );
  if (!stdout) return [];
  return stdout.split("\n").filter(Boolean).map(parseStatusLine).map((item) => item.path);
}

async function publishPhotos(request, response) {
  requireSession(request);
  beginMutation("同步网站");
  try {
    await recoverIncompletePhotoTransactions();
    const validation = await validatePortfolioLibrary();
    if (!validation.ok) throw new Error(`发布前校验未通过：${validation.errors.join("；")}`);

    const statusBefore = await repositoryStatus();
    if (statusBefore.branch !== "main") throw new Error(`当前分支是 ${statusBefore.branch || "未知"}，请让 Codex 切回 main 再同步`);
    if (statusBefore.unrelatedFiles.length) {
      throw new Error(`发现其他未提交文件，已停止同步：${statusBefore.unrelatedFiles.slice(0, 5).join("、")}`);
    }
    const { stdout: stagedBefore } = await git(["diff", "--cached", "--name-only"]);
    if (stagedBefore) throw new Error("仓库里已有人工暂存的文件，为避免混在一起，请先让 Codex 处理");

    await git(["fetch", "--quiet", "origin", "main"]);
    const { stdout: divergence } = await git(["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
    const [ahead, behind] = divergence.split(/\s+/).map(Number);
    if (behind > 0) throw new Error("线上仓库有更新的内容，请先让 Codex 合并，系统没有强行覆盖");
    if (ahead > 0) throw new Error("本机有还未推送的代码提交，请先让 Codex 确认后再发布照片");

    const sourceFiles = await sourcePhotoFilesFromGit();
    if (!sourceFiles.length) {
      await markStagedDraftsPublished(statusBefore.head);
      json(response, 200, { ok: true, noChanges: true, message: "本地没有待同步的新照片", status: statusBefore });
      return;
    }
    const publicationMetadata = "apps/portfolio-v2/catalog-additions.json";
    const registeredItems = buildPortfolioItems(portfolioCatalog, await readPublicAdditions());
    const allowedSourceFiles = new Set(registeredItems.flatMap(({ id }) => [
      `apps/portfolio/assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
      `apps/portfolio/assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
    ]));
    allowedSourceFiles.add(publicationMetadata);
    for (const id of portfolioCatalog.heroAssetIds) {
      allowedSourceFiles.add(`apps/portfolio/assets/photos/featured/photo-${String(id).padStart(3, "0")}.webp`);
    }
    const invalidSourceFile = sourceFiles.find((path) => !allowedSourceFiles.has(path));
    if (invalidSourceFile) throw new Error(`未登记的照片文件不会发布：${invalidSourceFile}`);
    const changedPhotoFiles = sourceFiles.filter((path) => path !== publicationMetadata);
    const bundleValidation = validateChangedPhotoBundles(changedPhotoFiles);
    if (!bundleValidation.ok) {
      throw new Error(`同一编号的图片不完整，已停止发布：${bundleValidation.errors.join("；")}`);
    }
    const nonSourceChanges = statusBefore.changedFiles.filter((path) => !sourceFiles.includes(path));
    if (nonSourceChanges.length) throw new Error(`发布前存在非源图片改动：${nonSourceChanges.slice(0, 5).join("、")}`);

    await run(process.execPath, [join(root, "tools/export-github-pages.mjs")], { cwd: root });
    const version = await buildPortfolioVersion();
    const stagePaths = new Set([
      ...sourceFiles,
      publicationMetadata,
      "docs/projects/portfolio-v2/index.html",
      "docs/projects/portfolio-v2/app.js",
      "docs/projects/portfolio-v2/build.json",
      "docs/p/index.html",
      "docs/p/build.json",
    ]);
    for (const sourcePath of sourceFiles) {
      const suffix = relative("apps/portfolio", sourcePath);
      stagePaths.add(join("docs/projects/portfolio", suffix));
    }
    const statusAfterExport = await repositoryStatus();
    const unexpectedExport = statusAfterExport.changedFiles.filter((path) => !stagePaths.has(path));
    if (unexpectedExport.length) {
      throw new Error(`导出产生了超出客片范围的改动，已停止提交：${unexpectedExport.slice(0, 5).join("、")}`);
    }
    await git(["add", "--", ...stagePaths]);
    const { code: hasNoStagedDiff } = await git(["diff", "--cached", "--quiet"], { allowFailure: true });
    if (hasNoStagedDiff === 0) {
      await markStagedDraftsPublished(statusBefore.head);
      json(response, 200, { ok: true, noChanges: true, message: "生成结果与线上完全一致", status: await repositoryStatus() });
      return;
    }

    const slots = bundleValidation.slots;
    const summary = slots.length === 0
      ? "公开状态"
      : (slots.length <= 6 ? slots.map(slotCode).join("、") : `${slots.length} 张客片`);
    const { stdout: commitBeforePublish } = await git(["rev-parse", "HEAD"]);
    await git(["commit", "-m", `更新南铂客片 ${summary}`]);
    try {
      await git(["push", "origin", "main"]);
    } catch (pushError) {
      try {
        // 发布前已确认没有人工暂存或无关改动。这里只撤回本次
        // 未推送的提交，保留工作树中的公开清单和成套图片以便重试。
        await git(["reset", "--mixed", commitBeforePublish]);
      } catch (rollbackError) {
        throw new Error(`${pushError.message}；未推送提交恢复失败：${rollbackError.message}`);
      }
      throw pushError;
    }
    const { stdout: commit } = await git(["rev-parse", "--short", "HEAD"]);
    await markStagedDraftsPublished(commit);
    json(response, 200, {
      ok: true,
      published: true,
      commit,
      version,
      slots,
      onlineUrl: onlinePortfolioUrl,
      message: "GitHub 已接收，正在更新网站",
      status: await repositoryStatus(),
    });
  } finally {
    finishMutation();
  }
}

async function deployStatus(response, url) {
  const version = url.searchParams.get("version") || "";
  if (!version) throw new Error("缺少待验证的版本号");
  try {
    const checkUrl = `${onlinePortfolioUrl}build.json?check=${Date.now()}`;
    const onlineResponse = await fetch(checkUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!onlineResponse.ok) throw new Error(`HTTP ${onlineResponse.status}`);
    const online = await onlineResponse.json();
    json(response, 200, {
      ok: true,
      ready: online.version === version,
      expectedVersion: version,
      onlineVersion: online.version || "",
      onlineUrl: onlinePortfolioUrl,
    });
  } catch (error) {
    json(response, 200, { ok: true, ready: false, expectedVersion: version, onlineVersion: "", waitingReason: error.message });
  }
}

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${host}:${requestedPort}`);
  try {
    if (!allowedHosts.has(String(request.headers.host || ""))) {
      const error = new Error("已拒绝非本机地址访问");
      error.status = 403;
      throw error;
    }
    if (!serverReady) {
      const error = new Error("正在检查上次换图状态，请稍后刷新");
      error.status = 503;
      throw error;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      json(response, 200, { ok: true, token: sessionToken });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/catalog") {
      json(response, 200, { ok: true, ...(await catalogPayload()) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      json(response, 200, { ok: true, ...(await repositoryStatus()) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/replace") {
      await replacePhotoRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/undo") {
      await undoPhotoRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/drafts/upload") {
      await draftUploadRequest(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/drafts/update") {
      await draftUpdateRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/drafts/ready") {
      await draftTransitionRequest(request, response, url, "ready", "准备公开草稿");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/drafts/archive") {
      await draftTransitionRequest(request, response, url, "archived", "归档草稿");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/drafts/restore") {
      await draftTransitionRequest(request, response, url, "draft", "恢复草稿");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/drafts/stage") {
      await draftStageRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/draft-themes") {
      await draftThemeRequest(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/public/visibility") {
      await publicVisibilityRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/publish") {
      await publishPhotos(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/deploy-status") {
      await deployStatus(response, url);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/media/draft/")) {
      if (url.searchParams.get("token") !== sessionToken) {
        const error = new Error("草稿预览会话已过期，请刷新页面后重试");
        error.status = 403;
        throw error;
      }
      const match = url.pathname.match(/^\/media\/draft\/(full|thumb)\/([0-9a-f]{24})$/);
      if (!match) throw new Error("草稿图片路径无效");
      const directory = join(configuredDraftRoot, "assets", match[1] === "full" ? "full" : "thumbs");
      const extension = match[1] === "full" ? ".jpg" : ".webp";
      await sendFile(response, join(directory, `${match[2]}${extension}`), "no-store", [directory]);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const match = url.pathname.match(/^\/media\/(thumb|full)\/(\d+)$/);
      if (!match) throw new Error("客片路径无效");
      const id = Number(match[2]);
      const additions = await readPublicAdditions();
      const registered = id >= 1 && (id <= portfolioCatalog.photoCount || additions.photos.some((photo) => Number(photo.id) === id));
      if (!registered) {
        notFound(response);
        return;
      }
      const directory = join(publicPhotoRoot, match[1] === "thumb" ? "thumbs" : "full");
      const filename = `photo-${String(id).padStart(3, "0")}${match[1] === "thumb" ? ".webp" : ".jpg"}`;
      await sendFile(response, join(directory, filename), "no-cache", [directory]);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/preview")) {
      const requested = url.pathname.replace(/^\/preview\/?/, "") || "index.html";
      await sendFile(response, safePath(previewRoot, requested), "no-cache");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/portfolio/")) {
      const requested = url.pathname.replace(/^\/portfolio\/?/, "");
      await sendFile(response, safePath(sharedPortfolioRoot, requested), "no-cache");
      return;
    }
    if (request.method === "GET") {
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      await sendFile(response, safePath(managerRoot, requested), "no-store");
      return;
    }
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("不支持这个操作");
  } catch (error) {
    errorJson(response, error, error.status || 400);
  }
}

const server = createServer(route);
server.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    const url = `http://${host}:${requestedPort}/`;
    try {
      const existing = await fetch(`${url}api/catalog`, { signal: AbortSignal.timeout(2500) });
      const payload = await existing.json();
      if (!payload.ok || payload.photoCount !== portfolioCatalog.photoCount) throw new Error("不是南铂客片管理台");
      console.log(`南铂客片管理台已在运行：${url}`);
      if (process.argv.includes("--open")) spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" }).unref();
      process.exit(0);
    } catch {
      console.error(`本机端口 ${requestedPort} 已被其他程序使用，请把这句话复制给 Codex 处理。`);
      process.exit(1);
    }
  }
  throw error;
});
server.listen(requestedPort, host, async () => {
  const url = `http://${host}:${requestedPort}/`;
  try {
    // 只有成功绑定端口的单一进程才允许检查事务目录。第二次双击会先走
    // EADDRINUSE，不会把第一个进程的正在换图误当成崩溃恢复。
    const [recoveredPhotoTransactions, recoveredPublicationTransactions] = await Promise.all([
      recoverIncompletePhotoTransactions(),
      recoverIncompletePublicationTransactions(publicationOptions),
    ]);
    if (recoveredPhotoTransactions.length) {
      console.log(`已自动恢复中断的换图：${recoveredPhotoTransactions.join("、")}`);
    }
    if (recoveredPublicationTransactions.length) {
      console.log(`已自动恢复中断的客片公开：${recoveredPublicationTransactions.join("、")}`);
    }
    serverReady = true;
    console.log(`南铂客片管理台：${url}`);
    console.log("保持这个窗口开启；结束时可直接关闭窗口。");
    if (process.argv.includes("--open")) spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch (error) {
    console.error(`客片安全检查未完成：${error.message}`);
    server.close(() => process.exit(1));
  }
});

import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import {
  buildPortfolioItems,
  buildPortfolioThemes,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import {
  normalizeStyleAssignments,
  normalizeStyleCatalog,
} from "../apps/portfolio-v2/style-library.js";
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
  createPortfolioPhotoStore,
  onlinePortfolioUrl,
  recoverIncompletePhotoTransactions,
  root,
  run,
  slotCode,
  sourcePhotoRoot,
  validateChangedPhotoBundles,
  validatePortfolioLibrary,
  writeUploadToTemporaryFile,
} from "./portfolio-photo-lib.mjs";
import { toApiErrorPayload } from "./portfolio-manager-api-errors.mjs";

const host = "127.0.0.1";
const requestedPort = Number(process.env.NANBO_PORTFOLIO_PORT || 4174);
let activePort = requestedPort;
const managerRoot = join(root, "tools/portfolio-manager");
const previewRoot = join(root, "apps/portfolio-v2");
const sharedPortfolioRoot = join(root, "apps/portfolio");
const configuredDraftRoot = process.env.NANBO_PORTFOLIO_DRAFT_ROOT || draftRoot;
const additionsPath = process.env.NANBO_PORTFOLIO_ADDITIONS_PATH || join(root, "apps/portfolio-v2/catalog-additions.json");
const publicPhotoRoot = process.env.NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT || sourcePhotoRoot;
const hasConfiguredStyleRoot = Boolean(process.env.NANBO_PORTFOLIO_STYLE_ROOT);
const configuredStyleRoot = process.env.NANBO_PORTFOLIO_STYLE_ROOT || root;
const styleAdditionsPath = hasConfiguredStyleRoot
  ? additionsPath
  : join(root, "apps/portfolio-v2/catalog-additions.json");
const stylePhotoRoot = hasConfiguredStyleRoot ? publicPhotoRoot : sourcePhotoRoot;
const styleCatalogPath = process.env.NANBO_PORTFOLIO_STYLE_CATALOG_PATH || join(root, "apps/portfolio-v2/style-catalog.json");
const styleAssignmentsPath = process.env.NANBO_PORTFOLIO_STYLE_ASSIGNMENTS_PATH || join(root, "apps/portfolio-v2/style-slot-assignments.json");
const configuredFixtureRoot = process.env.NANBO_PORTFOLIO_FIXTURE_ROOT || "";
const photoStore = createPortfolioPhotoStore({
  photoRoot: publicPhotoRoot,
  localStateRoot: join(configuredFixtureRoot || root, ".local"),
});
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
let styleStore = null;
const styleStoreModuleUrl = new URL("./portfolio-style-store.mjs", import.meta.url);

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
  "docs/projects/portfolio/assets/photos/",
  "docs/projects/portfolio-v2/",
  "docs/p/",
];
const publicationStyleFilenames = [
  "style-catalog.json",
  "style-slot-assignments.json",
  "style-library.js",
  "style-explorer-model.js",
  "style-preferences.js",
  "style-explorer.js",
];
const publicationStyleSourcePaths = publicationStyleFilenames.map((name) => `apps/portfolio-v2/${name}`);
const publicationMutableStyleSourcePaths = new Set(publicationStyleSourcePaths.slice(0, 2));
const publicationStylePublishedPaths = publicationStyleFilenames.map((name) => `docs/projects/portfolio-v2/${name}`);
const publishExactPaths = new Set([
  "apps/portfolio-v2/catalog-additions.json",
  ...publicationMutableStyleSourcePaths,
  "docs/i/index.html",
]);
const publicationMetadata = "apps/portfolio-v2/catalog-additions.json";
function allowedLocalHosts() {
  return new Set([`${host}:${activePort}`, `localhost:${activePort}`]);
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function apiError(code, message, status = 400) {
  const error = new Error(message);
  error.apiCode = code;
  error.status = status;
  return error;
}

function errorJson(response, error, status = 400) {
  const payload = toApiErrorPayload(error, status);
  json(response, payload.status, payload.body);
}

function beginMutation(label) {
  if (activeMutation) throw apiError("MUTATION_BUSY", "管理台正在执行其他修改，请稍后重试", 409);
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
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const rawLength = String(declaredLength);
    if (!/^(?:0|[1-9]\d*)$/.test(rawLength) || !Number.isSafeInteger(Number(rawLength))) {
      throw apiError("INVALID_CONTENT_LENGTH", "请求长度无效");
    }
    if (Number(rawLength) > uploadLimit) {
      throw apiError("PAYLOAD_TOO_LARGE", "图片超过 50 MB，请先导出精修 JPG", 413);
    }
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > uploadLimit) {
        throw apiError("PAYLOAD_TOO_LARGE", "图片超过 50 MB，请先导出精修 JPG", 413);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error?.apiCode) throw error;
    if (request.aborted || new Set(["ABORT_ERR", "ECONNRESET"]).has(error?.code)) {
      throw apiError("REQUEST_ABORTED", "上传已中断");
    }
    throw error;
  }
  if (!size) throw apiError("EMPTY_BODY", "请先选择要替换的图片");
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const content = await readBody(request);
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    throw apiError("INVALID_JSON", "提交的数据不是有效 JSON");
  }
}

async function git(args, options = {}) {
  return run("git", args, { cwd: root, ...options });
}

async function restoreGeneratedPaths(paths, commit) {
  const tracked = [];
  for (const path of paths) {
    const { code } = await git(["cat-file", "-e", `${commit}:${path}`], { allowFailure: true });
    if (code === 0) tracked.push(path);
    else await rm(join(root, path), { recursive: true, force: true });
  }
  if (tracked.length) await git(["restore", `--source=${commit}`, "--worktree", "--", ...tracked]);
}

function parseStatusLine(line) {
  const path = line.slice(3).trim().split(" -> ").at(-1);
  return { state: line.slice(0, 2), path };
}

function isPendingDraftReconciliation(photo, publishedIds) {
  return publishedIds.has(photo.id)
    && ((photo.status === "ready" && photo.stagedAt)
      || (photo.status === "archived" && photo.publishedCommit));
}

async function repositoryStatus() {
  const [{ stdout: porcelain }, { stdout: head }, { stdout: branch }, additions, draftState] = await Promise.all([
    git(["status", "--porcelain=v1", "--untracked-files=all"], { preserveWhitespace: true }),
    git(["rev-parse", "--short", "HEAD"]),
    git(["branch", "--show-current"]),
    readPublicAdditions(),
    draftStore.read(),
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
  const publishedAdditionIds = new Set(additions.photos
    .filter(({ visibility }) => visibility === "published")
    .map(({ id }) => Number(id)));
  const pendingReconciliationIds = draftState.photos
    .filter((photo) => isPendingDraftReconciliation(photo, publishedAdditionIds))
    .map(({ id }) => id)
    .sort((a, b) => a - b);
  const publishableSourceChanges = changedFiles.filter((path) => path === publicationMetadata
    || publicationMutableStyleSourcePaths.has(path)
    || (path.startsWith("apps/portfolio/assets/photos/") && registeredIds.has(sourcePhotoId(path))));
  const pendingPublicationIds = [...new Set([...dirtySlots, ...pendingReconciliationIds])].sort((a, b) => a - b);
  const hasPendingPublication = publishableSourceChanges.length > 0 || pendingReconciliationIds.length > 0;
  const unrelatedFiles = changedFiles.filter((path) => !(publishExactPaths.has(path)
    || publishPrefixes.some((prefix) => path.startsWith(prefix)))
    || (path.startsWith("apps/portfolio/assets/photos/") && !registeredIds.has(sourcePhotoId(path))));
  return {
    head,
    branch,
    dirtySlots,
    pendingPublicationIds,
    pendingPublicationCount: pendingPublicationIds.length,
    hasPendingPublication,
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

async function isExplicitIsolatedFixture() {
  if (requestedPort !== 0 || !configuredFixtureRoot) return false;
  try {
    const [fixtureRoot, temporaryRoot, ...configuredPaths] = await Promise.all([
      realpath(configuredFixtureRoot),
      realpath(tmpdir()),
      ...[
        configuredDraftRoot,
        additionsPath,
        publicPhotoRoot,
        configuredStyleRoot,
      ].map((path) => realpath(path)),
    ]);
    return isPathInside(temporaryRoot, fixtureRoot)
      && configuredPaths.every((path) => isPathInside(fixtureRoot, path));
  } catch {
    return false;
  }
}

async function loadStyleStoreFactory({ isolatedFixture }) {
  try {
    const { createPortfolioStyleStore } = await import(styleStoreModuleUrl.href);
    return createPortfolioStyleStore;
  } catch (error) {
    if (isolatedFixture && error?.code === "ERR_MODULE_NOT_FOUND" && error?.url === styleStoreModuleUrl.href) {
      return null;
    }
    throw error;
  }
}

async function initializeStyleStore(createPortfolioStyleStore) {
  if (!createPortfolioStyleStore) return null;
  const store = createPortfolioStyleStore({
    rootDir: configuredStyleRoot,
    photoRoot: stylePhotoRoot,
    additionsPath: styleAdditionsPath,
    catalogPath: styleCatalogPath,
    assignmentsPath: styleAssignmentsPath,
  });
  await store.read();
  return store;
}

function requireStyleStore() {
  if (!styleStore) throw apiError("STYLE_LIBRARY_UNAVAILABLE", "风格库尚未完成安全检查", 503);
  return styleStore;
}

function styleVersion(state) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    additions: state.additions,
    assignments: state.assignments,
    catalog: state.catalog,
  }));
  return `style-${hash.digest("hex").slice(0, 12)}`;
}

function safeStyleFamily(family) {
  return {
    id: family.id,
    scene: family.scene,
    label: family.label,
    description: family.description,
    order: family.order,
  };
}

function safeManagedStyle(style) {
  return {
    id: style.id,
    familyId: style.familyId,
    scene: style.scene,
    label: style.label,
    audience: style.audience,
    description: style.description,
    order: style.order,
    visibility: style.visibility,
    maturity: style.maturity,
    completeEligible: style.completeEligible === true,
    coverSlotId: style.slots.find(({ isCover }) => isCover)?.id || "",
    slots: style.slots.map((slot) => ({
      id: slot.id,
      styleId: slot.styleId,
      position: slot.position,
      assetId: slot.assetId,
      poseLabel: slot.poseLabel,
      source: slot.source,
      updatedAt: slot.updatedAt,
      isCover: slot.isCover,
    })),
  };
}

function syncAssets(additions) {
  return buildPortfolioItems(portfolioCatalog, additions).map((photo) => {
    const filename = `photo-${String(photo.id).padStart(3, "0")}`;
    return {
      ...photo,
      thumb: `../portfolio/assets/photos/thumbs/${filename}.webp`,
      full: `../portfolio/assets/photos/full/${filename}.jpg`,
    };
  });
}

function styleSyncSignature({ catalog, assignments, additions }, styleId) {
  const style = catalog.styles.find(({ id }) => id === styleId);
  const family = catalog.families.find(({ id }) => id === style?.familyId);
  const assignment = assignments.assignments[styleId];
  const additionsById = new Map(additions.photos.map((photo) => [photo.id, photo]));
  return JSON.stringify({
    family,
    style,
    featured: catalog.featuredStyleIds.includes(styleId),
    assignment,
    additions: assignment.slots
      .map(({ assetId }) => additionsById.get(assetId))
      .filter(Boolean),
  });
}

async function styleSyncStatus(state) {
  const publicRoot = join(configuredStyleRoot, "docs/projects/portfolio-v2");
  try {
    const [rawCatalog, rawAssignments, rawAdditions] = await Promise.all([
      readFile(join(publicRoot, "style-catalog.json"), "utf8").then(JSON.parse),
      readFile(join(publicRoot, "style-slot-assignments.json"), "utf8").then(JSON.parse),
      readFile(join(publicRoot, "catalog-additions.json"), "utf8").then(JSON.parse),
    ]);
    const catalog = normalizeStyleCatalog(rawCatalog);
    const additions = normalizePortfolioAdditions(rawAdditions);
    const assets = syncAssets(additions);
    const assignments = normalizeStyleAssignments(
      rawAssignments,
      catalog,
      new Map(assets.map((asset) => [asset.id, asset])),
    );
    const published = { additions, assignments, catalog };
    const pendingCount = state.catalog.styles.reduce((count, { id }) => count
      + Number(styleSyncSignature(state, id) !== styleSyncSignature(published, id)), 0);
    return {
      pendingCount,
      syncStatus: {
        available: true,
        label: "待同步风格",
        message: pendingCount
          ? `有 ${pendingCount} 个风格尚未同步到静态公开副本`
          : "静态公开副本与本机风格资料一致",
      },
    };
  } catch {
    return {
      pendingCount: state.catalog.styles.length,
      syncStatus: {
        available: false,
        label: "待同步风格",
        message: "静态公开副本缺失或无法校验，请重新导出",
      },
    };
  }
}

async function styleLibraryPayload() {
  let state;
  try {
    state = await requireStyleStore().read();
  } catch (error) {
    if (error?.apiCode) throw error;
    throw apiError("STYLE_LIBRARY_UNAVAILABLE", "风格库暂时无法读取，请稍后重试", 500);
  }
  const sync = await styleSyncStatus(state);
  return {
    counts: { ...state.counts },
    families: state.families.map(safeStyleFamily),
    styles: state.styles.map(safeManagedStyle),
    ...sync,
    version: styleVersion(state),
  };
}

function exactQueryValue(url, name, code, message) {
  const keys = [...url.searchParams.keys()];
  const values = url.searchParams.getAll(name);
  if (keys.length !== 1 || keys[0] !== name || values.length !== 1 || !values[0]) {
    throw apiError(code, message);
  }
  return values[0];
}

function assertNoQuery(url, code, message) {
  if ([...url.searchParams.keys()].length) throw apiError(code, message);
}

function exactJsonObject(input, requiredKeys, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw apiError("INVALID_JSON_BODY", `${label}数据必须是对象`);
  }
  const allowed = new Set(requiredKeys);
  const extraKey = Object.keys(input).find((key) => !allowed.has(key));
  if (extraKey) throw apiError("INVALID_JSON_BODY", `${label}不允许字段 ${extraKey}`);
  const missingKey = requiredKeys.find((key) => !Object.hasOwn(input, key));
  if (missingKey) throw apiError("INVALID_JSON_BODY", `${label}缺少字段 ${missingKey}`);
  return input;
}

function strictAssetId(url) {
  const value = exactQueryValue(url, "id", "INVALID_ASSET_ID", "资产编号无效");
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw apiError("INVALID_ASSET_ID", "资产编号无效");
  }
  return Number(value);
}

function requireStyleId(value) {
  if (typeof value !== "string" || !/^ST-(?:IN|OUT)-0[1-6]-(?:0[1-9]|1[01])$/.test(value)) {
    throw apiError("INVALID_STYLE_ID", "风格编号无效");
  }
  return value;
}

function requireStyleSlotId(value) {
  if (typeof value !== "string" || !/^ST-(?:IN|OUT)-0[1-6]-(?:0[1-9]|1[01])-P0[1-9]$/.test(value)) {
    throw apiError("INVALID_SLOT_ID", "照片位编号无效");
  }
  return value;
}

async function assetReferencesPayload(url) {
  const assetId = strictAssetId(url);
  let state;
  try {
    state = await requireStyleStore().read();
  } catch (error) {
    if (error?.apiCode) throw error;
    throw apiError("STYLE_LIBRARY_UNAVAILABLE", "风格库暂时无法读取，请稍后重试", 500);
  }
  if (!state.assetById[assetId]) throw apiError("ASSET_NOT_FOUND", "资产不存在", 404);
  const affected = state.slots.filter((slot) => slot.assetId === assetId);
  return {
    assetId,
    slotIds: affected.map(({ id }) => id),
    styleIds: [...new Set(affected.map(({ styleId }) => styleId))],
    count: affected.length,
  };
}

function styleOperationError(error) {
  if (error?.apiCode) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ffprobe failed|Invalid data found|moov atom/i.test(message)) {
    return apiError("INVALID_IMAGE", "上传的文件不是可读取的 JPG、PNG 或 WebP 图片");
  }
  if (/不存在|已处理|已经暂存|过期|重复|没有更早|必须|格式无效|不允许字段|缺少|只支持|图片只有|图片比例|可见性|成熟度|操作编号|重试内容|不一致/.test(message)) {
    return apiError("STYLE_VALIDATION_FAILED", message);
  }
  return apiError("STYLE_OPERATION_FAILED", "风格操作未完成，请稍后重试", 500);
}

function styleOperationId(request) {
  const value = request.headers["x-nanbo-operation-id"];
  if (value === undefined) return null;
  if (typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw apiError("INVALID_OPERATION_ID", "操作编号格式无效");
  }
  return value;
}

async function runStyleMutation(response, label, operation) {
  beginMutation(label);
  try {
    const result = await operation();
    json(response, 200, { ok: true, result });
  } catch (error) {
    throw styleOperationError(error);
  } finally {
    finishMutation();
  }
}

function decodedStyleUploadName(request) {
  const rawName = request.headers["x-file-name"];
  if (typeof rawName !== "string" || !rawName) throw apiError("INVALID_FILE_NAME", "缺少图片文件名");
  let decoded;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    throw apiError("INVALID_FILE_NAME", "图片文件名无效");
  }
  const name = decoded.replaceAll("\\", "/").split("/").at(-1)?.trim() || "";
  if (!name || Array.from(name).length > 255) throw apiError("INVALID_FILE_NAME", "图片文件名无效");
  return name;
}

async function replaceStyleSlotRequest(request, response, url) {
  await runStyleMutation(response, "替换风格照片位", async () => {
    const operationId = styleOperationId(request);
    const slotId = requireStyleSlotId(exactQueryValue(url, "slot", "INVALID_SLOT_ID", "照片位编号无效"));
    const originalName = decodedStyleUploadName(request);
    const extension = extname(originalName).toLowerCase();
    const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!allowedPhotoTypes.has(contentType) && !allowedPhotoExtensions.has(extension)) {
      throw apiError("UNSUPPORTED_MEDIA_TYPE", "只支持 JPG、PNG 或 WebP 图片", 415);
    }
    const buffer = await readBody(request);
    const temporary = await writeUploadToTemporaryFile(buffer, allowedPhotoExtensions.has(extension) ? extension : ".upload");
    try {
      return await requireStyleStore().replaceSlot({ slotId, inputPath: temporary.path, originalName, operationId });
    } finally {
      await rm(temporary.directory, { recursive: true, force: true });
    }
  });
}

async function undoStyleSlotRequest(request, response, url) {
  await runStyleMutation(response, "恢复风格照片位", () => {
    const operationId = styleOperationId(request);
    if (!operationId) throw apiError("INVALID_OPERATION_ID", "缺少操作编号");
    const slotId = requireStyleSlotId(exactQueryValue(url, "slot", "INVALID_SLOT_ID", "照片位编号无效"));
    return requireStyleStore().undoSlot({ slotId, operationId });
  });
}

async function updateStyleSlotMetaRequest(request, response, url) {
  await runStyleMutation(response, "保存照片位资料", async () => {
    assertNoQuery(url, "INVALID_SLOT_ID", "照片位接口不接受查询参数");
    const input = await readJsonBody(request);
    requireStyleSlotId(input?.slotId);
    return requireStyleStore().updateSlotMeta(input);
  });
}

async function updateStyleLayoutRequest(request, response, url) {
  await runStyleMutation(response, "保存风格布局", async () => {
    assertNoQuery(url, "INVALID_STYLE_ID", "风格布局接口不接受查询参数");
    const input = await readJsonBody(request);
    requireStyleId(input?.styleId);
    if (Array.isArray(input?.orderedSlotIds)) input.orderedSlotIds.forEach(requireStyleSlotId);
    if (input?.coverSlotId !== undefined) requireStyleSlotId(input.coverSlotId);
    return requireStyleStore().updateLayout(input);
  });
}

async function updateStyleMetaRequest(request, response, url) {
  await runStyleMutation(response, "保存风格资料", async () => {
    assertNoQuery(url, "INVALID_STYLE_ID", "风格资料接口不接受查询参数");
    const input = await readJsonBody(request);
    requireStyleId(input?.styleId);
    return requireStyleStore().updateStyleMeta(input);
  });
}

function requireBatchId(value) {
  if (typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw apiError("INVALID_BATCH_ID", "整组暂存编号无效");
  }
  return value;
}

function styleBatchPath(pathname) {
  const file = pathname.match(/^\/api\/style-batches\/([^/]+)\/files\/([^/]+)$/);
  if (file) {
    const batchId = requireBatchId(file[1]);
    if (!/^[1-9]$/.test(file[2])) throw apiError("INVALID_BATCH_POSITION", "整组照片位置必须在 1–9 之间");
    return { kind: "file", batchId, position: Number(file[2]) };
  }
  const commit = pathname.match(/^\/api\/style-batches\/([^/]+)\/commit$/);
  if (commit) return { kind: "commit", batchId: requireBatchId(commit[1]) };
  const batch = pathname.match(/^\/api\/style-batches\/([^/]+)$/);
  if (batch) return { kind: "batch", batchId: requireBatchId(batch[1]) };
  return null;
}

async function createStyleBatchRequest(response, url) {
  await runStyleMutation(response, "新建整组换图", async () => {
    assertNoQuery(url, "INVALID_BATCH_ID", "整组暂存接口不接受查询参数");
    return { batchId: await requireStyleStore().createBatch() };
  });
}

async function stageStyleBatchFileRequest(request, response, url, routeMatch) {
  await runStyleMutation(response, `暂存整组第 ${routeMatch.position} 张`, async () => {
    const operationId = styleOperationId(request);
    assertNoQuery(url, "INVALID_BATCH_POSITION", "整组照片接口不接受查询参数");
    const originalName = decodedStyleUploadName(request);
    const extension = extname(originalName).toLowerCase();
    const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!allowedPhotoTypes.has(contentType) && !allowedPhotoExtensions.has(extension)) {
      throw apiError("UNSUPPORTED_MEDIA_TYPE", "只支持 JPG、PNG 或 WebP 图片", 415);
    }
    const buffer = await readBody(request);
    const temporary = await writeUploadToTemporaryFile(buffer, allowedPhotoExtensions.has(extension) ? extension : ".upload");
    try {
      return await requireStyleStore().stageBatchFile(routeMatch.batchId, routeMatch.position, temporary.path, {
        operationId,
        originalName,
      });
    } finally {
      await rm(temporary.directory, { recursive: true, force: true });
    }
  });
}

async function commitStyleBatchRequest(request, response, url, routeMatch) {
  await runStyleMutation(response, "提交整组换图", async () => {
    const operationId = styleOperationId(request);
    assertNoQuery(url, "INVALID_BATCH_ID", "整组提交接口不接受查询参数");
    const input = exactJsonObject(await readJsonBody(request), ["styleId", "orderedPositions"], "整组提交");
    requireStyleId(input?.styleId);
    return requireStyleStore().commitBatch({ ...input, batchId: routeMatch.batchId, operationId });
  });
}

async function discardStyleBatchRequest(response, url, routeMatch) {
  await runStyleMutation(response, "放弃整组换图", async () => {
    assertNoQuery(url, "INVALID_BATCH_ID", "整组放弃接口不接受查询参数");
    return requireStyleStore().discardBatch(routeMatch.batchId);
  });
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
  if (request.headers["x-nanbo-token"] !== sessionToken) {
    throw apiError("AUTH_REQUIRED", "管理台会话已过期，请刷新页面后重试", 403);
  }
  const allowedOrigins = new Set([`http://${host}:${activePort}`, `http://localhost:${activePort}`]);
  if (!allowedOrigins.has(String(request.headers.origin || ""))) {
    throw apiError("ORIGIN_FORBIDDEN", "为保护本地客片，已拒绝其他网页发起的操作", 403);
  }
}

async function replacePhotoRequest(request, response, url) {
  beginMutation("替换客片");
  try {
    await photoStore.recoverIncompletePhotoTransactions();
    const operationId = styleOperationId(request);
    if (!operationId) throw apiError("INVALID_OPERATION_ID", "缺少操作编号");
    const id = Number(url.searchParams.get("id"));
    const originalName = decodeURIComponent(String(request.headers["x-file-name"] || "未命名图片"));
    const extension = extname(originalName).toLowerCase();
    const contentType = String(request.headers["content-type"] || "").split(";")[0];
    if (!allowedPhotoTypes.has(contentType) && !allowedPhotoExtensions.has(extension)) {
      throw apiError("BAD_REQUEST", "只支持 JPG、PNG 或 WebP 图片");
    }
    const buffer = await readBody(request);
    const temporary = await writeUploadToTemporaryFile(buffer, allowedPhotoExtensions.has(extension) ? extension : ".jpg");
    try {
      const result = await photoStore.replacePhoto({ id, inputPath: temporary.path, originalName, operationId });
      json(response, 200, { ok: true, result, status: await repositoryStatus() });
    } finally {
      await rm(temporary.directory, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.message === "操作编号与重试内容或当前客片状态不一致") {
      throw apiError("OPERATION_MISMATCH", error.message);
    }
    throw error;
  } finally {
    finishMutation();
  }
}

async function undoPhotoRequest(request, response, url) {
  beginMutation("恢复客片");
  try {
    await photoStore.recoverIncompletePhotoTransactions();
    const operationId = styleOperationId(request);
    if (!operationId) throw apiError("INVALID_OPERATION_ID", "缺少操作编号");
    const result = await photoStore.undoLatestPhotoReplacement({ id: Number(url.searchParams.get("id")), operationId });
    json(response, 200, { ok: true, result, status: await repositoryStatus() });
  } catch (error) {
    if (error?.message === "操作编号与重试内容或当前客片状态不一致") {
      throw apiError("OPERATION_MISMATCH", error.message);
    }
    throw error;
  } finally {
    finishMutation();
  }
}

async function draftUploadRequest(request, response) {
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
  } catch (error) {
    if (/^图片实际格式 .+ 与 .+ 扩展名不一致$/.test(error?.message || "")) {
      throw apiError("BAD_REQUEST", "图片格式与文件名不一致");
    }
    throw error;
  } finally {
    finishMutation();
  }
}

async function draftUpdateRequest(request, response, url) {
  beginMutation("保存草稿");
  try {
    const id = numericDraftId(url);
    const patch = await readJsonBody(request);
    if (!patch || Array.isArray(patch) || typeof patch !== "object") throw apiError("BAD_REQUEST", "草稿更新数据无效");
    const allowedKeys = new Set(["scene", "theme", "category", "approvedForPublicUse", "featured"]);
    const invalidKey = Object.keys(patch).find((key) => !allowedKeys.has(key));
    if (invalidKey) throw apiError("BAD_REQUEST", "草稿更新字段无效");
    for (const key of ["scene", "theme", "category"]) {
      if (key in patch && typeof patch[key] !== "string") throw apiError("BAD_REQUEST", "草稿更新字段类型无效");
    }
    for (const key of ["approvedForPublicUse", "featured"]) {
      if (key in patch && typeof patch[key] !== "boolean") throw apiError("BAD_REQUEST", "草稿更新字段类型无效");
    }
    const [state, additions] = await Promise.all([draftStore.read(), readPublicAdditions()]);
    const current = state.photos.find((photo) => photo.id === id);
    if (!current) throw apiError("BAD_REQUEST", "找不到对应草稿");
    const next = { ...current, ...patch };
    const scenes = new Set(portfolioCatalog.scenes.filter(({ id: sceneId }) => sceneId !== "all").map(({ id: sceneId }) => sceneId));
    const categories = new Set(portfolioCatalog.categories.map(({ id: categoryId }) => categoryId));
    const themes = [...portfolioCatalog.themes, ...additions.themes, ...state.themes];
    if (next.scene && !scenes.has(next.scene)) throw apiError("BAD_REQUEST", "草稿场景无效");
    if (next.category && !categories.has(next.category)) throw apiError("BAD_REQUEST", "草稿风格无效");
    const theme = next.theme ? themes.find(({ id: themeId }) => themeId === next.theme) : null;
    if (next.theme && !theme) throw apiError("BAD_REQUEST", "草稿主题无效");
    if (theme && next.scene && theme.scene !== next.scene) throw apiError("BAD_REQUEST", "草稿主题与场景不一致");
    const result = await draftStore.updatePhoto(id, patch);
    json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  } finally {
    finishMutation();
  }
}

async function draftTransitionRequest(request, response, url, nextStatus, label) {
  beginMutation(label);
  try {
    const result = await draftStore.transitionPhoto(numericDraftId(url), nextStatus);
    json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  } finally {
    finishMutation();
  }
}

async function draftStageRequest(request, response, url) {
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
  beginMutation("新建草稿主题");
  try {
    const body = await readJsonBody(request);
    const allowedKeys = new Set(["id", "label", "scene", "description"]);
    const extraKey = Object.keys(body).find((key) => !allowedKeys.has(key));
    if (extraKey) throw apiError("BAD_REQUEST", "主题字段无效");
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const scene = typeof body.scene === "string" ? body.scene.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw apiError("BAD_REQUEST", "主题英文标识只能使用小写字母、数字和中划线");
    if (stringLength(label) < 2 || stringLength(label) > 12) throw apiError("BAD_REQUEST", "主题名称需要 2–12 个字符");
    if (!portfolioCatalog.scenes.some((item) => item.id === scene && item.id !== "all")) throw apiError("BAD_REQUEST", "主题场景无效");
    if (stringLength(description) < 2 || stringLength(description) > 30) throw apiError("BAD_REQUEST", "主题描述需要 2–30 个字符");
    const [draftState, additions] = await Promise.all([draftStore.read(), readPublicAdditions()]);
    const allThemes = [...portfolioCatalog.themes, ...additions.themes, ...draftState.themes];
    if (allThemes.some((theme) => theme.id === id)) throw apiError("BAD_REQUEST", "主题编号已存在");
    if (allThemes.some((theme) => theme.label === label)) throw apiError("BAD_REQUEST", "主题名称已存在");
    const result = await draftStore.addTheme({ id, label, scene, description });
    json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  } finally {
    finishMutation();
  }
}

async function publicVisibilityRequest(request, response, url) {
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

async function committedAdditions(commit) {
  const { code, stdout } = await git(["show", `${commit}:${publicationMetadata}`], {
    allowFailure: true,
    preserveWhitespace: true,
  });
  if (code !== 0) throw new Error("当前提交不包含公开增量清单，不能完成草稿对账");
  try {
    return normalizePortfolioAdditions(JSON.parse(stdout));
  } catch (error) {
    throw new Error(`当前提交的公开增量清单无效，不能完成草稿对账：${error.message}`);
  }
}

async function assertCommittedAdditionBundle(commit, id) {
  for (const path of [
    `apps/portfolio/assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
    `apps/portfolio/assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
  ]) {
    const { code } = await git(["cat-file", "-e", `${commit}:${path}`], { allowFailure: true });
    if (code !== 0) throw new Error(`${slotCode(id)} 的公开图片尚未进入当前提交，不能完成草稿对账`);
  }
}

async function reconcileStagedDraftsToCommit(commit) {
  const [state, additions] = await Promise.all([draftStore.read(), readPublicAdditions()]);
  const publishedIds = new Set(additions.photos.filter(({ visibility }) => visibility === "published").map(({ id }) => Number(id)));
  const ids = state.photos.filter((photo) => isPendingDraftReconciliation(photo, publishedIds))
    .map(({ id }) => id);
  if (!ids.length) return ids;
  const committed = await committedAdditions(commit);
  const committedPublishedIds = new Set(committed.photos
    .filter(({ visibility }) => visibility === "published")
    .map(({ id }) => Number(id)));
  for (const id of ids) {
    if (!committedPublishedIds.has(id)) {
      throw new Error(`${slotCode(id)} 尚未进入当前提交的公开清单，不能完成草稿对账`);
    }
    await assertCommittedAdditionBundle(commit, id);
  }
  await draftStore.markPublished(ids, commit);
  return ids;
}

async function sourcePhotoFilesFromGit() {
  const { stdout } = await git(
    [
      "status", "--porcelain=v1", "--untracked-files=all", "--",
      "apps/portfolio/assets/photos",
      "apps/portfolio-v2/catalog-additions.json",
      ...publicationMutableStyleSourcePaths,
    ],
    { preserveWhitespace: true },
  );
  if (!stdout) return [];
  return stdout.split("\n").filter(Boolean).map(parseStatusLine).map((item) => item.path);
}

async function publishPhotos(request, response) {
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
      const reconciledDraftIds = await reconcileStagedDraftsToCommit(statusBefore.head);
      json(response, 200, {
        ok: true,
        noChanges: true,
        reconciledDraftIds,
        message: reconciledDraftIds.length
          ? "网站文件已在当前提交中，已完成本地发布状态对账"
          : "本地没有待同步的新照片",
        status: await repositoryStatus(),
      });
      return;
    }
    const additions = await readPublicAdditions();
    const registeredIds = new Set([
      ...Array.from({ length: portfolioCatalog.photoCount }, (_, index) => index + 1),
      ...additions.photos.map(({ id }) => Number(id)),
    ]);
    const allowedSourceFiles = new Set([...registeredIds].flatMap((id) => [
      `apps/portfolio/assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
      `apps/portfolio/assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
    ]));
    allowedSourceFiles.add(publicationMetadata);
    for (const path of publicationMutableStyleSourcePaths) allowedSourceFiles.add(path);
    for (const id of portfolioCatalog.heroAssetIds) {
      allowedSourceFiles.add(`apps/portfolio/assets/photos/featured/photo-${String(id).padStart(3, "0")}.webp`);
    }
    const invalidSourceFile = sourceFiles.find((path) => !allowedSourceFiles.has(path));
    if (invalidSourceFile) throw new Error(`未登记的照片文件不会发布：${invalidSourceFile}`);
    const changedPhotoFiles = sourceFiles.filter((path) => path.startsWith("apps/portfolio/assets/photos/"));
    const bundleValidation = validateChangedPhotoBundles(changedPhotoFiles);
    if (!bundleValidation.ok) {
      throw new Error(`同一编号的图片不完整，已停止发布：${bundleValidation.errors.join("；")}`);
    }
    const nonSourceChanges = statusBefore.changedFiles.filter((path) => !sourceFiles.includes(path));
    if (nonSourceChanges.length) throw new Error(`发布前存在非源图片改动：${nonSourceChanges.slice(0, 5).join("、")}`);

    const publishedMetadata = "docs/projects/portfolio-v2/catalog-additions.json";
    const stagePaths = new Set([
      ...sourceFiles,
      publicationMetadata,
      publishedMetadata,
      ...publicationStyleSourcePaths,
      ...publicationStylePublishedPaths,
      "docs/projects/portfolio-v2/index.html",
      "docs/projects/portfolio-v2/app.js",
      "docs/projects/portfolio-v2/build.json",
      "docs/p/index.html",
      "docs/p/build.json",
      "docs/i/index.html",
    ]);
    for (const sourcePath of changedPhotoFiles) {
      const suffix = relative("apps/portfolio", sourcePath);
      stagePaths.add(join("docs/projects/portfolio", suffix));
    }
    const generatedPaths = [...stagePaths].filter((path) => path.startsWith("docs/"));
    let version;
    try {
      await run(process.execPath, [join(root, "tools/export-github-pages.mjs")], { cwd: root });
      version = await buildPortfolioVersion();
      const statusAfterExport = await repositoryStatus();
      const unexpectedExport = statusAfterExport.changedFiles.filter((path) => !stagePaths.has(path));
      if (unexpectedExport.length) {
        throw new Error(`导出产生了超出客片范围的改动，已停止提交：${unexpectedExport.slice(0, 5).join("、")}`);
      }
    } catch (error) {
      try {
        // 只恢复明确登记的 Pages 生成物；未知路径保留给人工核查。
        await restoreGeneratedPaths(generatedPaths, statusBefore.head);
      } catch (cleanupError) {
        throw new Error(`${error.message}；提交前生成物恢复失败：${cleanupError.message}`);
      }
      throw error;
    }
    await git(["add", "--", ...stagePaths]);
    const { code: hasNoStagedDiff } = await git(["diff", "--cached", "--quiet"], { allowFailure: true });
    if (hasNoStagedDiff === 0) {
      await reconcileStagedDraftsToCommit(statusBefore.head);
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
        await restoreGeneratedPaths(generatedPaths, commitBeforePublish);
      } catch (rollbackError) {
        throw new Error(`${pushError.message}；未推送提交恢复失败：${rollbackError.message}`);
      }
      throw pushError;
    }
    const { stdout: commit } = await git(["rev-parse", "--short", "HEAD"]);
    await reconcileStagedDraftsToCommit(commit);
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
  const url = new URL(request.url || "/", `http://${host}:${activePort}`);
  try {
    if (!allowedLocalHosts().has(String(request.headers.host || ""))) {
      const error = new Error("已拒绝非本机地址访问");
      error.status = 403;
      throw error;
    }
    if (!serverReady) {
      const error = new Error("正在检查上次换图状态，请稍后刷新");
      error.status = 503;
      throw error;
    }
    if (new Set(["POST", "PUT", "DELETE"]).has(request.method)) requireSession(request);
    if (request.method === "GET" && url.pathname === "/api/session") {
      json(response, 200, { ok: true, token: sessionToken });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/style-library") {
      json(response, 200, { ok: true, ...(await styleLibraryPayload()) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/assets/references") {
      json(response, 200, await assetReferencesPayload(url));
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
    if (request.method === "POST" && url.pathname === "/api/style-slots/replace") {
      await replaceStyleSlotRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/style-slots/undo") {
      await undoStyleSlotRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/style-slots/meta") {
      await updateStyleSlotMetaRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/styles/layout") {
      await updateStyleLayoutRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/styles/meta") {
      await updateStyleMetaRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/style-batches") {
      await createStyleBatchRequest(response, url);
      return;
    }
    const styleBatchRoute = styleBatchPath(url.pathname);
    if (request.method === "PUT" && styleBatchRoute?.kind === "file") {
      await stageStyleBatchFileRequest(request, response, url, styleBatchRoute);
      return;
    }
    if (request.method === "POST" && styleBatchRoute?.kind === "commit") {
      await commitStyleBatchRequest(request, response, url, styleBatchRoute);
      return;
    }
    if (request.method === "DELETE" && styleBatchRoute?.kind === "batch") {
      await discardStyleBatchRequest(response, url, styleBatchRoute);
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
  const address = server.address();
  activePort = address && typeof address !== "string" ? address.port : requestedPort;
  const url = `http://${host}:${activePort}/`;
  try {
    // 只有成功绑定端口的单一进程才允许检查事务目录。第二次双击会先走
    // EADDRINUSE，不会把第一个进程的正在换图误当成崩溃恢复。
    const isolatedFixture = await isExplicitIsolatedFixture();
    const createPortfolioStyleStore = await loadStyleStoreFactory({ isolatedFixture });
    const [recoveredPhotoTransactions, recoveredPublicationTransactions] = await Promise.all([
      isolatedFixture ? Promise.resolve([]) : recoverIncompletePhotoTransactions(),
      recoverIncompletePublicationTransactions(publicationOptions),
    ]);
    if (recoveredPhotoTransactions.length) {
      console.log(`已自动恢复中断的换图：${recoveredPhotoTransactions.join("、")}`);
    }
    if (recoveredPublicationTransactions.length) {
      console.log(`已自动恢复中断的客片公开：${recoveredPublicationTransactions.join("、")}`);
    }
    styleStore = await initializeStyleStore(createPortfolioStyleStore);
    serverReady = true;
    console.log(`南铂客片管理台：${url}`);
    console.log("保持这个窗口开启；结束时可直接关闭窗口。");
    if (process.argv.includes("--open")) spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch (error) {
    console.error(`客片安全检查未完成：${error.message}`);
    server.close(() => process.exit(1));
  }
});

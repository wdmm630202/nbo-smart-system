# 南铂客片草稿库与公开增量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有 158 张客片、23 个主题和收藏编号的前提下，为本机管理台增加“上传草稿—归类授权—本地预览—明确同步”的新增客片工作流。

**Architecture:** 现有 `catalog.js` 继续负责 `NB-001` 至 `NB-158`，新增公开客片写入独立的 `catalog-additions.json`，客户页在运行时合并两份数据。本地草稿和原图全部保存在 Git 忽略的 `.local/portfolio-drafts/`；只有标记为待公开的成套图片与公开字段会进入源目录，并沿用现有 GitHub Pages 安全发布流程。

**Tech Stack:** Node.js 22 ESM、原生 HTTP 服务、原生浏览器 ES modules、HTML/CSS、ffmpeg/ffprobe、`node:test`、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-08-31-portfolio-draft-library-design.md`

## Global Constraints

- 现有 `NB-001` 至 `NB-158` 必须继续公开，编号、展示顺序和 localStorage 收藏兼容性不变。
- 新照片从 `NB-159` 开始自动编号，不创建空编号或占位图片。
- 新照片默认只存在于 `.local/portfolio-drafts/`；未确认公开前不得进入 Git、`docs/` 或产生公开 URL。
- 只接受 JPG、PNG、WebP，单文件不超过 50 MB，接近 3:4，且不低于 900×1200；系统不得自动裁掉人物。
- 每张草稿必须选择场景、主题、风格并勾选 `approvedForPublicUse`，才能进入待公开状态。
- 草稿记录不得保存客户姓名、电话、微信或其他个人信息。
- 新主题至少有一张已公开照片且封面编号有效，才允许出现在客户页面。
- 公开图生成 1080×1440 JPG 与 480×640 WebP；批量上传允许部分成功并逐张报告。
- 管理服务只绑定 `127.0.0.1:4174`，修改接口必须通过同源检查和随机会话令牌。
- 隐藏不等同永久删除；隐藏后的新增照片保留原编号并可恢复。
- 发布前继续检查 `main` 分支、远端领先、人工暂存、无关改动、图片包完整性和线上版本。
- 第一阶段可以在没有新照片时上线完整框架；客户页仍必须恰好显示 158 张和原有 23 个主题。
- 不增加远程登录、手机公网上传、订单、支付、客户账号、客户资料库、AI 分类或永久擦除工具。

## File Map

- Create `apps/portfolio-v2/catalog-additions.json`: 公开增量主题和照片的唯一清单，初始为空。
- Modify `apps/portfolio-v2/catalog.js`: 校验公开增量，并把它与历史 158 张合并。
- Modify `apps/portfolio-v2/app.js`: 加载公开增量清单并把合并结果交给现有筛选、收藏和查看器。
- Create `tools/portfolio-draft-store.mjs`: 原子读写本地草稿 manifest、分配稳定编号、状态转换。
- Create `tools/portfolio-draft-photo-lib.mjs`: 草稿图片生成、待公开资源安装、公开清单更新、隐藏和恢复。
- Modify `tools/portfolio-photo-lib.mjs`: 暴露共用图片验证/生成能力，并让图库验证理解公开增量。
- Modify `tools/portfolio-manager-server.mjs`: 增加草稿 API、草稿媒体路由和增量发布白名单。
- Modify `tools/portfolio-manager/index.html`: 增加“新增客片”、状态筛选、批量结果和草稿编辑面板。
- Modify `tools/portfolio-manager/app.js`: 管理草稿上传、元数据、授权、待公开、隐藏和恢复交互。
- Modify `tools/portfolio-manager/styles.css`: 增加响应式草稿管理视觉，不改变现有换图操作。
- Modify `tools/export-github-pages.mjs`: 把增量清单纳入版本和导出验证。
- Modify `tests/portfolio-photo-workflow.test.mjs`: 保留历史 158 张、发布包和服务安全回归。
- Create `tests/portfolio-draft-library.test.mjs`: 草稿存储、图片流转、增量合并和状态规则测试。
- Modify `package.json`: 将新增测试加入 `portfolio:test`。
- Modify `apps/portfolio-v2/README.md`: 记录换图与新增客片两条本机工作流。

---

### Task 1: 公开增量清单与兼容合并

**Files:**
- Create: `apps/portfolio-v2/catalog-additions.json`
- Modify: `apps/portfolio-v2/catalog.js:1-83`
- Create: `tests/portfolio-draft-library.test.mjs`

**Interfaces:**
- Consumes: 现有 `portfolioCatalog` 与 `buildPortfolioItems(catalog)`。
- Produces: `emptyPortfolioAdditions`、`normalizePortfolioAdditions(value)`、`buildPortfolioThemes(catalog, additions)`、`buildPortfolioItems(catalog, additions)`。

- [ ] **Step 1: 写增量为空时的失败测试**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPortfolioItems,
  buildPortfolioThemes,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";

test("空增量保持 158 张、23 个主题和原顺序", async () => {
  const additions = JSON.parse(await readFile(new URL("../apps/portfolio-v2/catalog-additions.json", import.meta.url), "utf8"));
  const items = buildPortfolioItems(portfolioCatalog, additions);
  assert.equal(items.length, 158);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).length, 23);
  assert.deepEqual(items.map(({ id }) => id), buildPortfolioItems(portfolioCatalog).map(({ id }) => id));
});

test("公开增量只接受唯一、连续范围外编号", () => {
  assert.throws(() => normalizePortfolioAdditions({ schemaVersion: 1, themes: [], photos: [
    { id: 158, scene: "indoor", theme: "magazine", category: "business", visibility: "published" },
  ] }), /NB-158/);
});
```

- [ ] **Step 2: 运行测试并确认它因接口和清单不存在而失败**

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: FAIL，错误包含 `catalog-additions.json` 不存在或 `buildPortfolioThemes` 未导出。

- [ ] **Step 3: 创建空增量清单并实现严格归一化**

`apps/portfolio-v2/catalog-additions.json`：

```json
{
  "schemaVersion": 1,
  "themes": [],
  "photos": []
}
```

在 `catalog.js` 中增加：

```js
export const emptyPortfolioAdditions = Object.freeze({ schemaVersion: 1, themes: [], photos: [] });

export function normalizePortfolioAdditions(value = emptyPortfolioAdditions) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.themes) || !Array.isArray(value.photos)) {
    throw new Error("公开增量清单格式无效");
  }
  const ids = new Set();
  const photos = value.photos.map((photo) => {
    const id = Number(photo.id);
    if (!Number.isInteger(id) || id <= portfolioCatalog.photoCount) {
      throw new Error(`新增客片 NB-${String(id).padStart(3, "0")} 与历史编号冲突`);
    }
    if (ids.has(id)) throw new Error(`新增客片 NB-${String(id).padStart(3, "0")} 重复`);
    ids.add(id);
    return { ...photo, id, code: `NB-${String(id).padStart(3, "0")}`, featured: photo.featured === true, isHeroAsset: false };
  });
  return { schemaVersion: 1, themes: value.themes.map((theme) => ({ ...theme })), photos };
}
```

将现有历史生成逻辑保留为内部 `buildLegacyPortfolioItems`，再导出：

```js
export function buildPortfolioItems(catalog = portfolioCatalog, additions = emptyPortfolioAdditions) {
  const legacy = buildLegacyPortfolioItems(catalog);
  const normalized = normalizePortfolioAdditions(additions);
  const published = normalized.photos
    .filter((photo) => photo.visibility === "published")
    .sort((a, b) => a.id - b.id);
  return [...legacy, ...published];
}

export function buildPortfolioThemes(catalog = portfolioCatalog, additions = emptyPortfolioAdditions) {
  const normalized = normalizePortfolioAdditions(additions);
  const publishedIds = new Set(normalized.photos.filter((photo) => photo.visibility === "published").map((photo) => photo.id));
  const newThemes = normalized.themes.filter((theme) => publishedIds.has(Number(theme.coverPhotoId))
    && normalized.photos.some((photo) => photo.visibility === "published" && photo.theme === theme.id));
  return [...catalog.themes, ...newThemes];
}
```

- [ ] **Step 4: 增加新增照片、隐藏主题和编号冲突测试并跑通**

```js
test("已公开新增照片被追加，隐藏照片和无封面主题不显示", () => {
  const additions = {
    schemaVersion: 1,
    themes: [
      { id: "new-light", scene: "indoor", label: "新光影", description: "新主题", coverPhotoId: 159 },
      { id: "empty-theme", scene: "outdoor", label: "空主题", description: "不显示", coverPhotoId: 160 },
    ],
    photos: [
      { id: 159, scene: "indoor", theme: "new-light", category: "mood", title: "新光影", styleTitle: "情绪", visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 160, scene: "outdoor", theme: "empty-theme", category: "relaxed", title: "空主题", styleTitle: "松弛", visibility: "archived", publishedAt: "2026-08-31T00:00:00.000Z" },
    ],
  };
  assert.equal(buildPortfolioItems(portfolioCatalog, additions).at(-1).id, 159);
  assert.equal(buildPortfolioItems(portfolioCatalog, additions).length, 159);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "new-light"), true);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "empty-theme"), false);
});
```

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交公开增量数据契约**

```bash
git add apps/portfolio-v2/catalog.js apps/portfolio-v2/catalog-additions.json tests/portfolio-draft-library.test.mjs
git commit -m "feat: add portfolio additions contract"
```

---

### Task 2: 本地草稿存储与稳定状态机

**Files:**
- Create: `tools/portfolio-draft-store.mjs`
- Modify: `tests/portfolio-draft-library.test.mjs`

**Interfaces:**
- Consumes: 公开增量照片编号数组和可注入的临时测试目录。
- Produces: `draftRoot`、`createDraftStore(options)`；store 提供 `read()`、`allocateId(publicIds)`、`addPhoto(input)`、`updatePhoto(id, patch)`、`transitionPhoto(id, nextStatus)`、`addTheme(input)`。

- [ ] **Step 1: 写原子存储、编号和状态失败测试**

先把测试文件的 `node:fs/promises` import 扩展为：

```js
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDraftStore } from "../tools/portfolio-draft-store.mjs";

test("草稿从 NB-159 开始且不会复用归档编号", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  assert.equal(await store.allocateId([]), 159);
  await store.addPhoto({ id: 159, uuid: "photo-a", originalName: "a.jpg" });
  await store.transitionPhoto(159, "archived");
  assert.equal(await store.allocateId([]), 160);
  assert.doesNotMatch(await readFile(join(directory, "manifest.json"), "utf8"), /客户|电话|微信/);
});

test("未归类或未确认授权的草稿不能进入 ready", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  await store.addPhoto({ id: 159, uuid: "photo-a", originalName: "a.jpg" });
  await assert.rejects(() => store.transitionPhoto(159, "ready"), /场景、主题、风格和公开授权/);
});
```

- [ ] **Step 2: 运行测试确认模块缺失**

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `portfolio-draft-store.mjs`。

- [ ] **Step 3: 实现原子 manifest 和字段白名单**

```js
export const DRAFT_SCHEMA_VERSION = 1;
export const draftRoot = join(root, ".local/portfolio-drafts");
const allowedPatchKeys = new Set(["scene", "theme", "category", "approvedForPublicUse", "status", "updatedAt"]);
const transitions = {
  draft: new Set(["ready", "archived"]),
  ready: new Set(["draft", "published", "archived"]),
  published: new Set(["archived"]),
  archived: new Set(["draft", "published"]),
};

export function createDraftStore({ rootDir = draftRoot, legacyMaxId = 158 } = {}) {
  const manifestPath = join(rootDir, "manifest.json");
  async function write(state) {
    const temporary = `${manifestPath}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
    await mkdir(rootDir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, manifestPath);
  }
  return { read, allocateId, addPhoto, updatePhoto, transitionPhoto, addTheme };
}
```

`read()` 在文件不存在时返回 `{ schemaVersion: 1, photos: [], themes: [] }`；`addPhoto()` 只持久化定义过的草稿字段；`transitionPhoto(..., "ready")` 必须同时验证 `scene`、`theme`、`category` 和 `approvedForPublicUse === true`。

- [ ] **Step 4: 增加非法转换和并发写入测试并跑通**

```js
test("草稿状态只允许定义过的转换", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  await store.addPhoto({ id: 159, uuid: "photo-a", originalName: "a.jpg", scene: "indoor", theme: "magazine", category: "business", approvedForPublicUse: true });
  await assert.rejects(() => store.transitionPhoto(159, "published"), /draft.*published/);
  await store.transitionPhoto(159, "ready");
  assert.equal((await store.read()).photos[0].status, "ready");
});

test("连续加入两张草稿时原子分配 NB-159 和 NB-160", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  const firstId = await store.allocateId([]);
  await store.addPhoto({ id: firstId, uuid: "photo-a", originalName: "a.jpg" });
  const secondId = await store.allocateId([]);
  await store.addPhoto({ id: secondId, uuid: "photo-b", originalName: "b.jpg" });
  assert.deepEqual((await store.read()).photos.map(({ id }) => id), [159, 160]);
});
```

`createDraftStore()` 内部用 `let mutationQueue = Promise.resolve()` 串行执行“读取—编号—写入”，所有 mutation 都通过同一个 `enqueueMutation(operation)`；这样批量上传不会让两张照片拿到同一编号。

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: PASS，且临时目录以 `t.after` 清除。

- [ ] **Step 5: 提交草稿存储**

```bash
git add tools/portfolio-draft-store.mjs tests/portfolio-draft-library.test.mjs
git commit -m "feat: add local portfolio draft store"
```

---

### Task 3: 草稿图片生成、待公开安装、隐藏与恢复

**Files:**
- Create: `tools/portfolio-draft-photo-lib.mjs`
- Modify: `tools/portfolio-photo-lib.mjs:112-157,325-378,420-556`
- Modify: `tests/portfolio-draft-library.test.mjs`

**Interfaces:**
- Consumes: `createDraftStore()`、`probeImage(path)`、`validateIncomingImage(info)`、`renderPhotoDerivatives(input, targets)`、`catalog-additions.json`。
- Produces: `ingestDraftPhoto(input)`、`stageDraftForPublication(id, options)`、`setPublishedPhotoVisibility(id, visibility, options)`、`loadPublicAdditions(path)`。

- [ ] **Step 1: 写图片校验和草稿隔离失败测试**

把草稿图片接口加入测试文件现有 import：

```js
import { assetPaths } from "../tools/portfolio-photo-lib.mjs";
import { ingestDraftPhoto } from "../tools/portfolio-draft-photo-lib.mjs";

test("上传合格图片只生成本地草稿，不创建 photo-159 公开文件", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-images-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  const source = assetPaths(158).full;
  const record = await ingestDraftPhoto({ inputPath: source, originalName: "new.jpg", contentType: "image/jpeg", store, rootDir: directory, publicIds: [] });
  assert.equal(record.id, 159);
  assert.equal(record.status, "draft");
  assert.equal((await stat(join(directory, "assets/full", `${record.uuid}.jpg`))).isFile(), true);
  assert.equal((await stat(join(directory, "assets/thumbs", `${record.uuid}.webp`))).isFile(), true);
  await assert.rejects(() => stat(join(directory, "public/full/photo-159.jpg")), /ENOENT/);
});
```

- [ ] **Step 2: 运行测试确认共用函数和草稿图片模块尚不存在**

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: FAIL，错误指向 `ingestDraftPhoto` 或 `allowAddition` 接口缺失。

- [ ] **Step 3: 从换图库提取不裁人验证与衍生图生成函数**

在 `portfolio-photo-lib.mjs` 中导出：

```js
export function validateIncomingImage({ width, height }) {
  const ratio = width / height;
  if (width < 900 || height < 1200) throw new Error(`图片只有 ${width}×${height}，至少需要 900×1200`);
  if (Math.abs(ratio - 0.75) > 0.02) {
    throw new Error(`图片比例是 ${width}:${height}，请先在像素蛋糕或 Photoshop 裁成 3:4，系统不会自动裁掉人物`);
  }
  return { width, height };
}

export async function renderPhotoDerivatives(inputPath, { full, thumb }) {
  const ffmpeg = await resolveBinary("ffmpeg");
  await renderAsset(ffmpeg, inputPath, full, 1080, 1440, "jpg");
  await renderAsset(ffmpeg, inputPath, thumb, 480, 640, "webp");
}
```

`replacePhoto()` 改为调用这两个导出函数，确保旧换图与新增上传执行同一套规则。

- [ ] **Step 4: 实现草稿生成和公开清单原子写入**

```js
export async function ingestDraftPhoto({ inputPath, originalName, contentType, store, rootDir, publicIds }) {
  assertSupportedPhoto(originalName, contentType);
  validateIncomingImage(await probeImage(inputPath));
  const id = await store.allocateId(publicIds);
  const uuid = randomBytes(12).toString("hex");
  const originalExtension = extname(originalName).toLowerCase() || ".jpg";
  const targets = {
    original: join(rootDir, "assets/originals", `${uuid}${originalExtension}`),
    full: join(rootDir, "assets/full", `${uuid}.jpg`),
    thumb: join(rootDir, "assets/thumbs", `${uuid}.webp`),
  };
  await Promise.all(Object.values(targets).map((path) => mkdir(dirname(path), { recursive: true })));
  await copyFile(inputPath, targets.original);
  await renderPhotoDerivatives(inputPath, targets);
  return store.addPhoto({ id, uuid, originalName, status: "draft", approvedForPublicUse: false });
}
```

同一文件中定义格式白名单，不能只相信浏览器传来的 MIME：

```js
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedPhotoExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function assertSupportedPhoto(originalName, contentType) {
  const extension = extname(originalName).toLowerCase();
  if (!allowedPhotoTypes.has(contentType) && !allowedPhotoExtensions.has(extension)) {
    throw new Error("只支持 JPG、PNG 或 WebP 图片");
  }
}
```

`stageDraftForPublication()` 必须：重新读取草稿、要求 `status === "ready"`、复制 full/thumb 到 `photo-NNN`、为自建主题补充有效封面、追加公开记录、通过临时文件原子替换 `catalog-additions.json`，再把草稿写入 `stagedAt`。任一步失败时恢复公开清单并删除这次新装入的成套图片。

公开记录只能由明确白名单组装，不能展开整个草稿对象：

```js
const publicPhoto = {
  id: draft.id,
  scene: draft.scene,
  theme: draft.theme,
  category: draft.category,
  title: theme.label,
  styleTitle: category.label,
  featured: draft.featured === true,
  visibility: "published",
  publishedAt: new Date().toISOString(),
};
```

`originalName`、草稿 UUID、本地路径、授权操作时间和其他后台字段都不得写入公开记录。

- [ ] **Step 5: 写待公开、隐藏和原编号恢复测试**

先在测试文件中增加完全隔离的夹具：

```js
async function createPublicationSandbox(t) {
  const rootDir = await mkdtemp(join(tmpdir(), "nanbo-publication-"));
  const publicPhotoRoot = join(rootDir, "public");
  const additionsPath = join(rootDir, "catalog-additions.json");
  const store = createDraftStore({ rootDir: join(rootDir, "drafts"), legacyMaxId: 158 });
  await mkdir(publicPhotoRoot, { recursive: true });
  await writeFile(additionsPath, `${JSON.stringify({ schemaVersion: 1, themes: [], photos: [] }, null, 2)}\n`);
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return {
    additionsPath,
    publicPhotoRoot,
    options: { store, draftRoot: join(rootDir, "drafts"), additionsPath, publicPhotoRoot },
    publicAssetPaths(id) {
      const base = `photo-${String(id).padStart(3, "0")}`;
      return { full: join(publicPhotoRoot, "full", `${base}.jpg`), thumb: join(publicPhotoRoot, "thumbs", `${base}.webp`) };
    },
    async ingestAndReady() {
      const draft = await ingestDraftPhoto({
        inputPath: assetPaths(158).full,
        originalName: "new.jpg",
        contentType: "image/jpeg",
        store,
        rootDir: join(rootDir, "drafts"),
        publicIds: [],
      });
      await store.updatePhoto(draft.id, { scene: "indoor", theme: "magazine", category: "mood", approvedForPublicUse: true });
      return store.transitionPhoto(draft.id, "ready");
    },
  };
}
```

```js
test("ready 草稿成套进入公开增量，隐藏与恢复保留 NB-159", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  const draft = await sandbox.ingestAndReady();
  await stageDraftForPublication(draft.id, sandbox.options);
  let additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.equal(additions.photos[0].id, 159);
  assert.equal(additions.photos[0].visibility, "published");
  assert.equal((await stat(sandbox.publicAssetPaths(159).full)).isFile(), true);
  assert.equal((await stat(sandbox.publicAssetPaths(159).thumb)).isFile(), true);

  await setPublishedPhotoVisibility(159, "archived", sandbox.options);
  additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.equal(additions.photos[0].visibility, "archived");
  await setPublishedPhotoVisibility(159, "published", sandbox.options);
  additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.equal(additions.photos[0].id, 159);
  assert.equal(additions.photos[0].visibility, "published");
});
```

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: PASS；测试只使用临时目录，不触碰真实 158 张图片。

- [ ] **Step 6: 提交图片流转层**

```bash
git add tools/portfolio-photo-lib.mjs tools/portfolio-draft-photo-lib.mjs tests/portfolio-draft-library.test.mjs
git commit -m "feat: add draft photo publication pipeline"
```

---

### Task 4: 本机草稿 API 与安全发布扩展

**Files:**
- Modify: `tools/portfolio-manager-server.mjs:1-453`
- Modify: `tests/portfolio-draft-library.test.mjs`
- Modify: `tests/portfolio-photo-workflow.test.mjs:265-288`

**Interfaces:**
- Consumes: Task 2 store 与 Task 3 图片流转函数。
- Produces: `GET /api/catalog` 的 `drafts`/`counts` 字段；`POST /api/drafts/upload`、`POST /api/drafts/update`、`POST /api/drafts/ready`、`POST /api/drafts/archive`、`POST /api/drafts/restore`、`POST /api/drafts/stage`、`POST /api/draft-themes`、`POST /api/public/visibility`；带令牌的 `/media/draft/...`。

- [ ] **Step 1: 写服务端安全和部分成功失败测试**

服务集成测试必须使用独立端口和临时草稿/公开目录，先增加以下夹具：

```js
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { root } from "../tools/portfolio-photo-lib.mjs";

async function startIsolatedManager(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "nanbo-manager-api-"));
  const draftDirectory = join(sandbox, "drafts");
  const additionsPath = join(sandbox, "catalog-additions.json");
  const publicPhotoRoot = join(sandbox, "public");
  const port = 45_000 + randomBytes(2).readUInt16BE() % 1_000;
  await mkdir(publicPhotoRoot, { recursive: true });
  await writeFile(additionsPath, `${JSON.stringify({ schemaVersion: 1, themes: [], photos: [] }, null, 2)}\n`);
  const store = createDraftStore({ rootDir: draftDirectory, legacyMaxId: 158 });
  await store.addPhoto({ id: 159, uuid: "0123456789abcdef01234567", originalName: "seed.jpg", status: "draft", approvedForPublicUse: false });
  const child = spawn(process.execPath, [join(root, "tools/portfolio-manager-server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      NANBO_PORTFOLIO_PORT: String(port),
      NANBO_PORTFOLIO_DRAFT_ROOT: draftDirectory,
      NANBO_PORTFOLIO_ADDITIONS_PATH: additionsPath,
      NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT: publicPhotoRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForOutput(child, /南铂客片管理台：/);
  const url = `http://127.0.0.1:${port}/`;
  const token = (await (await fetch(`${url}api/session`)).json()).token;
  t.after(async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(sandbox, { recursive: true, force: true });
  });
  return {
    url,
    token,
    postJson(path, body) {
      return fetch(new URL(path, url), {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-nanbo-token": token },
      });
    },
  };
}
```

```js
test("草稿修改接口拒绝缺少令牌和跨站请求", { timeout: 30_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const noToken = await fetch(`${server.url}api/drafts/update?id=159`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(noToken.status, 403);
  const crossSite = await fetch(`${server.url}api/drafts/update?id=159`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json", "x-nanbo-token": server.token, origin: "https://example.com" },
  });
  assert.equal(crossSite.status, 403);
});

test("未授权草稿不能进入待公开", { timeout: 30_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const response = await server.postJson("api/drafts/ready?id=159", {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /公开授权/);
});
```

- [ ] **Step 2: 运行服务测试确认路由返回 404 或 405**

Run: `node --test tests/portfolio-draft-library.test.mjs tests/portfolio-photo-workflow.test.mjs`

Expected: FAIL on the new `/api/drafts/*` routes。

- [ ] **Step 3: 增加 JSON 请求、草稿路由和媒体令牌**

```js
async function readJsonBody(request) {
  const content = await readBody(request);
  try { return JSON.parse(content.toString("utf8")); }
  catch { throw new Error("提交的数据不是有效 JSON"); }
}

if (request.method === "POST" && url.pathname === "/api/drafts/update") {
  requireSession(request);
  const result = await draftStore.updatePhoto(Number(url.searchParams.get("id")), await readJsonBody(request));
  json(response, 200, { ok: true, result, catalog: await catalogPayload() });
  return;
}
```

`POST /api/draft-themes` 只接受 `{ id, label, scene, description }`：`id` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，label 为 2–12 个字符，scene 必须来自现有场景，description 为 2–30 个字符；重名或重 ID 返回 400。`/api/drafts/archive` 和 `/api/drafts/restore` 只调用 Task 2 定义的状态转换，不删除原图。

草稿图片路由使用 `/media/draft/(full|thumb)/<uuid>?token=<session>`；服务端同时验证 host、`token === sessionToken`、UUID 为 24 位十六进制，并把真实路径限制在 `draftRoot/assets/` 内。

服务启动时的真实默认路径不变；只为隔离测试读取以下覆盖变量：

```js
const configuredDraftRoot = process.env.NANBO_PORTFOLIO_DRAFT_ROOT || draftRoot;
const additionsPath = process.env.NANBO_PORTFOLIO_ADDITIONS_PATH || join(root, "apps/portfolio-v2/catalog-additions.json");
const publicPhotoRoot = process.env.NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT || sourcePhotoRoot;
const draftStore = createDraftStore({ rootDir: configuredDraftRoot, legacyMaxId: portfolioCatalog.photoCount });
```

`catalogPayload()` 改用合并后的 items 动态计算每个主题数量，不能继续假设所有主题都有 `series.length * 2`：

```js
const additions = await readPublicAdditions();
const items = buildPortfolioItems(portfolioCatalog, additions);
const themes = buildPortfolioThemes(portfolioCatalog, additions).map(({ series, ...theme }) => ({
  ...theme,
  count: items.filter((item) => item.theme === theme.id).length,
}));
```

- [ ] **Step 4: 扩展发布白名单和成套校验**

`publishPrefixes` 增加 `apps/portfolio-v2/catalog-additions.json`；`repositoryStatus()` 从公开增量读取已登记编号；`publishPhotos()` 的合法源文件集合由历史 158 张与公开增量共同生成，并把以下文件加入本次 stage：

```js
const publicationMetadata = "apps/portfolio-v2/catalog-additions.json";
const registeredItems = buildPortfolioItems(portfolioCatalog, await readPublicAdditions());
const allowedSourceFiles = new Set(registeredItems.flatMap(({ id }) => [
  `apps/portfolio/assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
  `apps/portfolio/assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
]));
```

推送成功后调用 `markStagedDraftsPublished(commit)`；推送失败则草稿仍保持 `ready`，公开源文件保留为待同步，允许下次重试。

- [ ] **Step 5: 跑通服务、旧换图和新发布测试**

Run: `npm run portfolio:test`

Expected: 所有既有测试和新增测试 PASS；第二次启动仍不得恢复第一个进程的活跃事务。

- [ ] **Step 6: 提交本机 API 与发布安全**

```bash
git add tools/portfolio-manager-server.mjs tests/portfolio-draft-library.test.mjs tests/portfolio-photo-workflow.test.mjs
git commit -m "feat: expose secure portfolio draft APIs"
```

---

### Task 5: Apple 风格草稿管理界面

**Files:**
- Modify: `tools/portfolio-manager/index.html:14-260`
- Modify: `tools/portfolio-manager/app.js:1-304`
- Modify: `tools/portfolio-manager/styles.css`
- Modify: `tests/portfolio-draft-library.test.mjs`

**Interfaces:**
- Consumes: Task 4 API 返回的 `{ items, drafts, scenes, themes, counts, status }`。
- Produces: 可访问的批量上传面板、草稿状态筛选、元数据/授权表单、待公开/隐藏/恢复操作和逐文件结果。

- [ ] **Step 1: 写管理台结构失败测试**

```js
test("管理台提供新增、状态筛选、授权、新主题和批量结果区域", async () => {
  const html = await readFile(new URL("../tools/portfolio-manager/index.html", import.meta.url), "utf8");
  for (const id of ["add-photo-button", "library-mode", "draft-status-filter", "draft-upload", "draft-metadata", "public-consent", "homepage-featured", "new-theme-button", "new-theme-form", "upload-results"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /已确认可公开使用/);
  assert.match(html, /草稿|待公开|已公开|已归档/);
});
```

- [ ] **Step 2: 运行测试确认新管理控件缺失**

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: FAIL，首先缺少 `add-photo-button`。

- [ ] **Step 3: 增加图库模式、主操作和草稿编辑面板**

在现有顶部操作中加入唯一强调主按钮：

```html
<button class="button button-primary" id="add-photo-button" type="button">
  <span class="button-icon" aria-hidden="true">＋</span><span>新增客片</span>
</button>
```

新增分段模式“公开图库 / 本地草稿”，草稿筛选“全部 / 草稿 / 待公开 / 已公开 / 已归档”。上传 `<input id="draft-upload" multiple>`，每个结果行显示文件名、成功编号或明确失败原因；元数据区使用原生 `<select>`，授权使用未默认勾选的 `<input type="checkbox" id="public-consent">`，首页推荐使用独立且默认关闭的 `<input type="checkbox" id="homepage-featured">`。

主题选择器旁增加“新建主题”，展开 `new-theme-form` 后填写英文标识、中文名称、场景和简短描述；保存成功后立即加入主题选择器，但在该主题至少有一张公开照片并以该照片作为 `coverPhotoId` 前，客户页不会显示它。

- [ ] **Step 4: 实现批量逐张上传与元数据保存**

```js
async function uploadDraftFiles(files) {
  const results = [];
  for (const file of files) {
    try {
      const result = await requestJson("/api/drafts/upload", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      results.push({ file: file.name, ok: true, code: result.result.code });
    } catch (error) {
      results.push({ file: file.name, ok: false, error: error.message });
    }
  }
  renderUploadResults(results);
  await refreshData();
}
```

“准备公开”按钮只有在场景、主题、风格和授权全部有效时启用；“同步到网站”仍使用现有最终确认弹窗，不把公开授权勾选与网站同步确认合并成一次无意识点击。

- [ ] **Step 5: 实现视觉层级与移动端无横向溢出**

CSS 约束：上传面板最大宽度 `760px`，桌面元数据为双列，`max-width: 720px` 时改单列；所有控件最小点击高度 `44px`；状态使用文字与形状共同表达；危险/隐藏按钮采用次级样式，不能与“准备公开”同色。

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: PASS。

- [ ] **Step 6: 在本地管理台完成浏览器验收**

Run: `npm run portfolio:manage`

Browser checks:

- `http://127.0.0.1:4174/` 首屏显示“新增客片”，原有 158 张换图入口仍可用。
- 一次选择一个合格文件和一个不合格文件，结果分别显示成功编号与失败原因。
- 未勾授权时“准备公开”禁用；勾选且完成分类后启用。
- 草稿预览不会出现在 `/preview/` 的公开图库中。
- 390px 宽度下无横向滚动，弹窗按钮和关闭按钮均可点击。

- [ ] **Step 7: 提交管理界面**

```bash
git add tools/portfolio-manager/index.html tools/portfolio-manager/app.js tools/portfolio-manager/styles.css tests/portfolio-draft-library.test.mjs
git commit -m "feat: add portfolio draft manager interface"
```

---

### Task 6: 客户页加载公开增量与 Pages 导出

**Files:**
- Modify: `apps/portfolio-v2/app.js:1-18,180-220`
- Modify: `tools/portfolio-photo-lib.mjs:460-555`
- Modify: `tools/export-github-pages.mjs:13,158-191`
- Modify: `tests/portfolio-draft-library.test.mjs`
- Modify: `tests/portfolio-photo-workflow.test.mjs:53-155`
- Modify: `package.json:13`

**Interfaces:**
- Consumes: `catalog-additions.json` 与 Task 1 合并函数。
- Produces: 只展示 `visibility === "published"` 的客户图库、动态数量、版本化增量清单和完整 Pages 副本。

- [ ] **Step 1: 写客户页和导出失败测试**

```js
test("客户页加载版本化增量清单且导出副本一致", async () => {
  const [app, sourceAdditions, publishedAdditions] = await Promise.all([
    readFile(new URL("../apps/portfolio-v2/app.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/portfolio-v2/catalog-additions.json", import.meta.url)),
    readFile(new URL("../docs/projects/portfolio-v2/catalog-additions.json", import.meta.url)),
  ]);
  assert.match(app, /catalog-additions\.json\?v=/);
  assert.match(app, /buildPortfolioThemes\(/);
  assert.deepEqual(publishedAdditions, sourceAdditions);
});
```

- [ ] **Step 2: 运行测试确认客户页尚未加载增量**

Run: `node --test tests/portfolio-draft-library.test.mjs`

Expected: FAIL because `app.js` does not reference `catalog-additions.json`。

- [ ] **Step 3: 客户页以空清单降级方式加载增量**

```js
import { buildPortfolioItems, buildPortfolioThemes, emptyPortfolioAdditions, portfolioCatalog } from "./catalog.js?v=__NBO_BUILD_VERSION__";

async function loadPortfolioAdditions() {
  try {
    const response = await fetch(`./catalog-additions.json?v=${encodeURIComponent(buildVersion)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("公开增量清单读取失败，继续显示历史客片", error);
    return emptyPortfolioAdditions;
  }
}

const portfolioAdditions = await loadPortfolioAdditions();
const themeConfig = buildPortfolioThemes(portfolioCatalog, portfolioAdditions).map((theme) => ({ ...theme, series: new Set(theme.series || []) }));
const galleryItems = buildPortfolioItems(portfolioCatalog, portfolioAdditions).map((item) => ({
  ...item,
  thumb: versionPhoto(`../portfolio/assets/photos/thumbs/photo-${String(item.id).padStart(3, "0")}.webp`),
  full: versionPhoto(`../portfolio/assets/photos/full/photo-${String(item.id).padStart(3, "0")}.jpg`),
}));
```

现有筛选、查看器、收藏和需求卡继续使用 `galleryItems`；数量从数组动态计算，不读取固定 158 文案。

- [ ] **Step 4: 把增量清单和新增资源纳入验证与版本哈希**

`validatePortfolioLibrary()` 要验证历史 158 张永远完整；对增量只验证 `published` 与 `archived` 记录的编号、主题引用和成套资源。`buildPortfolioVersion()` 必须包含 `catalog-additions.json` 及其中所有已登记 full/thumb 文件，确保新增、隐藏或恢复都会生成新版本。

- [ ] **Step 5: 导出并运行完整测试**

Run: `npm run pages:build`

Expected: 输出新的 `pv2-` 版本，`docs/projects/portfolio-v2/catalog-additions.json` 与源文件字节一致。

Run: `npm run portfolio:test`

Expected: 全部 PASS；空增量时仍为 158 张、23 个主题。

将 `package.json` 的 `portfolio:test` 增加 `tests/portfolio-draft-library.test.mjs`，保证以后每次发布都覆盖草稿架构。

- [ ] **Step 6: 提交客户页和导出链路**

```bash
git add apps/portfolio-v2/app.js tools/portfolio-photo-lib.mjs tools/export-github-pages.mjs tests/portfolio-draft-library.test.mjs tests/portfolio-photo-workflow.test.mjs package.json docs/projects/portfolio-v2 docs/p
git commit -m "feat: publish approved portfolio additions"
```

---

### Task 7: 文档、全链路安全验收与空框架上线

**Files:**
- Modify: `apps/portfolio-v2/README.md`
- Verify: `apps/portfolio-v2/catalog-additions.json`
- Verify: `docs/projects/portfolio-v2/`
- Verify: `docs/p/`

**Interfaces:**
- Consumes: Tasks 1–6 的完整工作流。
- Produces: 可由用户直接打开的本机新增客片后台，以及客户无感的空增量线上版本。

- [ ] **Step 1: 更新两条操作说明**

在 README 明确写出：

```markdown
## 本地新增客片

1. Finder 双击仓库根目录的 `打开南铂客片管理.command`。
2. 点“新增客片”，可一次选择多张；不合格图片会逐张提示且不影响其他草稿。
3. 为每张照片选择场景、主题、风格，并在确认门店已有公开授权后勾选“已确认可公开使用”。
4. 点“准备公开”，打开本地预览检查；确认后再点“同步到网站”。
5. 草稿不会显示给客户；“隐藏”可以撤下新增照片但不是永久删除。
```

保留现有“本地换图”章节，避免把替换 158 张与新增客片混成同一动作。

- [ ] **Step 2: 运行静态、图库与发布测试**

Run:

```bash
npm run portfolio:validate
npm run portfolio:test
node --test tests/rendered-html.test.mjs
git diff --check
```

Expected: 所有命令退出码 0；图库报告 158 张历史客片与 0 张公开增量；工作区没有图片草稿或 `.local` 文件被 Git 跟踪。

- [ ] **Step 3: 本地客户页与管理台浏览器验收**

Run: `npm run portfolio:manage`

Browser checks:

- `/preview/` 显示恰好 158 张、23 个主题，首页、筛选、收藏、放大和需求卡可用。
- 管理台显示公开 158、草稿 0、待公开 0；“新增客片”入口可见。
- 在测试临时目录验证一张草稿后清理测试草稿，不把测试图片加入真实增量清单。
- 390px、768px 和桌面宽度无横向溢出；键盘可到达新增、筛选、关闭和同步按钮。

- [ ] **Step 4: 确认发布范围并提交文档**

Run:

```bash
git status --short
git diff --name-only origin/main...HEAD
git add apps/portfolio-v2/README.md
git commit -m "docs: explain portfolio draft publishing"
```

Expected: 变更只包含计划列出的源代码、测试、README 和由 `pages:build` 生成的对应发布副本；没有用户照片草稿、原文件名或个人资料。

- [ ] **Step 5: 推送空增量框架并核对线上版本**

Run:

```bash
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
git push origin main
```

Expected: 推送前 behind 为 0；推送成功。

随后检查：

- `https://wdmm630202.github.io/nbo-smart-system/p/build.json` 的版本等于本地 `docs/p/build.json`。
- `https://p.nanbostudio.com/` 显示 158 张和 23 个主题，没有空位置或“暂无照片”主题。
- 手机打开固定链接，首页、筛选、收藏和底部导航正常，无横向溢出。

- [ ] **Step 6: 最终提交状态核对**

Run:

```bash
git status -sb
git log -7 --oneline
```

Expected: `main...origin/main` 无 ahead/behind，工作区干净；最近提交与本计划七个任务对应。

# 南铂 132 种风格与 1188 个照片位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 158 张客片、价格卡、收藏和联系入口的前提下，上线 132 种风格、每种 9 个拍摄参考、逐张姿势选择，以及可长期逐位替换的本机后台。

**Architecture:** 继续把现有 `NB-*` 作为真实图片资产，新增稳定风格目录和 1188 个照片位引用清单。客户页按需读取 11 张风格封面和当前风格 9 张缩略图；本机管理台以写时复制方式替换单个照片位，新图获得新的 `NB-*` 资产编号，不覆盖其他复用位置。

**Tech Stack:** 原生 HTML/CSS/ES modules、Node.js 22 内置测试与 HTTP 服务、现有 ffmpeg/ffprobe 图片流水线、GitHub Pages 静态导出；不新增第三方前端或数据库依赖。

**Spec:** `docs/superpowers/specs/2026-09-01-portfolio-132-style-1188-slot-design.md`

## Global Constraints

- 必须在由 `superpowers:using-git-worktrees` 创建的独立工作树执行，不能在当前含其他未提交改动的 `main` 工作树直接开发。
- 风格总数固定 132：内景 66、外景 66；每个场景 6 个大类、每类 11 个风格；每个风格 9 个照片位，总计 1188。
- 首发只引用南铂现有 158 张公开资产；网络研究图和 Pexels 图不得进入公开清单或导出目录。
- 同一风格 9 个照片位不得引用重复资产；同一大类 11 张封面不得相邻重复。
- 公开文案只使用“132 种男士写真风格”“每种 9 个拍摄参考”，不得写“1188 张不同真实客片”。
- 现有 `NB-001` 至 `NB-158`、旧照片收藏、本机后台端口 `127.0.0.1:4174`、固定短链接 `/p/`、268 套餐、企业微信和电话保持兼容。
- 客户端首屏不得请求 1188 张图片；首次只加载当前大类 11 张封面，打开风格后才加载 9 张缩略图，打开查看器后才加载高清图。
- 所有新修改接口继续要求本机随机会话令牌和同源检查。
- 实施使用测试驱动开发：每项先添加失败测试、确认失败，再写最小实现并运行通过。
- 每个任务只暂存该任务列出的文件，保留工作树外和主工作树中的用户改动。

## File Structure

### 新增客户页数据与模型

- `apps/portfolio-v2/style-catalog.json`：12 个感觉大类、132 个风格的稳定元数据。
- `apps/portfolio-v2/style-slot-assignments.json`：每个风格的 9 个资产引用、稳定姿势标签、封面位置、成熟度与更新时间。
- `apps/portfolio-v2/style-library.js`：严格校验目录和照片位清单，并构建运行时风格、位置和资产视图。
- `apps/portfolio-v2/style-explorer-model.js`：场景、大类、风格、相册和查看器的纯状态转换。
- `apps/portfolio-v2/style-preferences.js`：风格收藏、姿势选择及旧照片收藏兼容。
- `apps/portfolio-v2/style-explorer.js`：新风格选择器、紧凑卡、9 张相册和 URL/返回状态的 DOM 控制器。

### 新增生成、管理与交易模块

- `tools/seed-portfolio-style-library.mjs`：从已确认 132 风格内容和当前 158 张资产生成初始引用清单、重复率报告和本机封面审查页。
- `tools/portfolio-style-store.mjs`：读取 132/1188 结构、单位置写时复制、撤销、排序、封面、成熟度和批量交易。
- `tools/portfolio-manager/style-mode.js`：管理台“风格相册”模式，独立于现有公开图库和草稿模式。

### 新增测试

- `tests/helpers/portfolio-style-fixtures.mjs`：各测试共享的确定性资产、132 风格、1188 槽位和验证参数夹具；不启动服务、不写生产文件。
- `tests/portfolio-style-library.test.mjs`：132/1188 数据不变量、初始化分配和四位以上资产编号。
- `tests/portfolio-style-explorer.test.mjs`：状态、卡片、相册、查看器、收藏、需求和按需加载。
- `tests/portfolio-style-manager.test.mjs`：写时复制、撤销、批量原子性、接口安全和发布校验。

### 修改现有文件

- `apps/portfolio-v2/portfolio-runtime.js`：加载并降级风格目录与照片位清单。
- `apps/portfolio-v2/app.js`：接入新控制器、复用现有查看器和需求清单、保留旧主题链接。
- `apps/portfolio-v2/index.html`：加入风格选择、相册、姿势按钮和后台兼容挂载点。
- `apps/portfolio-v2/styles.css`：紧凑 2:3 卡片、9 张相册、手机/桌面详情层和减少动态。
- `tools/portfolio-photo-lib.mjs`：允许 `NB-1000` 以上资产并把风格清单纳入校验和版本哈希。
- `tools/portfolio-manager-server.mjs`：增加风格查询、单张替换、撤销、布局和批量接口。
- `tools/portfolio-manager/index.html`、`tools/portfolio-manager/styles.css`、`tools/portfolio-manager/app.js`：增加风格管理入口并接入独立模块。
- `tools/export-github-pages.mjs`：导出新 JSON/JS 文件并核对固定短链接。
- `package.json`：把三组新测试纳入 `portfolio:test`。

### 测试助手约定

不能假定仓库已有未声明的测试框架。纯数据助手集中在 `tests/helpers/portfolio-style-fixtures.mjs`，有进程或临时目录生命周期的助手留在对应测试文件：

- `fixtureAssets()`：返回至少 18 个完整资产对象，内外景各 9 个，并包含可解析的 `thumb/full` 路径。
- `fixtureStyleCatalog()`：生成严格满足 12 大类、132 风格和 8 个 `featuredStyleIds` 的最小确定性目录；只改被测试字段，不省略生产契约字段。
- `fixtureAssignments({ firstSlots })`：为 132 风格生成 9 个 `{ assetId, poseLabel, source, updatedAt }` 槽位；`firstSlots` 只覆盖第一风格。
- `readJson(relativePath)`：以仓库根为基准读取生产 JSON。
- `libraryFixture()`、`memoryStorage(initial)`：分别由共享夹具构建完整库，以及提供可清空的 `localStorage` 兼容内存对象。
- `styleFixtureOptions(overrides)`：从生产数据深拷贝 `validatePortfolioLibrary()` 参数，再施加单个故障覆盖。
- `createStyleStoreFixture(t, options)`：在 `tests/portfolio-style-manager.test.mjs` 内建立 `mkdtemp()` 临时仓库、复制最小目录和清单、生成一张合格图及一张不合格图，并由 `t.after()` 清理。
- `startManagerFixture(t)`：在同一文件内用随机空闲端口启动现有管理服务入口，返回 `url/token/close/store`，不得绑定真实 `4174` 或修改生产 JSON。
- `measureStyleExplorer(options)`：在 `tests/portfolio-style-explorer.test.mjs` 内用现有 Chrome `--headless=new --dump-dom` 模式、390×844 视口和临时 HTTP 服务采集 DOM 与资源请求指标；没有 Chrome 时只跳过这一条浏览器验收，纯模型测试仍必须执行。

---

### Task 1: 建立风格与照片位严格数据契约

**Files:**
- Create: `apps/portfolio-v2/style-library.js`
- Create: `tests/helpers/portfolio-style-fixtures.mjs`
- Create: `tests/portfolio-style-library.test.mjs`

**Interfaces:**
- Produces: `normalizeStyleCatalog(value) -> { schemaVersion, families, styles, featuredStyleIds }`
- Produces: `normalizeStyleAssignments(value, catalog, assetMap) -> { schemaVersion, assignments }`, where `assetMap` is `Map<number, Asset>`.
- Produces: `buildStyleLibrary({ catalog, assignments, assets }) -> { families, styles, slots, counts }`
- Produces: `styleSlotId(styleId, position) -> string`
- Consumes: asset objects shaped as `{ id:number, scene:"indoor"|"outdoor", theme:string, thumb:string, full:string }`.

- [ ] **Step 1: Write the failing contract tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStyleLibrary,
  normalizeStyleAssignments,
  normalizeStyleCatalog,
  styleSlotId,
} from "../apps/portfolio-v2/style-library.js";

test("style slot ids are stable and one based", () => {
  assert.equal(styleSlotId("ST-IN-01-01", 1), "ST-IN-01-01-P01");
  assert.equal(styleSlotId("ST-OUT-06-11", 9), "ST-OUT-06-11-P09");
  assert.throws(() => styleSlotId("ST-IN-01-01", 0), /1–9/);
});

test("style catalog rejects unknown fields and invalid cardinality", () => {
  assert.throws(() => normalizeStyleCatalog({ schemaVersion: 1, families: [], styles: [], extra: true }), /不允许字段/);
  assert.throws(() => normalizeStyleCatalog({ schemaVersion: 1, families: [], styles: [] }), /12 个大类/);
});

test("assignments require nine unique same-scene public assets", () => {
  const catalog = fixtureStyleCatalog();
  const firstSlots = [1, 1, 2, 3, 4, 5, 6, 7, 8].map((assetId, index) => ({
    assetId,
    poseLabel: `拍摄参考 ${index + 1}`,
    source: "seed",
    updatedAt: null,
  }));
  const duplicated = fixtureAssignments({ firstSlots });
  const assetMap = new Map(fixtureAssets().map((asset) => [asset.id, asset]));
  assert.throws(() => normalizeStyleAssignments(duplicated, catalog, assetMap), /9 个不重复资产/);
});

test("featured styles are eight unique valid style ids", () => {
  const catalog = fixtureStyleCatalog();
  catalog.featuredStyleIds[7] = catalog.featuredStyleIds[0];
  assert.throws(() => normalizeStyleCatalog(catalog), /8 个不重复的精选风格/);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/portfolio-style-library.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `style-library.js`.

- [ ] **Step 3: Implement exact validators and runtime builders**

```js
export function styleSlotId(styleId, position) {
  if (!/^ST-(IN|OUT)-0[1-6]-(0[1-9]|1[01])$/.test(styleId)) throw new Error("风格编号无效");
  if (!Number.isInteger(position) || position < 1 || position > 9) throw new Error("照片位必须在 1–9 之间");
  return `${styleId}-P${String(position).padStart(2, "0")}`;
}

export function buildStyleLibrary({ catalog, assignments, assets }) {
  const normalizedCatalog = normalizeStyleCatalog(catalog);
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const normalizedAssignments = normalizeStyleAssignments(assignments, normalizedCatalog, assetMap);
  const slots = normalizedCatalog.styles.flatMap((style) =>
    normalizedAssignments.assignments[style.id].slots.map((assignment, index) => ({
      id: styleSlotId(style.id, index + 1),
      styleId: style.id,
      position: index + 1,
      assetId: assignment.assetId,
      asset: assetMap.get(assignment.assetId),
      poseLabel: assignment.poseLabel,
      source: assignment.source,
      updatedAt: assignment.updatedAt,
      isCover: normalizedAssignments.assignments[style.id].coverPosition === index + 1,
    })),
  );
  return {
    families: normalizedCatalog.families,
    featuredStyleIds: normalizedCatalog.featuredStyleIds,
    styles: normalizedCatalog.styles.map((style) => ({
      ...style,
      ...normalizedAssignments.assignments[style.id],
      slots: slots.filter((slot) => slot.styleId === style.id),
    })),
    slots,
    counts: {
      styles: normalizedCatalog.styles.length,
      publishedStyles: normalizedCatalog.styles.filter(({ visibility }) => visibility === "published").length,
      indoor: normalizedCatalog.styles.filter(({ scene }) => scene === "indoor").length,
      outdoor: normalizedCatalog.styles.filter(({ scene }) => scene === "outdoor").length,
      slots: slots.length,
      assets: assetMap.size,
    },
  };
}
```

Validators must allow only these exact keys:

```js
const catalogKeys = new Set(["schemaVersion", "families", "styles", "featuredStyleIds"]);
const familyKeys = new Set(["id", "scene", "label", "description", "order"]);
const styleKeys = new Set(["id", "familyId", "scene", "label", "audience", "description", "legacyThemeIds", "order", "visibility"]);
const assignmentKeys = new Set(["slots", "coverPosition", "maturity", "updatedAt"]);
const slotAssignmentKeys = new Set(["assetId", "poseLabel", "source", "updatedAt"]);
```

`normalizeStyleCatalog()` additionally requires exactly 8 unique `featuredStyleIds`, every ID present in `styles`, with at least 3 indoor and 3 outdoor entries. `normalizeStyleAssignments()` requires a non-empty `poseLabel`, `source` exactly `seed` or `upload`, and only `upload` slots may carry a non-null `updatedAt`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/portfolio-style-library.test.mjs`

Expected: all contract tests PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add apps/portfolio-v2/style-library.js tests/helpers/portfolio-style-fixtures.mjs tests/portfolio-style-library.test.mjs
git commit -m "feat: define portfolio style library contract"
```

### Task 2: 建立 12 个大类和 132 个正式风格目录

**Files:**
- Create: `apps/portfolio-v2/style-catalog.json`
- Modify: `tests/portfolio-style-library.test.mjs`

**Interfaces:**
- Consumes: `normalizeStyleCatalog()` from Task 1.
- Produces: the production `schemaVersion:1` style catalog consumed by seeding, customer UI, and manager.

- [ ] **Step 1: Add a failing production-catalog test**

```js
test("production catalog has 66 indoor and 66 outdoor styles in six-by-eleven families", async () => {
  const raw = JSON.parse(await readFile(new URL("../apps/portfolio-v2/style-catalog.json", import.meta.url), "utf8"));
  const catalog = normalizeStyleCatalog(raw);
  assert.equal(catalog.families.length, 12);
  assert.equal(catalog.styles.length, 132);
  assert.equal(catalog.featuredStyleIds.length, 8);
  for (const scene of ["indoor", "outdoor"]) {
    const families = catalog.families.filter((family) => family.scene === scene);
    assert.equal(families.length, 6);
    assert.equal(catalog.styles.filter((style) => style.scene === scene).length, 66);
    for (const family of families) assert.equal(catalog.styles.filter((style) => style.familyId === family.id).length, 11);
  }
  assert.ok(catalog.styles.every((style) => style.audience.length >= 6 && style.description.length >= 6));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/portfolio-style-library.test.mjs --test-name-pattern='production catalog'`

Expected: FAIL because `style-catalog.json` does not exist.

- [ ] **Step 3: Create the exact production catalog**

Use these 12 families and the exact 11-style lists already approved in the interaction prototype:

```text
IN-01 商务气场：职业形象、企业肖像、霸道总裁、精英西装、绅士正装、雅痞西装、红底西装、西装少年、领带松弛、个人模卡、职业证照
IN-02 杂志质感：杂志肖像、简约杂志、光影肖像、情绪肖像、黑白硬照、雕塑光影、窗影故事、时尚摩登、冷调封面、暖调封面、白底极简
IN-03 韩系松弛：居家韩系、韩系学长、美式少年、清爽少年、白衫禁欲、针织少年、奶油暖男、夏日清新、慵懒居家、苹果主题、校园学长
IN-04 运动硬朗：拳击硬汉、腹肌健身、运动型格、网球运动、战术硬汉、皮衣硬汉、痞帅西装、湿发型男、机能潮男、高街潮男、朋克青年
IN-05 港风故事：复古港风、双人港风、港片男主、国风少年、古风武侠、民国男主、中式雅士、新中公子、长衫先生、美式复古、怀旧胶片
IN-06 创意个性：赛博朋克、创意概念、彩色光影、镜面空间、花艺少年、繁花公子、宠物合拍、生日主题、新春主题、圣诞主题、乐队主唱
OUT-01 都市街拍：时尚街拍、痞帅街拍、潮流街拍、都市街拍、日常休闲、城市漫步、老街港风、涂鸦街区、街角少年、彩色街拍、咖啡街角
OUT-02 城市夜景：霓虹夜景、城市夜景、天台夜景、港风夜拍、雨夜电影、情绪隧道、暗系情绪、夜市烟火、车灯电影、酒吧微醺、闪光街拍
OUT-03 森系自然：森系文艺、海边少年、海洋馆景、草地少年、山野旅人、湖边静坐、溪边少年、麦田暖阳、芦苇秋日、雪景少年、花海少年
OUT-04 机车酷感：炫酷机车、机车型格、公路机车、车库冷感、工业硬照、厂房型男、水泥工业、隧道冷调、公路旅人、车旁街拍、驾车绅士
OUT-05 校园少年：热血高校、校园少年、操场青春、篮球少年、网球学长、滑板少年、足球少年、骑行少年、跑步少年、运动纪实、机长制服
OUT-06 旅行电影：正装外景、国风外景、山野武侠、藏地少年、港澳旅拍、大理旅拍、城市地标、列车旅途、游艇绅士、山水旅拍、秋冬街拍
```

Each style record must follow this exact shape:

```json
{
  "id": "ST-IN-01-01",
  "familyId": "IN-01",
  "scene": "indoor",
  "label": "职业形象",
  "audience": "需要职业头像、个人主页或团队介绍的男士",
  "description": "干净正装与清晰眼神，呈现可信赖的职业状态",
  "legacyThemeIds": ["business-boss"],
  "order": 1,
  "visibility": "published"
}
```

The top-level `featuredStyleIds` is the initial manual curation, not a popularity claim:

```json
["ST-IN-01-04", "ST-IN-02-01", "ST-IN-03-04", "ST-IN-05-03", "ST-OUT-01-04", "ST-OUT-02-04", "ST-OUT-03-02", "ST-OUT-04-02"]
```

For every style, write specific `audience` and `description`; do not repeat one family sentence across 11 records. Only use legacy theme IDs defined in `apps/portfolio-v2/catalog.js`.

- [ ] **Step 4: Run the catalog tests and verify GREEN**

Run: `node --test tests/portfolio-style-library.test.mjs`

Expected: PASS and exactly 132 unique style IDs.

- [ ] **Step 5: Commit the catalog**

```bash
git add apps/portfolio-v2/style-catalog.json tests/portfolio-style-library.test.mjs
git commit -m "feat: add 132 portrait style catalog"
```

### Task 3: 生成 1188 个初始照片位引用而不复制图片

**Files:**
- Create: `tools/seed-portfolio-style-library.mjs`
- Create: `apps/portfolio-v2/style-slot-assignments.json`
- Modify: `tests/portfolio-style-library.test.mjs`

**Interfaces:**
- Consumes: `portfolioCatalog`, `buildPortfolioItems()`, `normalizeStyleCatalog()`.
- Produces: `buildSeedAssignments({ catalog, assets }) -> { schemaVersion, assignments, report }`.
- Produces: `.local/portfolio-style-seed-report.json` and `.local/portfolio-style-cover-audit.html` during the CLI run; neither file is exported.

- [ ] **Step 1: Add failing seed invariants**

```js
test("seed creates 1188 valid slot references without copying assets", async () => {
  const { buildSeedAssignments } = await import("../tools/seed-portfolio-style-library.mjs");
  const catalog = normalizeStyleCatalog(await readJson("apps/portfolio-v2/style-catalog.json"));
  const assets = buildPortfolioItems(portfolioCatalog);
  const seeded = buildSeedAssignments({ catalog, assets });
  assert.equal(Object.keys(seeded.assignments).length, 132);
  assert.equal(Object.values(seeded.assignments).flatMap((entry) => entry.slots).length, 1188);
  for (const style of catalog.styles) {
    const ids = seeded.assignments[style.id].slots.map(({ assetId }) => assetId);
    assert.equal(ids.length, 9);
    assert.equal(new Set(ids).size, 9);
    assert.ok(ids.every((id) => assets.find((asset) => asset.id === id)?.scene === style.scene));
    assert.ok(seeded.assignments[style.id].slots.every(({ source }) => source === "seed"));
  }
  assert.equal(new Set(Object.values(seeded.assignments).flatMap((entry) => entry.slots.map(({ assetId }) => assetId))).size, 158);
});
```

- [ ] **Step 2: Run the seed test and verify RED**

Run: `node --test tests/portfolio-style-library.test.mjs --test-name-pattern='seed creates'`

Expected: FAIL because the seeding module is absent.

- [ ] **Step 3: Implement deterministic scene-safe seeding**

```js
export function buildSeedAssignments({ catalog, assets }) {
  const assignments = {};
  const familyCovers = new Map();
  for (const style of catalog.styles) {
    const sameScene = assets.filter((asset) => asset.scene === style.scene);
    const preferred = sameScene.filter((asset) => style.legacyThemeIds.includes(asset.theme));
    const pool = [...preferred, ...sameScene.filter((asset) => !preferred.includes(asset))];
    const offset = stableHash(style.id) % pool.length;
    const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
    const ids = [...new Set(rotated.map((asset) => asset.id))].slice(0, 9);
    const usedCovers = familyCovers.get(style.familyId) || new Set();
    const coverIndex = ids.findIndex((id) => !usedCovers.has(id));
    if (coverIndex > 0) [ids[0], ids[coverIndex]] = [ids[coverIndex], ids[0]];
    usedCovers.add(ids[0]);
    familyCovers.set(style.familyId, usedCovers);
    assignments[style.id] = {
      slots: ids.map((assetId, index) => ({
        assetId,
        poseLabel: `拍摄参考 ${String(index + 1).padStart(2, "0")}`,
        source: "seed",
        updatedAt: null,
      })),
      coverPosition: 1,
      maturity: "reference",
      updatedAt: null,
    };
  }
  const covered = ensureEveryAssetReferenced({ catalog, assignments, assets });
  return { schemaVersion: 1, assignments: covered, report: buildSeedReport(catalog, covered) };
}
```

`ensureEveryAssetReferenced()` finds same-scene assets not used by any slot and replaces non-cover seeded slots that are globally overrepresented, while preserving nine unique assets inside the affected style and preserving all family covers. Importing this module in tests must not write files; run the CLI only when `process.argv[1] === fileURLToPath(import.meta.url)`.

Because current catalog metadata does not reliably describe the pose in each photograph, the seed uses neutral labels `拍摄参考 01`–`09`; it must not guess “坐姿/站姿/半身”等内容. The manager adds editable pose labels later, and the public demand text falls back to the stable position if an operator has not reviewed the label.

The CLI must write `apps/portfolio-v2/style-slot-assignments.json`, `.local/portfolio-style-seed-report.json`, and a self-contained local cover audit page showing all 132 covers grouped 6×11. It then re-reads the manifests through Task 1 validators before exiting 0.

- [ ] **Step 4: Generate and validate production assignments**

Run: `node tools/seed-portfolio-style-library.mjs`

Expected: prints `132 styles · 1188 slots · 158 assets`, creates the two `.local` audit files, and creates no physical photo duplicate.

- [ ] **Step 5: Run full style-library tests**

Run: `node --test tests/portfolio-style-library.test.mjs`

Expected: PASS, including no duplicate within any 9-photo album and no adjacent duplicate family cover.

- [ ] **Step 6: Commit seed code and assignments**

```bash
git add tools/seed-portfolio-style-library.mjs apps/portfolio-v2/style-slot-assignments.json tests/portfolio-style-library.test.mjs
git commit -m "feat: seed 1188 independent portfolio slots"
```

### Task 4: 加载新结构并保留 158 张旧图库兼容

**Files:**
- Modify: `apps/portfolio-v2/portfolio-runtime.js:1-45`
- Modify: `apps/portfolio-v2/app.js:1-120`
- Modify: `tests/portfolio-style-library.test.mjs`

**Interfaces:**
- Produces: `loadPortfolioDocument({ fetchImpl, url, fallback, label, warn })`.
- Produces: `buildCustomerStyleLibrary({ styleCatalog, assignments, assets, fallback, warn })`.
- Consumes: `buildStyleLibrary()` from Task 1 and `galleryItems` from existing `app.js`.

- [ ] **Step 1: Add failing network and compatibility tests**

```js
test("style documents fall back without removing the 158-photo legacy gallery", async () => {
  const warnings = [];
  const fallback = { schemaVersion: 1, families: [], styles: [] };
  const result = await loadPortfolioDocument({
    fetchImpl: async () => { throw new Error("offline"); },
    url: "./style-catalog.json",
    fallback,
    label: "风格目录",
    warn: (...args) => warnings.push(args),
  });
  assert.equal(result, fallback);
  assert.equal(buildPortfolioItems(portfolioCatalog).length, 158);
  assert.equal(warnings.length, 1);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-library.test.mjs --test-name-pattern='fall back'`

Expected: FAIL because `loadPortfolioDocument` is not exported.

- [ ] **Step 3: Implement generic document loading and parallel app startup**

```js
export async function loadPortfolioDocument({ fetchImpl, url, fallback, label, warn = defaultWarn }) {
  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    warn(`${label}请求失败，继续使用兼容内容`, error);
    return fallback;
  }
}
```

In `app.js`, load additions, `style-catalog.json`, and `style-slot-assignments.json` with `Promise.all`, build `galleryItems` exactly as before, then call `buildStyleLibrary({ catalog, assignments, assets: galleryItems })`. If style validation fails, keep the legacy gallery and hide only the new explorer.

Keep the existing header badge as `158 张真实客片` because it is the unique public asset count. The initial release's new explorer separately displays `132 种风格 · 内景 66 · 外景 66`; if an operator later publishes a hidden style, the customer count must derive from `publishedStyles` rather than remain hard-coded. Never replace the asset count with 1188. The local manager displays all three measures explicitly: `1188 个照片位 · 158 张当前资产 · 132 种风格`.

- [ ] **Step 4: Run focused and existing workflow tests**

Run: `node --test tests/portfolio-style-library.test.mjs tests/portfolio-photo-workflow.test.mjs`

Expected: PASS; existing 158 items and 23 legacy themes remain unchanged.

- [ ] **Step 5: Commit runtime compatibility**

```bash
git add apps/portfolio-v2/portfolio-runtime.js apps/portfolio-v2/app.js tests/portfolio-style-library.test.mjs
git commit -m "feat: load style library with legacy fallback"
```

### Task 5: 建立场景、大类、风格、相册的纯交互状态

**Files:**
- Create: `apps/portfolio-v2/style-explorer-model.js`
- Create: `tests/portfolio-style-explorer.test.mjs`

**Interfaces:**
- Produces: `createExplorerState(library, locationState) -> ExplorerState`.
- Produces: `reduceExplorer(state, action, library) -> ExplorerState`.
- Produces: `serializeExplorerLocation(state) -> URLSearchParams`.
- State keys: `{ scene, familyId, styleId, poseIndex, view, returnScrollY }`.

- [ ] **Step 1: Write failing state-transition tests**

```js
test("explorer narrows 132 styles to one eleven-style family and restores return state", () => {
  const state = createExplorerState(libraryFixture(), {});
  const outdoor = reduceExplorer(state, { type: "scene", scene: "outdoor" }, libraryFixture());
  const family = reduceExplorer(outdoor, { type: "family", familyId: "OUT-02" }, libraryFixture());
  const album = reduceExplorer(family, { type: "open-style", styleId: "ST-OUT-02-03", scrollY: 812 }, libraryFixture());
  const viewer = reduceExplorer(album, { type: "open-pose", poseIndex: 4 }, libraryFixture());
  const back = reduceExplorer(viewer, { type: "back" }, libraryFixture());
  assert.deepEqual([family.scene, family.familyId, family.view], ["outdoor", "OUT-02", "styles"]);
  assert.deepEqual([album.view, album.returnScrollY], ["album", 812]);
  assert.deepEqual([viewer.view, viewer.poseIndex], ["viewer", 4]);
  assert.equal(back.view, "album");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-explorer.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the finite-state reducer**

```js
const allowedViews = new Set(["styles", "album", "viewer"]);

export function reduceExplorer(state, action, library) {
  if (action.type === "scene") {
    const family = library.families.find((item) => item.scene === action.scene);
    return { ...state, scene: action.scene, familyId: family.id, styleId: "", poseIndex: 0, view: "styles" };
  }
  if (action.type === "family") return { ...state, familyId: action.familyId, styleId: "", poseIndex: 0, view: "styles" };
  if (action.type === "open-style") return { ...state, styleId: action.styleId, poseIndex: 0, view: "album", returnScrollY: action.scrollY };
  if (action.type === "open-pose") return { ...state, poseIndex: action.poseIndex, view: "viewer" };
  if (action.type === "move-pose") return { ...state, poseIndex: Math.max(0, Math.min(8, state.poseIndex + action.direction)) };
  if (action.type === "back") return { ...state, view: state.view === "viewer" ? "album" : "styles", poseIndex: 0 };
  throw new Error(`未知风格交互 ${action.type}`);
}
```

`createExplorerState()` must validate URL values against the library and fall back to `indoor`, `IN-01`, `styles`. `serializeExplorerLocation()` writes only `style`, `family`, and `scene`; the pose index stays session-local.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test tests/portfolio-style-explorer.test.mjs`

Expected: all state tests PASS.

- [ ] **Step 5: Commit the interaction model**

```bash
git add apps/portfolio-v2/style-explorer-model.js tests/portfolio-style-explorer.test.mjs
git commit -m "feat: model portfolio style navigation"
```

### Task 6: 上线高级紧凑风格卡和渐进式选择界面

**Files:**
- Create: `apps/portfolio-v2/style-explorer.js`
- Modify: `apps/portfolio-v2/index.html:206-268`
- Modify: `apps/portfolio-v2/styles.css:1-452`
- Modify: `apps/portfolio-v2/app.js:1-420`
- Modify: `tests/portfolio-style-explorer.test.mjs`

**Interfaces:**
- Produces: `createStyleExplorer({ root, library, versionPhoto, onTrack, onOpenViewer, onSelectionChange })`.
- Returns: `{ openStyle(styleId), restoreFromLocation(), destroy() }`.
- Consumes: Task 5 reducer and stable style/slot objects from Task 1.

- [ ] **Step 1: Add failing markup and card-geometry tests**

```js
test("customer page contains progressive style explorer hooks", async () => {
  const html = await readFile(new URL("../apps/portfolio-v2/index.html", import.meta.url), "utf8");
  assert.match(html, /id="style-explorer"/);
  assert.match(html, /id="style-scene-tabs"/);
  assert.match(html, /id="style-family-tabs"/);
  assert.match(html, /id="style-card-grid"/);
  assert.match(html, /id="style-album"/);
});

test("compact cards keep 2:3 card and 3:4 image ratios", async () => {
  const css = await readFile(new URL("../apps/portfolio-v2/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.portrait-style-card\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*3/s);
  assert.match(css, /\.portrait-style-card-image\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/s);
});

test("the selector labels counts honestly and exposes manual Nanbo picks", async () => {
  const html = await readFile(new URL("../apps/portfolio-v2/index.html", import.meta.url), "utf8");
  assert.match(html, /132 种风格/);
  assert.doesNotMatch(html, /1188 张不同真实客片/);
  const library = libraryFixture();
  assert.equal(library.featuredStyleIds.length, 8);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-explorer.test.mjs --test-name-pattern='progressive|compact'`

Expected: FAIL because the new hooks and CSS are absent.

- [ ] **Step 3: Add semantic explorer markup**

```html
<section class="style-explorer" id="style-explorer" aria-labelledby="style-explorer-title" hidden>
  <header class="style-explorer-heading">
    <p>132 PORTRAIT STYLES</p>
    <h2 id="style-explorer-title">先选感觉，<br />再看 9 个拍摄参考。</h2>
    <span>132 种风格 · 内景 66 · 外景 66</span>
  </header>
  <nav class="style-featured" id="style-featured" aria-label="南铂精选"></nav>
  <div class="style-scene-tabs" id="style-scene-tabs" role="tablist" aria-label="选择内景或外景"></div>
  <div class="style-family-tabs" id="style-family-tabs" role="tablist" aria-label="选择风格方向"></div>
  <div class="style-card-grid" id="style-card-grid" aria-live="polite"></div>
</section>
```

Keep the existing flat 158-photo gallery under a secondary “浏览全部真实客片” disclosure so existing filters and `?theme=` links remain available.

Populate `#style-featured` only from catalog `featuredStyleIds`, label the group `南铂精选`, and render 8 shortcuts in the catalog order. Do not label it “大家常选”“热门” or imply behavioral ranking until real click/favorite data exists.

- [ ] **Step 4: Implement one-click whole-card rendering**

```js
function renderStyleCard(style) {
  const cover = style.slots.find((slot) => slot.isCover) || style.slots[0];
  const article = document.createElement("article");
  article.className = "portrait-style-card";
  article.innerHTML = `
    <button class="portrait-style-card-open" type="button" aria-label="查看${escapeText(style.label)}的9个拍摄参考">
      <span class="portrait-style-card-image"><img width="480" height="640" loading="lazy" decoding="async" alt="${escapeText(style.label)}男士拍摄参考"></span>
      <span class="portrait-style-scene">${style.scene === "indoor" ? "内景" : "外景"}</span>
      <span class="portrait-style-copy"><strong>${escapeText(style.label)}</strong><i></i><small>${escapeText(style.audience)}</small></span>
    </button>
    <button class="portrait-style-like" type="button" aria-label="收藏${escapeText(style.label)}">♡</button>`;
  const image = article.querySelector("img");
  image.src = cover.asset.thumb;
  article.querySelector(".portrait-style-card-open").addEventListener("click", () => openStyle(style.id));
  return article;
}
```

Use text nodes or an `escapeText()` helper for every catalog value. Render exactly the active family’s 11 cards and no other family images.

- [ ] **Step 5: Add premium responsive styling**

Implement `aspect-ratio:2/3` for the card, `3/4` for the image, a compact white information strip, 6px divider clearance, 44px controls, warm white/black/muted gold palette, 160–220ms feedback, and `prefers-reduced-motion` overrides. At 390px use two columns; desktop uses three columns inside the existing centered site shell. Render a fixed-ratio warm-gray skeleton before each image, replace a failed image with the existing NBO fallback mark plus readable style text, clear stale image `src` values when changing family, and keep keyboard focus/pressed states visible without adding colored marketplace badges.

- [ ] **Step 6: Run interaction and legacy regression tests**

Run: `node --test tests/portfolio-style-explorer.test.mjs tests/portfolio-interaction.test.mjs tests/portfolio-analytics.test.mjs`

Expected: PASS; existing hero, price card and legacy gallery assertions remain green.

- [ ] **Step 7: Commit the progressive selector**

```bash
git add apps/portfolio-v2/style-explorer.js apps/portfolio-v2/index.html apps/portfolio-v2/styles.css apps/portfolio-v2/app.js tests/portfolio-style-explorer.test.mjs
git commit -m "feat: add premium 132-style explorer"
```

### Task 7: 加入 9 张相册、单张查看和自然返回逻辑

**Files:**
- Modify: `apps/portfolio-v2/style-explorer.js`
- Modify: `apps/portfolio-v2/app.js:772-811`
- Modify: `apps/portfolio-v2/index.html:322-386`
- Modify: `apps/portfolio-v2/styles.css`
- Modify: `tests/portfolio-style-explorer.test.mjs`

**Interfaces:**
- Changes: `openViewer(index, items, context = {})`, where `context` is `{ styleId?:string, slotIds?:string[] }`.
- Produces: style album with `data-slot-id` for all 9 positions.

- [ ] **Step 1: Add failing album, viewer and history tests**

```js
test("an opened style exposes exactly nine ordered slots and stable URL state", () => {
  const style = libraryFixture().styles[0];
  assert.equal(style.slots.length, 9);
  assert.deepEqual(style.slots.map((slot) => slot.position), [1,2,3,4,5,6,7,8,9]);
  const params = serializeExplorerLocation({ scene: "indoor", familyId: "IN-01", styleId: style.id, view: "album" });
  assert.equal(params.get("style"), style.id);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-explorer.test.mjs --test-name-pattern='exactly nine'`

Expected: FAIL until album location serialization and markup exist.

- [ ] **Step 3: Render the 9-photo album**

```js
function renderAlbum(style) {
  albumTitle.textContent = style.label;
  albumDescription.textContent = `${style.audience} · ${style.description}`;
  albumGrid.replaceChildren(...style.slots.map((slot, index) => {
    const card = document.createElement("article");
    card.className = `pose-card${index === 0 ? " is-lead" : ""}`;
    card.dataset.slotId = slot.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "pose-open";
    open.addEventListener("click", () => onOpenViewer(index, style.slots.map(({ asset }) => asset), {
      styleId: style.id,
      slotIds: style.slots.map(({ id }) => id),
    }));
    const image = document.createElement("img");
    image.src = slot.asset.thumb;
    image.width = 480; image.height = 640; image.loading = "lazy"; image.decoding = "async";
    open.append(image);
    card.append(open, renderPoseChoice(slot));
    return card;
  }));
}
```

- [ ] **Step 4: Adapt the existing viewer without duplicating it**

Track `viewerContext`; show `03 / 09`, preserve asset favorite behavior, and expose a separate `#viewer-pose-choice` only when `context.slotIds` is present. Swipe, arrow keys, close, and browser back must dispatch Task 5 actions and restore the album rather than closing the entire experience.

- [ ] **Step 5: Verify on mobile and desktop**

Run: `node --test tests/portfolio-style-explorer.test.mjs tests/portfolio-interaction.test.mjs`

Expected: PASS. Then open the local preview at 390px and desktop widths; confirm returning from viewer restores album and returning from album restores the original style-card scroll position.

- [ ] **Step 6: Commit album and viewer integration**

```bash
git add apps/portfolio-v2/style-explorer.js apps/portfolio-v2/app.js apps/portfolio-v2/index.html apps/portfolio-v2/styles.css tests/portfolio-style-explorer.test.mjs
git commit -m "feat: add nine-pose style albums"
```

### Task 8: 分离风格收藏、旧照片收藏和姿势需求

**Files:**
- Create: `apps/portfolio-v2/style-preferences.js`
- Modify: `apps/portfolio-v2/style-explorer.js`
- Modify: `apps/portfolio-v2/app.js:176-240,718-924`
- Modify: `apps/portfolio-v2/index.html:388-422`
- Modify: `tests/portfolio-style-explorer.test.mjs`

**Interfaces:**
- Produces: `readStylePreferences(storage, library) -> { styleIds:Set<string>, slotIds:Set<string> }`.
- Produces: `writeStylePreferences(storage, preferences)`.
- Produces: `buildPoseBrief({ slotIds, library, legacyFavoriteAssets, settings }) -> { groups, text }`.
- Storage keys: `nanbo-favorite-styles`, `nanbo-selected-poses`; preserve existing `nanbo-favorite-photos`.

- [ ] **Step 1: Add failing persistence and grouping tests**

```js
test("pose selections group by style without clearing legacy photo favorites", () => {
  const storage = memoryStorage({ "nanbo-favorite-photos": "[137]" });
  const preferences = readStylePreferences(storage, libraryFixture());
  preferences.styleIds.add("ST-IN-01-01");
  preferences.slotIds.add("ST-IN-01-01-P03");
  writeStylePreferences(storage, preferences);
  assert.equal(storage.getItem("nanbo-favorite-photos"), "[137]");
  const brief = buildPoseBrief({ slotIds: preferences.slotIds, library: libraryFixture(), legacyFavoriteAssets: [137], settings: {} });
  assert.equal(brief.groups[0].styleId, "ST-IN-01-01");
  assert.match(brief.text, /职业形象.*第3个拍摄参考/s);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-explorer.test.mjs --test-name-pattern='pose selections'`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement validated local preferences**

```js
export function readStylePreferences(storage, library) {
  const validStyles = new Set(library.styles.map(({ id }) => id));
  const validSlots = new Set(library.slots.map(({ id }) => id));
  return {
    styleIds: new Set(readArray(storage, "nanbo-favorite-styles").filter((id) => validStyles.has(id))),
    slotIds: new Set(readArray(storage, "nanbo-selected-poses").filter((id) => validSlots.has(id))),
  };
}
```

Build the request text in style/position order. Use a human-reviewed `poseLabel` when it differs from neutral `拍摄参考 01`–`09`; otherwise fall back to `第 N 个拍摄参考`:

```text
南铂摄影拍摄需求
风格：职业形象
想拍姿势：第 3、7 个拍摄参考
补充要求：仅包含客户主动填写的备注
```

When pose selections exist, show them first in the existing selection sheet; list legacy favorite assets under “其他喜欢客片”. Do not collect new personal fields.

- [ ] **Step 4: Add real UI state and analytics events**

Use `style_favorite_add/remove`, `pose_select_add/remove`, `style_album_open`, and `style_viewer_open` event names. No fake popularity is derived until real event data exists.

- [ ] **Step 5: Run regression tests**

Run: `node --test tests/portfolio-style-explorer.test.mjs tests/portfolio-analytics.test.mjs`

Expected: PASS; old favorites are readable and the existing copy/WeChat/phone actions remain functional.

- [ ] **Step 6: Commit preferences and demand generation**

```bash
git add apps/portfolio-v2/style-preferences.js apps/portfolio-v2/style-explorer.js apps/portfolio-v2/app.js apps/portfolio-v2/index.html tests/portfolio-style-explorer.test.mjs
git commit -m "feat: add style favorites and pose briefs"
```

### Task 9: 支持四位以上资产编号并建立照片位写时复制存储

**Files:**
- Create: `tools/portfolio-style-store.mjs`
- Create: `tests/portfolio-style-manager.test.mjs`
- Modify: `tools/portfolio-photo-lib.mjs:48-72,434-458,580-610`

**Interfaces:**
- Produces: `createPortfolioStyleStore({ rootDir, photoRoot, additionsPath, catalogPath, assignmentsPath })`.
- Store methods: `read()`, `replaceSlot({ slotId, inputPath, originalName })`, `undoSlot(slotId)`, `updateLayout({ styleId, orderedSlotIds, coverSlotId, maturity })`, `updateStyleMeta({ styleId, label, audience, description, visibility })`, `updateSlotMeta({ slotId, poseLabel })`.
- Produces: `assertPublicAssetCode(code)` accepting `NB-001` and `NB-1000` but rejecting fewer than 3 digits.

- [ ] **Step 1: Add failing ID and copy-on-write tests**

```js
test("asset codes support NB-1000 without changing three-digit legacy codes", () => {
  assert.equal(slotCode(37), "NB-037");
  assert.equal(slotCode(1000), "NB-1000");
  assert.equal(assertPublicAssetCode("NB-1000"), 1000);
});

test("replacing a reused slot creates one new asset and changes only that slot", async (t) => {
  const fixture = await createStyleStoreFixture(t, { sharedAssetId: 137 });
  const before = await fixture.store.read();
  const result = await fixture.store.replaceSlot({ slotId: "ST-IN-01-01-P01", inputPath: fixture.validPhoto, originalName: "new.jpg" });
  const after = await fixture.store.read();
  assert.equal(result.assetId, 159);
  assert.equal(after.slotById["ST-IN-01-01-P01"].assetId, 159);
  assert.equal(after.slotById["ST-IN-01-02-P01"].assetId, 137);
  assert.equal(before.assetCount + 1, after.assetCount);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-manager.test.mjs`

Expected: FAIL because codes over three digits and style store are unsupported.

- [ ] **Step 3: Upgrade filename matching without weakening validation**

Change public asset regex from `photo-(\d{3})` to `photo-(\d{3,})`; keep `padStart(3, "0")` so 1–999 URLs remain byte-for-byte compatible. `assertPhotoId()` remains the legacy in-place replacement guard; the new style store validates additions separately.

Reuse the existing photo probe/derivative pipeline for each new asset: allow JPEG/PNG/WebP input within the existing size ceiling, require portrait 3:4 within the current tolerance and at least 900×1200, generate exactly 1080×1440 JPG plus 480×640 WebP, strip private metadata, and reject the transaction before touching manifests when any validation fails.

- [ ] **Step 4: Implement atomic copy-on-write transaction**

```js
async function replaceSlot({ slotId, inputPath, originalName }) {
  const state = await read();
  const slot = state.slotById[slotId];
  if (!slot) throw new Error("照片位不存在");
  const nextId = Math.max(...state.assetIds) + 1;
  const temporary = await prepareNewAsset(nextId, inputPath);
  const now = new Date().toISOString();
  const nextAssignments = replaceAssignmentAsset(state.assignments, slotId, {
    assetId: nextId,
    source: "upload",
    updatedAt: now,
  });
  const nextAdditions = appendPublishedAsset(state.additions, nextId, slot.style, originalName);
  return commitStyleTransaction({ slotId, nextId, temporary, nextAssignments, nextAdditions });
}
```

The transaction backs up both JSON files, installs full/thumb assets, writes additions and assignments through temporary files plus rename, records `.local/portfolio-style-transactions/<timestamp>/meta.json`, and rolls back all four outputs on failure.

`updateStyleMeta()` writes only the five allowed public fields while preserving ID/family/scene/order, and validates `visibility` as `published|hidden`. `updateSlotMeta()` changes only the selected stable slot's human-reviewed `poseLabel`. Both use the same temporary-file/rename transaction journal, so a crash cannot leave catalog and assignments out of sync.

- [ ] **Step 5: Implement undo with reference protection**

`undoSlot(slotId)` restores the previous assignment. It deletes the new addition/assets only when no published slot and no other published catalog entry references that asset. A corrupt newest history entry is skipped in favor of the newest complete transaction, matching existing photo undo behavior.

- [ ] **Step 6: Run focused and existing photo tests**

Run: `node --test tests/portfolio-style-manager.test.mjs tests/portfolio-photo-workflow.test.mjs`

Expected: PASS, including current NB-001–158 replacement and undo.

- [ ] **Step 7: Commit the store**

```bash
git add tools/portfolio-style-store.mjs tools/portfolio-photo-lib.mjs tests/portfolio-style-manager.test.mjs
git commit -m "feat: add copy-on-write portfolio slots"
```

### Task 10: 增加本机风格管理安全接口

**Files:**
- Modify: `tools/portfolio-manager-server.mjs:1-80,250-303,728-790`
- Modify: `tests/portfolio-style-manager.test.mjs`

**Interfaces:**
- GET `/api/style-library` -> `{ ok, counts, families, styles, pendingCount, version }`.
- GET `/api/assets/references?id=<assetId>` -> `{ assetId, slotIds, styleIds, count }`.
- POST `/api/style-slots/replace?slot=<slotId>` raw image + `X-File-Name`.
- POST `/api/style-slots/undo?slot=<slotId>`.
- POST `/api/style-slots/meta` JSON `{ slotId, poseLabel }`.
- POST `/api/styles/layout` JSON `{ styleId, orderedSlotIds, coverSlotId, maturity }`.
- POST `/api/styles/meta` JSON `{ styleId, label, audience, description, visibility }`.
- All POST routes require `X-Nanbo-Token` and existing exact-local-origin checks.

- [ ] **Step 1: Add failing route and security tests**

```js
test("style mutation routes reject missing token and foreign origins", async (t) => {
  const server = await startManagerFixture(t);
  const missing = await fetch(`${server.url}/api/style-slots/undo?slot=ST-IN-01-01-P01`, { method: "POST" });
  assert.equal(missing.status, 403);
  const foreign = await fetch(`${server.url}/api/styles/layout`, {
    method: "POST",
    headers: { Origin: "https://evil.example", "X-Nanbo-Token": server.token, "Content-Type": "application/json" },
    body: JSON.stringify({ styleId: "ST-IN-01-01", orderedSlotIds: [], coverSlotId: "", maturity: "reference" }),
  });
  assert.equal(foreign.status, 403);
});

test("asset reference lookup lists every affected style slot before global replacement", async (t) => {
  const server = await startManagerFixture(t);
  const response = await fetch(`${server.url}/api/assets/references?id=137`);
  const payload = await response.json();
  assert.equal(payload.count, payload.slotIds.length);
  assert.ok(payload.count > 1);
  assert.ok(payload.slotIds.every((slotId) => /^ST-(IN|OUT)-/.test(slotId)));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-manager.test.mjs --test-name-pattern='mutation routes'`

Expected: FAIL because routes return 404.

- [ ] **Step 3: Wire the style store and JSON payload**

Create the store once after incomplete transaction recovery. The library payload reports `132 styles`, `1188 slots`, current unique public asset count, scene `66/66`, and per-style maturity. Do not expose local filesystem paths, transaction paths, original filenames, or authorization records in GET responses.

- [ ] **Step 4: Add exact route handlers**

```js
if (request.method === "GET" && url.pathname === "/api/style-library") {
  json(response, 200, { ok: true, ...(await styleLibraryPayload()) });
  return;
}
if (request.method === "POST" && url.pathname === "/api/style-slots/replace") {
  requireSession(request);
  await replaceStyleSlotRequest(request, response, url);
  return;
}
```

Every mutation must call `beginMutation()`/`finishMutation()` so simultaneous publish or replacement requests return a deterministic busy error.

- [ ] **Step 5: Run server and regression tests**

Run: `node --test tests/portfolio-style-manager.test.mjs tests/portfolio-draft-library.test.mjs`

Expected: PASS; current draft and replace routes remain protected and usable.

- [ ] **Step 6: Commit server APIs**

```bash
git add tools/portfolio-manager-server.mjs tests/portfolio-style-manager.test.mjs
git commit -m "feat: expose local style management api"
```

### Task 11: 增加后台“风格相册”层级管理和单张替换

**Files:**
- Create: `tools/portfolio-manager/style-mode.js`
- Modify: `tools/portfolio-manager/index.html:1-260`
- Modify: `tools/portfolio-manager/styles.css`
- Modify: `tools/portfolio-manager/app.js:1-220,585-723`
- Modify: `tests/portfolio-style-manager.test.mjs`

**Interfaces:**
- Produces: `createStyleMode({ root, requestJson, showToast, openPreview }) -> { activate(), refresh(), setBusy(busy) }`.
- Consumes: `/api/style-library`, reference lookup, single replace, undo, layout and metadata routes from Task 10.

- [ ] **Step 1: Add failing manager markup tests**

```js
test("manager exposes a dedicated hierarchical style album mode", async () => {
  const html = await readFile(new URL("../tools/portfolio-manager/index.html", import.meta.url), "utf8");
  assert.match(html, /value="styles"/);
  assert.match(html, /id="style-library-view"/);
  assert.match(html, /id="style-family-list"/);
  assert.match(html, /id="style-list"/);
  assert.match(html, /id="style-slot-grid"/);
  assert.match(html, /id="style-maturity"/);
  assert.match(html, /id="style-copy-editor"/);
  assert.match(html, /id="style-visibility"/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-manager.test.mjs --test-name-pattern='hierarchical'`

Expected: FAIL because the mode is absent.

- [ ] **Step 3: Add the third manager mode and hierarchy**

Add a `styles` radio beside `public` and `drafts`. On activation, show scene segmented control, 6 family rows, 11 style rows, then exactly 9 slot cards. The selected style header shows `reference/updating/complete` as `风格参考/正在完善/完整客片组`, `9 个照片位`, and actual unique asset count.

Each slot card shows stable slot ID, current `NB-*` asset, reference count, editable pose label, cover state, replace and undo. The style side panel edits only name, audience, one-line description and `published/hidden`; hiding removes the style from the customer selector but keeps all slots, history and direct manager access. A hidden direct public URL must fall back to its family rather than render hidden content.

- [ ] **Step 4: Implement single-position replacement**

```js
async function replaceSlot(slotId, file) {
  setBusy(true);
  try {
    await requestJson(`/api/style-slots/replace?slot=${encodeURIComponent(slotId)}`, {
      method: "POST",
      headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
      body: file,
    });
    showToast("只替换了当前照片位，其他复用位置不变", "success");
    await refresh();
  } finally {
    setBusy(false);
  }
}
```

Before upload, show current asset and new preview side by side plus the exact copy-on-write explanation. The old “replace NB-* everywhere” operation stays in public-library mode and is not the default from style mode.

Before the existing public-library “replace this NB asset everywhere” action runs, call `/api/assets/references`; when `count > 1`, list every affected style and slot, label `只替换当前照片位` as the recommended path, and require a second explicit confirmation for `替换全部引用`. Tests must prove cancel leaves every file and manifest unchanged.

- [ ] **Step 5: Add metadata, visibility, per-slot undo and cover selection**

Save reviewed pose labels through `/api/style-slots/meta` and style copy/visibility through `/api/styles/meta`. Undo calls the dedicated slot endpoint. Cover changes use `/api/styles/layout`; only one slot can be cover and it must belong to the selected style. “本地预览” opens the exact selected style URL in `/preview/`; the existing “同步网站” action remains gated by full validation and does not publish merely because metadata was saved.

- [ ] **Step 6: Run manager and draft regression tests**

Run: `node --test tests/portfolio-style-manager.test.mjs tests/portfolio-draft-library.test.mjs`

Expected: PASS. Open `http://127.0.0.1:4174/` and confirm all three modes switch without losing selection.

- [ ] **Step 7: Commit manager hierarchy**

```bash
git add tools/portfolio-manager/style-mode.js tools/portfolio-manager/index.html tools/portfolio-manager/styles.css tools/portfolio-manager/app.js tests/portfolio-style-manager.test.mjs
git commit -m "feat: add hierarchical style album manager"
```

### Task 12: 增加整组 9 张、拖动排序和原子提交

**Files:**
- Modify: `tools/portfolio-style-store.mjs`
- Modify: `tools/portfolio-manager-server.mjs`
- Modify: `tools/portfolio-manager/style-mode.js`
- Modify: `tools/portfolio-manager/index.html`
- Modify: `tools/portfolio-manager/styles.css`
- Modify: `tests/portfolio-style-manager.test.mjs`

**Interfaces:**
- POST `/api/style-batches` -> `{ batchId }`.
- PUT `/api/style-batches/<batchId>/files/<position>` raw image.
- POST `/api/style-batches/<batchId>/commit` JSON `{ styleId, orderedPositions }`.
- DELETE `/api/style-batches/<batchId>` discards local staging.
- Store methods: `createBatch()`, `stageBatchFile()`, `commitBatch()`, `discardBatch()`.

- [ ] **Step 1: Add failing all-or-nothing batch tests**

```js
test("nine-photo batch is atomic when one file is invalid", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const batchId = await fixture.store.createBatch();
  for (let position = 1; position <= 8; position += 1) await fixture.store.stageBatchFile(batchId, position, fixture.validPhoto);
  await assert.rejects(() => fixture.store.stageBatchFile(batchId, 9, fixture.invalidPhoto), /3:4|尺寸/);
  await assert.rejects(() => fixture.store.commitBatch({ batchId, styleId: "ST-IN-01-01", orderedPositions: [1,2,3,4,5,6,7,8,9] }), /缺少第 9 张/);
  assert.deepEqual((await fixture.store.read()).assignments, fixture.originalAssignments);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-style-manager.test.mjs --test-name-pattern='batch is atomic'`

Expected: FAIL because batch methods are absent.

- [ ] **Step 3: Implement isolated batch staging**

Stage files under `.local/portfolio-style-batches/<uuid>/`, store only generated derivatives and validation metadata, require positions 1–9 exactly once, and reject paths not inside the batch root. `commitBatch()` reserves nine consecutive asset IDs and uses one transaction covering 18 asset files plus both JSON manifests.

- [ ] **Step 4: Implement reorder and cover UI**

Use pointer/keyboard-compatible drag handles. The UI sends the final ordered slot IDs only after the user clicks “保存顺序”; visual dragging alone must not mutate disk. The cover selector follows the moved slot, not the old numeric position.

- [ ] **Step 5: Add maturity calculation**

After replacement, compute `reference` when 0 slots have `source === "upload"`, `updating` for 1–8 uploaded slots, and allow `complete` only when all 9 slots have `source === "upload"`, each asset is unique, all assets were created for this style, and an operator confirms public eligibility. Never infer maturity from whether an asset ID is over 158.

- [ ] **Step 6: Run batch, server and manager tests**

Run: `node --test tests/portfolio-style-manager.test.mjs tests/portfolio-draft-library.test.mjs`

Expected: PASS, including partial upload feedback with no partial assignment commit.

- [ ] **Step 7: Commit batch workflow**

```bash
git add tools/portfolio-style-store.mjs tools/portfolio-manager-server.mjs tools/portfolio-manager/style-mode.js tools/portfolio-manager/index.html tools/portfolio-manager/styles.css tests/portfolio-style-manager.test.mjs
git commit -m "feat: add atomic nine-photo style replacement"
```

### Task 13: 把 132/1188 校验、版本哈希和发布流程接通

**Files:**
- Modify: `tools/portfolio-photo-lib.mjs:525-665`
- Modify: `tools/export-github-pages.mjs:1-211`
- Modify: `tools/validate-portfolio-photos.mjs`
- Modify: `tools/portfolio-manager-server.mjs:570-707`
- Modify: `package.json`
- Modify: `tests/portfolio-photo-workflow.test.mjs`
- Modify: `tests/portfolio-style-manager.test.mjs`

**Interfaces:**
- Extends: `validatePortfolioLibrary()` result with `{ styleCount, styleSlotCount, uniqueStyleAssetCount }`.
- Extends: `buildPortfolioVersion()` hash inputs with the catalog, assignments and new JS modules.

- [ ] **Step 1: Add failing publication-invariant tests**

```js
test("public validation includes the 132-style and 1188-slot manifests", async () => {
  const result = await validatePortfolioLibrary(styleFixtureOptions());
  assert.equal(result.ok, true);
  assert.equal(result.styleCount, 132);
  assert.equal(result.styleSlotCount, 1188);
  assert.equal(result.uniqueStyleAssetCount, 158);
});

test("one missing style assignment stops export", async () => {
  const fixture = await styleFixtureOptions({ removeStyleId: "ST-OUT-06-11" });
  const result = await validatePortfolioLibrary(fixture);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("ST-OUT-06-11")));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/portfolio-photo-workflow.test.mjs tests/portfolio-style-manager.test.mjs --test-name-pattern='132-style|missing style'`

Expected: FAIL because the validator ignores new manifests.

- [ ] **Step 3: Add style invariants to publication validation**

Read and normalize both JSON files during `validatePortfolioLibrary()`. Require all 132/66/66/6×11/1188 conditions, valid assets, same-scene references, one cover, no duplicate inside a style, and no local/private fields. Require every seeded slot to be `{ source:"seed", updatedAt:null }`; every uploaded slot to be `{ source:"upload", updatedAt:<valid ISO date> }`; recompute maturity from those sources and reject a manifest whose stored maturity disagrees.

- [ ] **Step 4: Include every new runtime input in versioning**

Hash these exact additions alongside existing files:

```js
const styleVersionInputs = [
  "apps/portfolio-v2/style-catalog.json",
  "apps/portfolio-v2/style-slot-assignments.json",
  "apps/portfolio-v2/style-library.js",
  "apps/portfolio-v2/style-explorer-model.js",
  "apps/portfolio-v2/style-preferences.js",
  "apps/portfolio-v2/style-explorer.js",
];
```

- [ ] **Step 5: Export and verify static parity**

The existing recursive copy already includes the new files; add tests that `docs/projects/portfolio-v2/` contains byte-matching JSON/JS and that `/p/` resolves them through the existing `<base>`. Do not expose `.local` reports or manager files.

- [ ] **Step 6: Update portfolio test script**

Append the three new test files to `portfolio:test` with `--test-concurrency=1`.

- [ ] **Step 7: Run full portfolio verification**

Run: `npm run portfolio:test && npm run portfolio:validate && npm run pages:build`

Expected: all tests PASS; validator prints `158 unique assets · 132 styles · 1188 slots`; generated `/p/` build version changes.

- [ ] **Step 8: Commit publish integration**

```bash
git add tools/portfolio-photo-lib.mjs tools/export-github-pages.mjs tools/validate-portfolio-photos.mjs tools/portfolio-manager-server.mjs package.json tests/portfolio-photo-workflow.test.mjs tests/portfolio-style-manager.test.mjs docs/projects/portfolio-v2 docs/p
git commit -m "feat: publish complete 132-style portfolio"
```

### Task 14: 完成视觉、性能、手机交互和线上发布验收

**Files:**
- Modify: `tests/portfolio-style-explorer.test.mjs`
- Modify: `tests/portfolio-analytics.test.mjs`
- Create: `docs/portfolio-132-style-mobile.png`
- Create: `docs/portfolio-132-style-desktop.png`

**Interfaces:**
- Consumes: final local preview and fixed `/p/` output.
- Produces: verified screenshots and deployment evidence; no new product interface.

- [ ] **Step 1: Add failing browser acceptance checks**

```js
import { existsSync } from "node:fs";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(chromePath);

test("style explorer loads eleven covers first and nine thumbs only after opening", { skip: !hasChrome }, async () => {
  const before = await measureStyleExplorer({ scene: "indoor", familyId: "IN-01" });
  assert.equal(before.visibleStyleCards, 11);
  assert.ok(before.styleImageRequests <= 11);
  assert.equal(before.visiblePoseCards, 0);

  const after = await measureStyleExplorer({
    scene: "indoor",
    familyId: "IN-01",
    clickStyleId: "ST-IN-01-01",
  });
  assert.equal(after.visiblePoseCards, 9);
  assert.ok(after.newThumbRequests <= 9);
  assert.equal(after.fullImageRequests, 0);
});
```

Implement `measureStyleExplorer()` in this test file, modeled on the existing temporary HTTP server and Chrome `--dump-dom` helpers in `tests/portfolio-analytics.test.mjs`:

1. Serve the real `apps/portfolio-v2` directory from a random local port and open `index.html?scene=<scene>&family=<familyId>` at `390×844` with `--headless=new --window-size=390,844 --virtual-time-budget=2500 --dump-dom`.
2. Inject a test-only probe before `</body>` in the served HTML. After app initialization it reads `performance.getEntriesByType("resource")`, counts visible `.portrait-style-card` and `.style-pose-card` elements, and records requested `/assets/thumbs/` and `/assets/full/` URLs.
3. If `clickStyleId` is present, snapshot the initial URLs, call `.click()` on `[data-style-id="<id>"] .portrait-style-card-open`, wait two animation frames plus 250ms, and report only newly requested thumbnails.
4. Serialize the result as escaped JSON in `<pre id="style-explorer-metrics">`; parse that node from dumped DOM. Always close the server in `finally`. Skip only this browser assertion when `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` is absent.

- [ ] **Step 2: Run and verify RED if any acceptance requirement is missing**

Run: `node --test tests/portfolio-style-explorer.test.mjs tests/portfolio-analytics.test.mjs`

Expected: any missing performance, layout or interaction assertion fails before final fixes.

- [ ] **Step 3: Fix only observed acceptance failures**

Do not redesign passing areas. Fix concrete failures such as 390px overflow, bottom-nav overlap, wrong card ratio, more than 11 initial image requests, lost scroll restoration, inaccessible 44px target, or reduced-motion violation.

- [ ] **Step 4: Capture local acceptance screenshots**

Capture:

- 390×844 showing scene, six families and 11 compact cards;
- 390×844 showing one 9-photo album;
- 1440×1200 showing the desktop selector and album panel.

Save the representative mobile and desktop overview files at the paths listed above and inspect them visually before commit.

Also open `.local/portfolio-style-cover-audit.html` and inspect all 132 covers in order. Record any wrong-scene, visibly duplicated-adjacent, badly cropped, or implausibly named cover in `.local/portfolio-style-cover-review.json`, correct assignments, regenerate, and repeat until the review file contains zero unresolved findings. This local review evidence must never be exported.

- [ ] **Step 5: Run complete verification from a clean feature worktree**

Run:

```bash
npm run portfolio:test
npm run portfolio:validate
npm run pages:build
git diff --check
git status --short
```

Expected: all tests pass, validation succeeds, no whitespace errors, and status contains only intended generated screenshots or already committed changes.

- [ ] **Step 6: Commit acceptance evidence**

```bash
git add tests/portfolio-style-explorer.test.mjs tests/portfolio-analytics.test.mjs docs/portfolio-132-style-mobile.png docs/portfolio-132-style-desktop.png
git commit -m "test: verify 132-style portfolio experience"
```

- [ ] **Step 7: Review and publish**

Use `superpowers:requesting-code-review`, resolve findings with `superpowers:receiving-code-review`, then use `superpowers:finishing-a-development-branch`. After merge to `main`, run the manager publish flow, wait for GitHub Pages, and verify the exact returned build version at both:

```text
https://wdmm630202.github.io/nbo-smart-system/p/build.json
https://wdmm630202.github.io/nbo-smart-system/p/?v=<exact-version>
```

On a real phone, verify scene/family switching, card open, 9-photo album, swipe viewer, pose selection, copied demand text, enterprise WeChat link, QR long-press, and `tel:17306657880`.

## Final Acceptance Checklist

- [ ] 132 styles, 66 indoor, 66 outdoor, 12 families and 1188 stable slots validate from production files.
- [ ] Initial public library uses 158 unique NBO assets and creates no physical duplicate photo files.
- [ ] Same style has no repeated asset; adjacent family covers do not repeat.
- [ ] Customer first sees 11 covers, then 9 thumbnails, then one high-resolution image.
- [ ] Card 2:3, image 3:4, compact white strip, scene pill and favorite align on 390px and desktop.
- [ ] Browser back restores family, card and scroll position.
- [ ] Style favorite, pose choice and legacy photo favorite remain independent.
- [ ] Demand copy groups selected poses by style and keeps contact actions unchanged.
- [ ] Replacing one reused slot creates one new `NB-*` asset and leaves every other reference untouched.
- [ ] `NB-1000` and later identifiers validate, render and publish correctly.
- [ ] Single undo, batch atomicity, reorder, cover and maturity pass tests.
- [ ] Local APIs reject foreign origins and missing tokens.
- [ ] Public build contains no local reports, research images, original filenames or client data.
- [ ] Existing hero carousel, 268 package, phone, enterprise WeChat, QR, footer and `/p/` regressions pass.

# 南铂摄影行业内容工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Mac 上交付可一键启动的南铂行业内容工作台，并用它真实生成、检查一条不出镜的摄影行业乱象竖屏视频。

**Architecture:** 公开 NBO 索引只提供项目介绍，本地 Node.js 服务仅绑定 `127.0.0.1:4176`，通过项目账本协调证据、文案、旁白、分镜、素材、渲染和质检。Codex 处理需要语义判断的阶段，本地工具处理文件、时间轴、FFmpeg 渲染与确定性验证。

**Tech Stack:** Node.js 22 ESM、原生 HTTP/HTML/CSS/JavaScript、FFmpeg/ffprobe、macOS AppleScript 文件选择器、Node `node:test`、现有 vinext/GitHub Pages 导出系统。

**Spec:** `docs/superpowers/specs/2026-08-31-nanbo-industry-content-workbench-design.md`

## Global Constraints

- 本地服务只能监听 `127.0.0.1:4176`，健康端点为 `/healthz`。
- 不在网页或 Git 中保存 API 密钥、Cookie、客户身份信息、旁白或本地视频工程。
- 默认运行根目录是用户“文稿”下的 `NBO-行业内容工作台/`，分为 `projects/`、`library/`、`cache/`、`exports/`。
- 原始素材只读；按绝对路径、SHA-256 指纹和媒体元数据引用，不改写原文件。
- 视频不使用用户出镜画面，首版不使用 AI 数字人。
- 南铂商业说法仅允许 `268拍摄2套`、`全部原片全送`、`不推销加精修`。
- 正式输出为 1080×1920、30 fps、H.264/AAC MP4；发布仍由用户手动完成。
- 没有证据、素材或实际可编辑工程时必须如实报告，不用无关素材、伪证据或 MP4 顶替。
- 保留用户现有改动；每个任务只提交该任务的明确文件。

---

## File Map

- `.gitignore`：忽略视觉陪审稿 `.superpowers/`，不影响正式文档。
- `tools/industry-content-workbench/constants.mjs`：端口、目录、阶段、输出规格和品牌事实常量。
- `tools/industry-content-workbench/project-store.mjs`：项目账本创建、校验、原子保存、状态迁移和重启恢复。
- `tools/industry-content-workbench/evidence-policy.mjs`：证据、结论和南铂事实门禁。
- `tools/industry-content-workbench/media-library.mjs`：只读素材索引、指纹、ffprobe 元数据和匹配队列。
- `tools/industry-content-workbench/render-project.mjs`：把旁白、分镜、字幕和品牌收尾转成 FFmpeg 渲染计划并执行。
- `tools/industry-content-workbench/qa-video.mjs`：视频参数、静音、黑帧、字幕安全区、素材指纹和产物完整性检查。
- `tools/industry-content-workbench/select-path.mjs`：仅在用户点击后调用 macOS 选择器，返回用户明确选中的文件或目录。
- `tools/industry-content-workbench/server.mjs`：本地 HTTP 服务、会话令牌、同源校验、状态 API 和预览静态文件。
- `apps/industry-content-workbench/index.html`：工作台语义结构。
- `apps/industry-content-workbench/styles.css`：Apple 风格、响应式、减少动效和可读性。
- `apps/industry-content-workbench/app.js`：引导流程、自动保存、阶段确认、复制 Codex 任务和视频预览。
- `content-workbench/AGENTS.md`：Codex 日更操作合同与事实、隐私、交付门禁。
- `content-workbench/templates/episode-template.json`：新一期的空项目模板。
- `content-workbench/templates/episode-001-industry-pricing.json`：首条视频的可追溯项目配置。
- `content-workbench/templates/episode-001-evidence.md`：首条视频公开来源、事实和限定语。
- `content-workbench/templates/episode-001-script.md`：经证据门禁的旁白与屏幕文案。
- `content-workbench/README.md`：日常用法、目录、不自动发布边界。
- `打开南铂行业内容工作台.command`：定位绑定 Node 运行时、启动健康检查和打开浏览器。
- `tests/industry-content-project.test.mjs`：账本、状态和恢复。
- `tests/industry-content-evidence.test.mjs`：事实门禁。
- `tests/industry-content-media.test.mjs`：只读素材与指纹。
- `tests/industry-content-server.test.mjs`：本地绑定、会话令牌、同源和 API。
- `tests/industry-content-render.test.mjs`：渲染计划、输出参数与质检。
- `app/page.tsx`、`app/project-visuals.mjs`、`README.md`、`package.json`：南铂总索引、首页卡片、脚本和使用说明。
- `docs/index.html`、`docs/projects/video/index.html`：由现有 `pages:build` 生成，不手工维护重复内容。

---

### Task 1: 项目账本与本地资料边界

**Files:**
- Modify: `.gitignore`
- Create: `tools/industry-content-workbench/constants.mjs`
- Create: `tools/industry-content-workbench/project-store.mjs`
- Create: `content-workbench/templates/episode-template.json`
- Test: `tests/industry-content-project.test.mjs`

**Interfaces:**
- Produces: `createProjectStore({ rootDir, now })`，返回 `createProject(input)`、`readProject(id)`、`updateProject(id, mutate)`、`listProjects()`。
- Produces: `createEpisode(input)`，返回带六个固定阶段的 `EpisodeProject` JSON 对象。
- Consumes: Node `fs/promises`、`crypto.randomUUID`、系统 Documents 目录。

- [ ] **Step 1: 写账本创建、原子更新和恢复的失败测试**

```js
test("新建项目包含六个阶段并能原子恢复", async () => {
  const store = createProjectStore({ rootDir: temporaryRoot, now: () => "2026-08-31T00:00:00.000Z" });
  const created = await store.createProject({ title: "低价摄影的真实价格", platform: "xiaohongshu" });
  assert.deepEqual(created.stages.map(({ id }) => id), STAGE_IDS);
  await store.updateProject(created.projectId, (project) => ({ ...project, currentStage: "script" }));
  assert.equal((await store.readProject(created.projectId)).currentStage, "script");
});
```

- [ ] **Step 2: 运行定向测试并确认因模块不存在而失败**

Run: `node --test tests/industry-content-project.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现常量、默认目录、项目模板和原子账本**

```js
export const STAGE_IDS = ["evidence", "script", "voice", "storyboard", "qa", "export"];
export const STAGE_STATUSES = ["pending", "running", "needs_review", "completed", "failed"];
export const OUTPUT_SPEC = { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac" };

async function atomicJson(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
```

实现时校验 `projectId`、`currentStage`、阶段数量和状态枚举；更新时先读取、校验、写临时文件，再原子替换。

- [ ] **Step 4: 运行项目账本测试**

Run: `node --test tests/industry-content-project.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交账本层**

```bash
git add .gitignore tools/industry-content-workbench/constants.mjs tools/industry-content-workbench/project-store.mjs content-workbench/templates/episode-template.json tests/industry-content-project.test.mjs
git commit -m "建立行业内容项目账本"
```

### Task 2: 证据与南铂商业事实门禁

**Files:**
- Create: `tools/industry-content-workbench/evidence-policy.mjs`
- Create: `content-workbench/AGENTS.md`
- Test: `tests/industry-content-evidence.test.mjs`

**Interfaces:**
- Consumes: `NANBO_ALLOWED_CLAIMS` from `constants.mjs`.
- Produces: `validateEvidenceItem(item): { ok, errors }`.
- Produces: `validateClaim(claim, evidenceItems): { ok, errors, supportingSourceIds }`.
- Produces: `validateNanboClaims(claimIds): { ok, errors }`.

- [ ] **Step 1: 写缺来源、不可追溯截图、普遍性结论和非白名单南铂说法的失败测试**

```js
test("只允许已确认的南铂商业事实", () => {
  assert.equal(validateNanboClaims(["package_268_two_sets", "all_originals_included"]).ok, true);
  assert.deepEqual(validateNanboClaims(["same_day_delivery"]), {
    ok: false,
    errors: ["未确认的南铂商业说法：same_day_delivery"],
  });
});
```

- [ ] **Step 2: 运行证据门禁测试并确认失败**

Run: `node --test tests/industry-content-evidence.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现证据结构、来源 URL 检查和结论风险规则**

```js
export const NANBO_ALLOWED_CLAIMS = new Map([
  ["package_268_two_sets", "268拍摄2套"],
  ["all_originals_included", "全部原片全送"],
  ["no_retouch_upsell", "不推销加精修"],
]);

const needsCorroboration = (claim) => Boolean(claim.quantified || claim.universal || claim.causal);
```

对投诉类来源要求表述为“公开反映”，不将投诉直接标记为“已证实事实”。`AGENTS.md` 明确禁止点名攻击、虚构案例、越过审核发布和把 MP4 写成剪映/ChatCut 工程。

- [ ] **Step 4: 运行证据测试**

Run: `node --test tests/industry-content-evidence.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交证据门禁**

```bash
git add tools/industry-content-workbench/evidence-policy.mjs content-workbench/AGENTS.md tests/industry-content-evidence.test.mjs
git commit -m "增加行业内容事实门禁"
```

### Task 3: 只读素材库与媒体元数据

**Files:**
- Create: `tools/industry-content-workbench/media-library.mjs`
- Create: `tools/industry-content-workbench/select-path.mjs`
- Test: `tests/industry-content-media.test.mjs`

**Interfaces:**
- Produces: `fingerprintFile(path): Promise<string>`.
- Produces: `probeMedia(path, { ffprobePath }): Promise<MediaProbe>`.
- Produces: `indexMedia(paths, options): Promise<MediaAsset[]>`.
- Produces: `verifyMediaFingerprint(asset): Promise<{ ok, actualSha256 }>`.
- Produces: `selectLocalPath({ kind }): Promise<string | null>` where `kind` is `file` or `folder`.

- [ ] **Step 1: 写索引不修改原文件、指纹变化被发现和 ffprobe 元数据规范化的失败测试**

```js
test("指纹变更会阻断旧素材引用", async () => {
  const [asset] = await indexMedia([fixturePath], { probe: fakeProbe });
  await writeFile(fixturePath, "changed");
  assert.equal((await verifyMediaFingerprint(asset)).ok, false);
});
```

- [ ] **Step 2: 运行素材测试并确认失败**

Run: `node --test tests/industry-content-media.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现流式 SHA-256、ffprobe JSON 规范化和 AppleScript 选择器**

```js
export async function fingerprintFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
```

AppleScript 只在 API 收到本地、带令牌的明确选择请求时执行；取消选择返回 `null`，不当作失败。

- [ ] **Step 4: 运行素材测试**

Run: `node --test tests/industry-content-media.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交只读素材层**

```bash
git add tools/industry-content-workbench/media-library.mjs tools/industry-content-workbench/select-path.mjs tests/industry-content-media.test.mjs
git commit -m "建立行业内容只读素材库"
```

### Task 4: 本地服务与安全 API

**Files:**
- Create: `tools/industry-content-workbench/server.mjs`
- Create: `tests/industry-content-server.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createProjectStore`、`indexMedia`、`selectLocalPath`.
- Produces: `createWorkbenchServer({ host, port, rootDir, openBrowser, dependencies })`.
- Produces endpoints: `GET /healthz`、`GET /api/bootstrap`、`GET /api/projects`、`POST /api/projects`、`GET /api/projects/:id`、`PATCH /api/projects/:id`、`POST /api/select-path`、`GET /media/:projectId/:assetId`.

- [ ] **Step 1: 写回环绑定、Host 白名单、会话令牌和跨站拒绝的失败测试**

```js
test("本地修改必须同源且携带会话令牌", async () => {
  const { origin, token, close } = await startTestServer();
  const rejected = await fetch(`${origin}/api/projects`, { method: "POST", body: "{}" });
  assert.equal(rejected.status, 403);
  const accepted = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nanbo-token": token, origin },
    body: JSON.stringify({ title: "测试项目", platform: "xiaohongshu" }),
  });
  assert.equal(accepted.status, 201);
  await close();
});
```

- [ ] **Step 2: 运行服务测试并确认失败**

Run: `node --test tests/industry-content-server.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现本地 HTTP 服务与静态文件边界**

```js
const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);
function requireMutation(request) {
  if (!allowedHosts.has(String(request.headers.host))) throw forbidden("已拒绝非本地请求");
  if (String(request.headers["sec-fetch-site"] || "") === "cross-site") throw forbidden("已拒绝跨站操作");
  if (request.headers["x-nanbo-token"] !== sessionToken) throw forbidden("工作台会话已过期");
}
```

`/healthz` 只返回版本、就绪与依赖状态；`/api/bootstrap` 返回会话令牌、阶段文案和项目列表；静态文件和预览必须经过真实路径边界检查。

- [ ] **Step 4: 运行服务测试**

Run: `node --test tests/industry-content-server.test.mjs`
Expected: PASS.

- [ ] **Step 5: 提交本地服务**

```bash
git add tools/industry-content-workbench/server.mjs tests/industry-content-server.test.mjs package.json
git commit -m "建立行业内容本地服务"
```

### Task 5: A 方案引导式工作台界面

**Files:**
- Create: `apps/industry-content-workbench/index.html`
- Create: `apps/industry-content-workbench/styles.css`
- Create: `apps/industry-content-workbench/app.js`
- Modify: `tests/industry-content-server.test.mjs`

**Interfaces:**
- Consumes: Task 4 HTTP API.
- Produces: 六阶段导航、当前阶段表单、无障碍状态、项目预览和“复制给 Codex”任务文本。

- [ ] **Step 1: 在服务测试中增加界面语义、六阶段、主操作和减少动效的失败断言**

```js
for (const label of ["选题与证据", "文案", "旁白", "分镜与素材", "字幕与质检", "导出"]) {
  assert.match(html, new RegExp(label));
}
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.match(html, /aria-live="polite"/);
```

- [ ] **Step 2: 运行服务测试并确认界面断言失败**

Run: `node --test tests/industry-content-server.test.mjs`
Expected: FAIL on missing workbench files or labels.

- [ ] **Step 3: 实现引导式界面**

```html
<nav class="stage-rail" aria-label="制作步骤">
  <button data-stage="evidence"><b>01</b><span>选题与证据</span><em>待处理</em></button>
  <button data-stage="script"><b>02</b><span>文案</span><em>待处理</em></button>
  <button data-stage="voice"><b>03</b><span>旁白</span><em>待处理</em></button>
  <button data-stage="storyboard"><b>04</b><span>分镜与素材</span><em>待处理</em></button>
  <button data-stage="qa"><b>05</b><span>字幕与质检</span><em>待处理</em></button>
  <button data-stage="export"><b>06</b><span>导出</span><em>待处理</em></button>
</nav>
```

使用系统字体、单一蓝色主操作、非颜色状态标签、即时 `:active` 反馈和 `prefers-reduced-motion` 替代。所有网络失败反映到 `aria-live` 状态区，不只写入控制台。

- [ ] **Step 4: 运行服务测试并真实打开界面**

Run: `node --test tests/industry-content-server.test.mjs`
Expected: PASS.
Then: 启动测试服务，在 Codex 浏览器中检查桌面和 390 px 宽度，确认无水平溢出。

- [ ] **Step 5: 提交工作台界面**

```bash
git add apps/industry-content-workbench tests/industry-content-server.test.mjs
git commit -m "完成行业内容引导式工作台"
```

### Task 6: 渲染计划、FFmpeg 输出与视频质检

**Files:**
- Create: `tools/industry-content-workbench/render-project.mjs`
- Create: `tools/industry-content-workbench/qa-video.mjs`
- Create: `tests/industry-content-render.test.mjs`

**Interfaces:**
- Consumes: `EpisodeProject`、`MediaAsset[]`、旁白 WAV/M4A、字幕和 `OUTPUT_SPEC`.
- Produces: `buildRenderPlan(project): RenderPlan`.
- Produces: `renderProject(plan, options): Promise<RenderReceipt>`.
- Produces: `inspectRenderedVideo(path, options): Promise<VideoQaReport>`.

- [ ] **Step 1: 写分辨率、帧率、编码、素材空缺和字幕安全区的失败测试**

```js
test("质检拒绝错误尺寸和缺失素材", () => {
  const report = validateRenderInputs({
    probe: { width: 720, height: 1280, fps: 25, videoCodec: "h264", audioCodec: "aac" },
    storyboard: [{ assetId: null, fallbackApproved: false }],
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /1080×1920/);
  assert.match(report.errors.join("\n"), /缺素材/);
});
```

- [ ] **Step 2: 运行渲染测试并确认失败**

Run: `node --test tests/industry-content-render.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现渲染计划和质检报告**

```js
export function buildRenderPlan(project) {
  if (!project.approvals.script || !project.approvals.voice) throw new Error("文案和旁白未放行");
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: project.storyboard,
    audioPath: project.voice.path,
    outputPath: project.outputs.preview,
  };
}
```

FFmpeg 渲染固定使用 `scale` + `crop`/`pad`、轻微 Ken Burns 推进、高对比度字幕底板和 BT.709 输出。中文字体从系统 PingFang 或华文黑体候选中选择实际存在文件；找不到时停止渲染并给出说明。质检用 ffprobe 校验参数，用 `blackdetect`、`silencedetect` 生成警告，不将含开场/收尾设计黑色背景的片段自动判为失败。

- [ ] **Step 4: 使用测试色块和静音音轨生成一支短视频，运行质检**

Run: `node --test tests/industry-content-render.test.mjs`
Expected: PASS and a temporary 1080×1920/30fps H.264/AAC fixture is removed after test.

- [ ] **Step 5: 提交渲染与质检层**

```bash
git add tools/industry-content-workbench/render-project.mjs tools/industry-content-workbench/qa-video.mjs tests/industry-content-render.test.mjs
git commit -m "完成行业视频渲染与质检"
```

### Task 7: 首条行业乱象视频内容包

**Files:**
- Create: `content-workbench/templates/episode-001-evidence.md`
- Create: `content-workbench/templates/episode-001-script.md`
- Create: `content-workbench/templates/episode-001-industry-pricing.json`
- Create: `content-workbench/README.md`
- Test: `tests/industry-content-evidence.test.mjs`

**Interfaces:**
- Consumes: Task 2 证据门禁与 Task 6 渲染账本结构。
- Produces: 经验证的证据报告、25–30 秒旁白、6 段分镜和发布文案源数据。

- [ ] **Step 1: 对公开来源做低频只读研究并建立可追溯证据条目**

优先级为：市场监管/消费者协会等官方消费提示；对摄影服务价格、底片、精修和交付争议的可追溯公开报道；已脱敏的公开投诉仅作“有人反映”的证据。记录页面标题、URL、发布日期、访问日期、支持说法和限定语。

- [ ] **Step 2: 把证据条目和拟用说法写入失败门禁测试**

```js
test("第 001 期所有口播说法都有证据或南铂白名单", async () => {
  const episode = JSON.parse(await readFile(episodePath, "utf8"));
  for (const claim of episode.claims) assert.equal(validateClaim(claim, episode.evidence).ok, true, claim.text);
  assert.equal(validateNanboClaims(episode.nanboClaimIds).ok, true);
});
```

- [ ] **Step 3: 运行第 001 期门禁测试并确认在内容包不完整时失败**

Run: `node --test tests/industry-content-evidence.test.mjs`
Expected: FAIL on missing episode evidence or unsupported claim.

- [ ] **Step 4: 完成口播、屏幕文案、分镜和发布文案**

口播固定遵循“钩子 → 底片/精修/套餐限制 → 机制 → 南铂三项透明事实 → 消费者四问 → 明码实价”。终版中如“199 到几千”没有直接可追溯案例，将钩子改为“低价拍照，为什么最后总价会变？”，不保留无证据数字。

- [ ] **Step 5: 运行内容门禁测试并提交内容包**

Run: `node --test tests/industry-content-evidence.test.mjs`
Expected: PASS.

```bash
git add content-workbench tests/industry-content-evidence.test.mjs
git commit -m "建立首期摄影消费乱象内容包"
```

### Task 8: 旁白、实际素材和首条成片

**Files:**
- Create outside Git: `Documents/NBO-行业内容工作台/projects/episode-001/voice/voice.wav`
- Create outside Git: `Documents/NBO-行业内容工作台/projects/episode-001/project.json`
- Create outside Git: `Documents/NBO-行业内容工作台/exports/episode-001/episode-001-preview.mp4`
- Create outside Git: `Documents/NBO-行业内容工作台/exports/episode-001/episode-001.srt`
- Create outside Git: `Documents/NBO-行业内容工作台/exports/episode-001/evidence-report.md`
- Create outside Git: `Documents/NBO-行业内容工作台/exports/episode-001/materials.json`
- Create outside Git: `Documents/NBO-行业内容工作台/exports/episode-001/qa-report.json`

**Interfaces:**
- Consumes: 已锁定口播、已公开南铂过程/客片素材、本机 TTS 或已授权语音服务、Task 6 渲染器。
- Produces: 可播放候选成片、字幕、证据、素材和质检回执。

- [ ] **Step 1: 检查 ChatCut/剪辑 Runtime、FFmpeg、ffprobe、字体和旁白能力**

Run the dedicated Chengfeng readiness workflow, then verify:

```bash
/Users/nanbosheyingimacpro/.local/bin/ffmpeg -version
/Users/nanbosheyingimacpro/.local/bin/ffprobe -version
test -x /Applications/ChatCut.app/Contents/MacOS/ChatCut
```

Expected: 就绪检查明确列出可用能力；任一关键依赖缺失时先修复环境，不制造假的成功回执。

- [ ] **Step 2: 生成一整条自然旁白并实际试听**

使用经门禁的口播一次合成整条旁白，不以多个短句硬拼。检查“底片”、“精修”、“明码实价”的发音，以及前后句衔接和语速。如应用只能生成短句，则改用可一次生成全文的本机/已授权途径。

- [ ] **Step 3: 索引已公开的南铂过程和客片素材**

优先使用已在南铂公开页面发布的门店过程图、选片图和客片；只在素材清单中引用其源路径和指纹。不更改原文件，不把证据截图与客片的个人信息暴露到成片。

- [ ] **Step 4: 渲染首版候选成片并执行工具质检**

Run: `node tools/industry-content-workbench/render-project.mjs --project '/Users/nanbosheyingimacpro/Documents/NBO-行业内容工作台/projects/episode-001/project.json'`
Then: `node tools/industry-content-workbench/qa-video.mjs --video '/Users/nanbosheyingimacpro/Documents/NBO-行业内容工作台/exports/episode-001/episode-001-preview.mp4' --project '/Users/nanbosheyingimacpro/Documents/NBO-行业内容工作台/projects/episode-001/project.json'`
Expected: MP4 为 1080×1920/30fps H.264/AAC，无空素材、指纹变更、无声音主体或未通过事实门禁。

- [ ] **Step 5: 抽帧、完整播放并交付候选成片**

抽取 0.5 秒、第一次转场、中段、品牌事实段和收尾帧，视觉检查文字越界、错配、个人信息和黑帧。完整播放旁白和成片。因用户已授权按推荐方案直接执行，工作台可生成“推荐候选版”；但在用户未亲自试听时项目账本不写入 `userApprovedVoice: true`，成片不自动发布。

### Task 9: macOS 一键启动与 NBO 唯一索引接入

**Files:**
- Create: `打开南铂行业内容工作台.command`
- Modify: `package.json`
- Modify: `app/page.tsx`
- Modify: `app/project-visuals.mjs`
- Modify: `README.md`
- Modify: `tests/system-index.test.mjs`
- Generated: `docs/index.html`
- Generated: `docs/projects/video/index.html`

**Interfaces:**
- Consumes: `server.mjs`、现有 `pages:build` 导出器。
- Produces: 双击启动器、`npm run content:workbench`、公开项目页和工作台说明。

- [ ] **Step 1: 先更新索引测试，要求新名称、本地地址、不自动发布和真实引导界面**

```js
test("行业内容工作台登记本地入口与安全边界", async () => {
  const [source, published, readme] = await Promise.all([read("app/page.tsx"), read("docs/index.html"), read("README.md")]);
  for (const document of [source, published, readme]) assert.match(document, /南铂行业内容工作台/);
  assert.match(source, /127\.0\.0\.1:4176/);
  assert.match(source, /不自动发布/);
});
```

- [ ] **Step 2: 运行索引测试并确认旧项目文案使其失败**

Run: `node --test tests/system-index.test.mjs`
Expected: FAIL on missing new project wording and local address.

- [ ] **Step 3: 实现启动器、包脚本、卡片文案与真实界面预览**

```bash
#!/bin/zsh
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
exec "$NODE_BIN" "$PROJECT_DIR/tools/industry-content-workbench/server.mjs" --open
```

启动器在执行前检查 Node 和项目服务文件；失败时在 Terminal 显示中文说明并保持窗口，不静默退出。卡片改名为“南铂行业内容工作台”，预览展示六阶段左侧栏、当前文案和质检状态，不再展示抽象时间轴。

- [ ] **Step 4: 生成 GitHub Pages 并运行索引回归**

Run: `npm run pages:build && node --test tests/system-index.test.mjs`
Expected: PASS; `docs/projects/video/index.html` 显示新名称、本地安全、六阶段和不自动发布边界。

- [ ] **Step 5: 提交启动与索引接入**

```bash
git add "打开南铂行业内容工作台.command" package.json app/page.tsx app/project-visuals.mjs README.md tests/system-index.test.mjs docs/index.html docs/projects/video/index.html
git commit -m "上线南铂行业内容工作台入口"
```

### Task 10: 全量回归、真实服务和桌面/手机验收

**Files:**
- Modify only if a discovered defect requires it: files from Tasks 1–9
- Create outside Git: final run receipts under `Documents/NBO-行业内容工作台/exports/episode-001/`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: passing repository tests, healthy local service, visual acceptance evidence, final candidate video and honest completion report.

- [ ] **Step 1: 运行全部新增测试与现有索引回归**

Run:

```bash
node --test tests/industry-content-*.test.mjs tests/system-index.test.mjs
npm run pages:build
git diff --check
```

Expected: all PASS and no whitespace errors.

- [ ] **Step 2: 双击等价启动，延时检查监听器与健康端点**

Run the `.command` launcher through a persistent terminal:

```bash
zsh './打开南铂行业内容工作台.command'
```

Then after the service reports ready:

```bash
curl -fsS http://127.0.0.1:4176/healthz
```

Expected: JSON has `ok: true`, correct version, write root, FFmpeg/ffprobe readiness, and no customer paths or credentials.

- [ ] **Step 3: 真实浏览器验收本地工作台**

在桌面宽度和 390×844 视口打开工作台，验证六阶段、项目列表、错误反馈、语音/视频预览、文字不截断和无水平溢出。刷新后项目进度不丢失。

- [ ] **Step 4: 完整播放首条候选成片并复核报告**

核对视频时长、声音、字幕、证据、南铂三项事实、素材指纹和质检报告。若未生成真实 ChatCut/剪映工程，输出中明确写“无外部剪辑器工程”。

- [ ] **Step 5: 运行发布前仓库检查并保留完成状态**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: only known user changes remain; workbench code and generated public pages are committed. Do not push or publish without a separate publish authorization if remote state or credentials require it.

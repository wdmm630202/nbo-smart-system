# 南铂客片链接微信分享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `https://p.nanbostudio.com/` 在微信内通过右上角发送给朋友时显示南铂摄影的固定标题、简介、封面和链接，同时保证客片站、匿名统计和密钥安全不受影响。

**Architecture:** 现有 Cloudflare Worker 增加同域微信签名端点，使用 KV 缓存稳定版 access token 与 jsapi ticket，并在服务端生成 SHA-1 签名。客片网页只在微信内置浏览器和固定域名中加载配置，调用官方 `updateAppMessageShareData` 与 `updateTimelineShareData`；失败时静默降级为当前普通链接行为。

**Tech Stack:** JavaScript ES modules、Node.js 24 test runner、Cloudflare Workers、Cloudflare KV、Wrangler 4.92、微信服务号 JS-SDK 1.6.0、GitHub Pages 静态发布。

**Spec:** `docs/superpowers/specs/2026-08-30-wechat-portfolio-sharing-design.md`

## Global Constraints

- 客户固定入口必须继续为 `https://p.nanbostudio.com/`。
- AppSecret、access token、jsapi ticket 不得进入 Git、浏览器、日志或聊天。
- 不新增微信登录、OpenID、支付、公众号菜单或客户资料字段。
- 微信 SDK 或签名失败不得阻断客片浏览、收藏客片、生成需求和匿名统计。
- 先部署并验证 Worker 签名链路，再发布网页 JS-SDK 初始化。
- 微信返回 `40164` 时停止部署，不扩大 Cloudflare 动态出口 IP 白名单，不擅自接入付费基础设施。
- 所有新行为严格执行测试先行；每个测试必须先因功能缺失产生预期失败，再写最小实现。
- 本机系统 PATH 没有 Node.js；所有 Node 命令使用 `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`，所有包脚本使用 `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm`。

---

### Task 1: 微信 URL 校验与 SHA-1 签名核心

**Files:**
- Create: `workers/portfolio-gateway/wechat-share.js`
- Create: `workers/portfolio-gateway/wechat-share.test.mjs`

**Interfaces:**
- Produces: `normalizeWechatPageUrl(rawUrl: string): string`
- Produces: `createWechatSignature(input: { ticket: string, nonceStr: string, timestamp: number, url: string }): Promise<string>`
- Produces: `WechatShareError`，包含稳定的 `code` 与 HTTP `status`

- [ ] **Step 1: 写 URL 校验失败测试**

测试声明生产代码发生“接受 HTTP、外域、用户信息、非默认端口或保留哈希”时必须失败：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWechatPageUrl } from "./wechat-share.js";

test("微信签名只接受南铂 HTTPS 页面并移除哈希", () => {
  assert.equal(
    normalizeWechatPageUrl("https://p.nanbostudio.com/?from=wechat#works"),
    "https://p.nanbostudio.com/?from=wechat",
  );
  for (const value of [
    "http://p.nanbostudio.com/",
    "https://example.com/",
    "https://name:pass@p.nanbostudio.com/",
    "https://p.nanbostudio.com:444/",
    "not-a-url",
  ]) {
    assert.throws(() => normalizeWechatPageUrl(value), /invalid_wechat_url/);
  }
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失失败**

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs
```

Expected: FAIL，错误指向 `wechat-share.js` 不存在或缺少 `normalizeWechatPageUrl`。

- [ ] **Step 3: 写最小 URL 校验实现**

```js
const PUBLIC_ORIGIN = "https://p.nanbostudio.com";

export class WechatShareError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizeWechatPageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== PUBLIC_ORIGIN || url.username || url.password) throw new Error("rejected");
    url.hash = "";
    return url.toString();
  } catch {
    throw new WechatShareError("invalid_wechat_url", 400);
  }
}
```

- [ ] **Step 4: 运行 URL 测试并确认通过**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs`

Expected: PASS。

- [ ] **Step 5: 写固定向量 SHA-1 失败测试**

测试声明生产代码发生“参数顺序、字段名、URL 或摘要编码错误”时必须失败；期望值独立用系统 `shasum` 对固定字符串手工生成后写成字面量：

```js
// 将测试文件顶部导入更新为：
import { createWechatSignature, normalizeWechatPageUrl } from "./wechat-share.js";

test("微信签名使用官方字段顺序生成小写 SHA-1", async () => {
  const signature = await createWechatSignature({
    ticket: "ticket-123",
    nonceStr: "nonce-456",
    timestamp: 1788020000,
    url: "https://p.nanbostudio.com/?from=wechat",
  });
  assert.equal(signature, "cddf18a899c39e0cace18a92b2e88a7a53ae5246");
});
```

该字面量已用以下命令独立计算；写测试时直接使用上面的固定值：

```bash
printf '%s' 'jsapi_ticket=ticket-123&noncestr=nonce-456&timestamp=1788020000&url=https://p.nanbostudio.com/?from=wechat' | shasum
```

- [ ] **Step 6: 运行测试并确认因导出函数缺失失败**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs`

Expected: FAIL，错误指向 `createWechatSignature` 不存在。

- [ ] **Step 7: 写最小 SHA-1 实现**

```js
export async function createWechatSignature({ ticket, nonceStr, timestamp, url }) {
  const source = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 8: 运行 Task 1 测试并提交**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs`

Expected: 2 tests PASS，0 FAIL。

```bash
git add workers/portfolio-gateway/wechat-share.js workers/portfolio-gateway/wechat-share.test.mjs
git commit -m "feat: add secure WeChat share signing primitives"
```

---

### Task 2: 微信凭据缓存、错误映射与签名端点

**Files:**
- Modify: `workers/portfolio-gateway/wechat-share.js`
- Modify: `workers/portfolio-gateway/wechat-share.test.mjs`
- Modify: `workers/portfolio-gateway/worker.js`
- Modify: `workers/portfolio-gateway/worker.test.mjs`

**Interfaces:**
- Consumes: `normalizeWechatPageUrl`、`createWechatSignature`、`WechatShareError`
- Produces: `getWechatAccessToken(env, fetchImpl): Promise<string>`
- Produces: `getWechatJsapiTicket(env, accessToken, fetchImpl): Promise<string>`
- Produces: `handleWechatSignature(request: Request, env: Env, deps?): Promise<Response>`

- [ ] **Step 1: 写 KV 命中与缓存缺失失败测试**

使用内存 KV 假实现记录 `get`、`put`，使用固定微信响应的 `fetchImpl`。测试声明生产代码发生“缓存命中仍请求微信、使用强制刷新、未提前 300 秒过期、ticket 请求未使用 jsapi 类型”时必须失败：

```js
// 将测试文件顶部导入更新为：
import {
  createWechatSignature,
  getWechatAccessToken,
  getWechatJsapiTicket,
  normalizeWechatPageUrl,
} from "./wechat-share.js";

function fakeEnv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const putTtls = [];
  return {
    WECHAT_APP_ID: "wx-test-appid",
    WECHAT_APP_SECRET: "test-secret",
    putTtls,
    WECHAT_CACHE: {
      async get(key, options = {}) {
        const value = store.get(key);
        if (value === undefined) return null;
        return options.type === "json" ? value : JSON.stringify(value);
      },
      async put(key, value, options = {}) {
        store.set(key, JSON.parse(value));
        putTtls.push(options.expirationTtl);
      },
    },
  };
}

function sequentialWechatFetch(payloads) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : null,
    });
    const payload = payloads.shift();
    return Response.json(payload);
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

test("有效缓存命中时不请求微信 API", async () => {
  const calls = [];
  const env = fakeEnv({
    "wechat:access-token": { value: "cached-token" },
    "wechat:jsapi-ticket": { value: "cached-ticket" },
  });
  const fetchImpl = async (...args) => { calls.push(args); throw new Error("unexpected fetch"); };
  assert.equal(await getWechatAccessToken(env, fetchImpl), "cached-token");
  assert.equal(await getWechatJsapiTicket(env, "cached-token", fetchImpl), "cached-ticket");
  assert.equal(calls.length, 0);
});

test("缓存缺失时取得稳定 token 和 jsapi ticket 并提前五分钟过期", async () => {
  const env = fakeEnv();
  const fetchImpl = sequentialWechatFetch([
    { access_token: "fresh-token", expires_in: 7200 },
    { ticket: "fresh-ticket", expires_in: 7200, errcode: 0, errmsg: "ok" },
  ]);
  assert.equal(await getWechatAccessToken(env, fetchImpl), "fresh-token");
  assert.equal(await getWechatJsapiTicket(env, "fresh-token", fetchImpl), "fresh-ticket");
  assert.deepEqual(env.putTtls, [6900, 6900]);
  assert.deepEqual(fetchImpl.requests[0].body, {
    grant_type: "client_credential",
    appid: "wx-test-appid",
    secret: "test-secret",
    force_refresh: false,
  });
  assert.match(fetchImpl.requests[1].url, /type=jsapi/);
});
```

- [ ] **Step 2: 运行测试并确认因凭据函数缺失失败**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs`

Expected: FAIL，错误指向凭据函数缺失。

- [ ] **Step 3: 写最小凭据与 KV 缓存实现**

实现固定键 `wechat:access-token`、`wechat:jsapi-ticket`，调用：

```js
await fetchImpl("https://api.weixin.qq.com/cgi-bin/stable_token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credential",
    appid: env.WECHAT_APP_ID,
    secret: env.WECHAT_APP_SECRET,
    force_refresh: false,
  }),
});
```

ticket 使用 `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=...&type=jsapi`。KV 写入 `JSON.stringify({ value })`，`expirationTtl` 使用 `Math.max(60, expires_in - 300)`。

- [ ] **Step 4: 写凭据错误映射失败测试**

```js
test("微信 IP 白名单错误只返回稳定错误码", async () => {
  const env = fakeEnv();
  const fetchImpl = sequentialWechatFetch([{ errcode: 40164, errmsg: "invalid ip" }]);
  await assert.rejects(
    () => getWechatAccessToken(env, fetchImpl),
    (error) => error.code === "wechat_ip_not_allowed" && error.status === 503 && !error.message.includes("test-secret"),
  );
});
```

- [ ] **Step 5: 运行失败测试并实现错误白名单**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs`

Expected before implementation: FAIL。

将 `40164` 映射为 `wechat_ip_not_allowed`；将 `40013`、`40125`、`41002`、`41004` 映射为 `wechat_credentials_unavailable`；其他微信错误映射为 `wechat_api_unavailable`。错误对象和日志不保留 AppSecret、token、ticket 或微信响应全文。

- [ ] **Step 6: 写路由契约失败测试**

```js
// 将测试文件顶部导入更新为：
import {
  createWechatSignature,
  getWechatAccessToken,
  getWechatJsapiTicket,
  handleWechatSignature,
  normalizeWechatPageUrl,
} from "./wechat-share.js";

test("签名端点拒绝非法方法、来源和缺失 URL", async () => {
  assert.equal((await handleWechatSignature(new Request("https://p.nanbostudio.com/api/wechat-share/signature", { method: "POST" }), fakeEnv())).status, 405);
  assert.equal((await handleWechatSignature(new Request("https://p.nanbostudio.com/api/wechat-share/signature", { headers: { Origin: "https://example.com" } }), fakeEnv())).status, 403);
  assert.equal((await handleWechatSignature(new Request("https://p.nanbostudio.com/api/wechat-share/signature"), fakeEnv())).status, 400);
});
```

另写成功测试，注入固定 `now`、`nonceStr`、ticket，断言响应只含 `appId`、`timestamp`、`nonceStr`、`signature`、`url`，并断言 `Cache-Control: no-store`。

- [ ] **Step 7: 运行失败测试并实现签名处理器**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs`

Expected before implementation: FAIL。

实现 `handleWechatSignature`，允许缺失 `Origin` 的同域导航请求；若存在 `Origin`，必须等于 `https://p.nanbostudio.com`。方法只允许 GET，响应不添加跨域开放头。

- [ ] **Step 8: 在现有 Worker 注册端点并写路由测试**

在 `worker.js` 中先于普通 GET/HEAD 代理逻辑处理：

```js
const WECHAT_SIGNATURE_PATH = "/api/wechat-share/signature";

if (publicUrl.pathname === WECHAT_SIGNATURE_PATH) {
  return handleWechatSignature(request, env);
}
```

在 `worker.test.mjs` 使用缺失 URL 的 GET 请求，断言默认 Worker 导出返回 400，而不是代理到 GitHub Pages。

- [ ] **Step 9: 运行 Worker 全套测试并提交**

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs workers/portfolio-gateway/worker.test.mjs
```

Expected: 全部 PASS，0 FAIL。

```bash
git add workers/portfolio-gateway/wechat-share.js workers/portfolio-gateway/wechat-share.test.mjs workers/portfolio-gateway/worker.js workers/portfolio-gateway/worker.test.mjs
git commit -m "feat: add cached WeChat share signature endpoint"
```

---

### Task 3: 微信网页分享客户端

**Files:**
- Create: `apps/portfolio-v2/wechat-share.js`
- Create: `tests/wechat-share-client.test.mjs`
- Modify: `apps/portfolio-v2/index.html`

**Interfaces:**
- Produces: `isWechatBrowser(userAgent: string): boolean`
- Produces: `configureWechatShare({ wxApi, fetchImpl, locationLike, userAgent }): Promise<boolean>`
- Uses: `GET /api/wechat-share/signature`，查询参数 `url` 为 `URLSearchParams` 编码后的当前页面 URL

- [ ] **Step 1: 写浏览器门控失败测试**

测试声明生产代码发生“普通浏览器请求签名、GitHub Pages 长链接请求签名”时必须失败：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { configureWechatShare } from "../apps/portfolio-v2/wechat-share.js";

function fakeWx() {
  let readyCallback = () => {};
  return {
    configValue: null,
    friendValue: null,
    timelineValue: null,
    config(value) { this.configValue = value; },
    ready(callback) { readyCallback = callback; },
    error(callback) { this.errorCallback = callback; },
    updateAppMessageShareData(value) { this.friendValue = value; },
    updateTimelineShareData(value) { this.timelineValue = value; },
    runReady() { readyCallback(); },
  };
}

function signatureResponse() {
  return Response.json({
    appId: "wx-test-appid",
    timestamp: 1788020000,
    nonceStr: "nonce-456",
    signature: "cddf18a899c39e0cace18a92b2e88a7a53ae5246",
    url: "https://p.nanbostudio.com/?from=wechat",
  });
}

test("只有 p.nanbostudio.com 的微信浏览器初始化分享", async () => {
  const requests = [];
  const base = {
    wxApi: fakeWx(),
    fetchImpl: async (url) => { requests.push(url); return signatureResponse(); },
    locationLike: { origin: "https://p.nanbostudio.com", href: "https://p.nanbostudio.com/#works" },
  };
  assert.equal(await configureWechatShare({ ...base, userAgent: "Safari" }), false);
  assert.equal(requests.length, 0);
  assert.equal(await configureWechatShare({ ...base, locationLike: { origin: "https://wdmm630202.github.io", href: "https://wdmm630202.github.io/nbo-smart-system/p/" }, userAgent: "MicroMessenger" }), false);
  assert.equal(requests.length, 0);
});
```

- [ ] **Step 2: 运行测试并确认因客户端模块缺失失败**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/wechat-share-client.test.mjs`

Expected: FAIL，错误指向客户端模块或导出函数缺失。

- [ ] **Step 3: 写微信分享数据失败测试**

```js
test("微信 ready 后设置朋友与朋友圈固定分享内容", async () => {
  const wxApi = fakeWx();
  const configured = await configureWechatShare({
    wxApi,
    fetchImpl: async () => signatureResponse(),
    locationLike: { origin: "https://p.nanbostudio.com", href: "https://p.nanbostudio.com/?from=wechat#works" },
    userAgent: "MicroMessenger/8.0",
  });
  assert.equal(configured, true);
  assert.deepEqual(wxApi.configValue.jsApiList, ["updateAppMessageShareData", "updateTimelineShareData"]);
  wxApi.runReady();
  assert.deepEqual(wxApi.friendValue, {
    title: "南铂摄影｜真实客片选风格",
    desc: "浏览真实男士客片，挑选喜欢的场景与主题，生成你的拍摄需求。",
    link: "https://p.nanbostudio.com/",
    imgUrl: "https://p.nanbostudio.com/projects/portfolio-v2/share-card.jpg",
  });
  assert.equal(wxApi.timelineValue.title, "南铂摄影｜真实客片选风格");
});
```

- [ ] **Step 4: 写最小客户端实现并运行测试**

实现固定 `SHARE_DATA`、UA 与 origin 门控、无哈希签名 URL、签名 fetch、`wx.config`、`wx.ready`、`wx.error`。模块底部只在真实浏览器环境调用一次，并用 `.catch` 静默降级。

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/wechat-share-client.test.mjs`

Expected: 全部 PASS，0 FAIL。

- [ ] **Step 5: 写 HTML 加载失败测试**

在现有 `tests/portfolio-photo-workflow.test.mjs` 的版本测试中增加：

```js
assert.match(sourceIndex, /https:\/\/res\.wx\.qq\.com\/open\/js\/jweixin-1\.6\.0\.js/);
assert.match(sourceIndex, /wechat-share\.js\?v=__NBO_BUILD_VERSION__/);
```

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern="发布版本" tests/portfolio-photo-workflow.test.mjs`

Expected: FAIL，因为 HTML 尚未加载脚本。

- [ ] **Step 6: 在页面末尾加载官方 SDK 与客户端模块**

在现有 `app.js` 之前或之后保持非阻断加载顺序：

```html
<script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
<script type="module" src="wechat-share.js?v=__NBO_BUILD_VERSION__"></script>
<script type="module" src="app.js?v=__NBO_BUILD_VERSION__"></script>
```

- [ ] **Step 7: 运行 Task 3 测试并提交**

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/wechat-share-client.test.mjs tests/portfolio-photo-workflow.test.mjs
```

Expected: 全部 PASS，0 FAIL。

```bash
git add apps/portfolio-v2/wechat-share.js apps/portfolio-v2/index.html tests/wechat-share-client.test.mjs tests/portfolio-photo-workflow.test.mjs
git commit -m "feat: configure WeChat portfolio share data"
```

---

### Task 4: 静态发布链路与回归测试

**Files:**
- Modify: `tools/portfolio-photo-lib.mjs`
- Modify: `tools/export-github-pages.mjs`
- Modify: `tests/portfolio-photo-workflow.test.mjs`
- Modify: `package.json`
- Generated: `docs/projects/portfolio-v2/wechat-share.js`
- Generated: `docs/projects/portfolio-v2/index.html`
- Generated: `docs/p/index.html`
- Generated: `docs/projects/portfolio-v2/build.json`
- Generated: `docs/p/build.json`

**Interfaces:**
- Consumes: `apps/portfolio-v2/wechat-share.js`
- Produces: 内容哈希包含微信分享客户端的 `pv2-*` 版本
- Produces: `/projects/portfolio-v2/` 与 `/p/` 发布副本引用相同版本脚本

- [ ] **Step 1: 写内容版本与发布副本失败测试**

```js
test("微信分享客户端进入内容版本并完整发布", async () => {
  const [source, published, shortHtml, longHtml] = await Promise.all([
    readFile(join(root, "apps/portfolio-v2/wechat-share.js"), "utf8"),
    readFile(join(root, "docs/projects/portfolio-v2/wechat-share.js"), "utf8"),
    readFile(join(root, "docs/p/index.html"), "utf8"),
    readFile(join(root, "docs/projects/portfolio-v2/index.html"), "utf8"),
  ]);
  assert.equal(published, source);
  for (const html of [shortHtml, longHtml]) {
    assert.match(html, /wechat-share\.js\?v=pv2-[a-f0-9]{12}/);
    assert.doesNotMatch(html, /__NBO_BUILD_VERSION__/);
  }
});
```

- [ ] **Step 2: 运行测试并确认发布副本缺失或过期**

Run: `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern="微信分享客户端" tests/portfolio-photo-workflow.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 将客户端加入版本哈希和导出替换**

在 `buildPortfolioVersion()` 的文件清单加入：

```js
join(root, "apps/portfolio-v2/wechat-share.js"),
```

`export-github-pages.mjs` 继续递归复制 V2 目录，并确保包含占位符的 `index.html` 完成版本替换；不直接手改 `docs` 发布副本。

- [ ] **Step 4: 更新统一客片测试命令**

`package.json` 的 `portfolio:test` 增加：

```text
workers/portfolio-gateway/wechat-share.test.mjs
workers/portfolio-gateway/worker.test.mjs
tests/wechat-share-client.test.mjs
```

- [ ] **Step 5: 生成发布目录并运行完整回归**

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tools/export-github-pages.mjs
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run portfolio:test
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run portfolio:validate
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run lint
```

Expected:

- Pages 导出成功并输出新的 `pv2-*` 版本。
- 所有客片、统计、Worker 和微信分享测试 PASS。
- 图库校验为 158 张照片、23 个主题、5 张首页图。
- ESLint 0 errors。

- [ ] **Step 6: 检查生成差异并提交**

```bash
git diff --check
git status --short
git add package.json tools/portfolio-photo-lib.mjs tools/export-github-pages.mjs tests/portfolio-photo-workflow.test.mjs docs/projects/portfolio-v2 docs/p
git commit -m "build: publish WeChat share client with portfolio"
```

---

### Task 5: Cloudflare KV、服务号变量与 Worker 部署检查点

**Files:**
- Modify mechanically: `workers/portfolio-gateway/wrangler.jsonc`
- Remote create: Cloudflare KV namespace `nanbo-portfolio-wechat-cache`
- Remote secret: `WECHAT_APP_SECRET`
- Remote deploy: Worker `nanbo-portfolio-gateway`

**Interfaces:**
- Produces binding: `WECHAT_CACHE`
- Produces variable: `WECHAT_APP_ID`，值必须来自“南铂摄影”服务号官方后台
- Produces secret: `WECHAT_APP_SECRET`，只由用户在交互终端输入

- [ ] **Step 1: 重新检查工作树与 Cloudflare 身份**

Run:

```bash
git status --short --branch
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/wrangler/bin/wrangler.js whoami
```

Expected: 只有本任务已知提交，无用户未提交文件；Cloudflare 账号为 `wdmm630202@outlook.com` 对应账号。

- [ ] **Step 2: 创建 KV 并让 Wrangler 自动写入 binding**

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/wrangler/bin/wrangler.js kv namespace create nanbo-portfolio-wechat-cache --binding WECHAT_CACHE --update-config --use-remote -c workers/portfolio-gateway/wrangler.jsonc
```

Expected: 新 namespace 创建成功，`wrangler.jsonc` 自动出现绑定名 `WECHAT_CACHE` 和实际 namespace id，不手写示例 id。

- [ ] **Step 3: 写入官方 AppID 配置**

从服务号官方后台读取完整 AppID。将其作为 `wrangler.jsonc` 的 `vars.WECHAT_APP_ID` 精确值写入；不使用示例值、不从截图 OCR 猜测。AppID 可以显示，AppSecret 不显示。

- [ ] **Step 4: 让用户本人输入 AppSecret**

在 Codex 底部终端启动交互命令：

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/wrangler/bin/wrangler.js secret put WECHAT_APP_SECRET -c workers/portfolio-gateway/wrangler.jsonc
```

用户本人在终端粘贴 AppSecret 并提交。助手不读取终端回显、不要求截图、不把值写入任何文件。

- [ ] **Step 5: 部署 Worker，先不发布网页提交**

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/wrangler/bin/wrangler.js deploy -c workers/portfolio-gateway/wrangler.jsonc
```

Expected: Worker 部署成功，自定义域名仍为 `p.nanbostudio.com`，D1 绑定仍存在。

- [ ] **Step 6: 请求签名端点并执行 IP 白名单闸门**

Run:

```bash
curl -sS -o /tmp/nanbo-wechat-signature-check.json -w '%{http_code}\n' --get 'https://p.nanbostudio.com/api/wechat-share/signature' --data-urlencode 'url=https://p.nanbostudio.com/'
```

只读取 HTTP 状态和 JSON 字段名，不在交付信息中复制 `signature`。预期 HTTP 200，字段仅为 `appId`、`timestamp`、`nonceStr`、`signature`、`url`。

若为 `503` 且 `error=wechat_ip_not_allowed`，停止此计划，不发布网页 JS-SDK 提交；报告微信接口 IP 白名单阻塞并等待用户选择稳定出口或微信托管令牌方案。

- [ ] **Step 7: 验证原代理与统计未回归并提交配置**

Run:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://p.nanbostudio.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://p.nanbostudio.com/projects/portfolio-v2/share-card.jpg
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test workers/portfolio-gateway/wechat-share.test.mjs workers/portfolio-gateway/worker.test.mjs
git diff --check
```

Expected: 页面 200、分享图 200、测试全 PASS。

```bash
git add workers/portfolio-gateway/wrangler.jsonc
git commit -m "ops: bind WeChat credential cache"
```

---

### Task 6: 服务号域名配置、网页发布与微信真机验收

**Files:**
- Optional create only when supplied by official platform: `apps/portfolio-v2/MP_verify_*.txt`
- Modify only when verification file is required: `tools/export-github-pages.mjs`
- Generated only when verification file is required: `docs/p/MP_verify_*.txt`
- Remote update: 微信公众平台 JS 接口安全域名
- Remote publish: GitHub `main` / Pages

**Interfaces:**
- Consumes: deployed `/api/wechat-share/signature`
- Produces: 微信公众平台绑定域名 `p.nanbostudio.com`
- Produces: 微信右上角发送给朋友的真实分享卡片

- [ ] **Step 1: 在微信官方后台配置 JS 接口安全域名**

登录微信公众平台，进入“服务号设置 → 功能设置 → JS接口安全域名”，填写：

```text
p.nanbostudio.com
```

不填写协议、路径或端口。

- [ ] **Step 2: 如官方要求校验文件，先写公开读取失败测试**

下载官方生成的唯一 `MP_verify_*.txt`，不改文件名和内容。在 Worker 路由测试中增加精确路径代理断言；在发布测试中断言导出后的 `docs/p/` 中同名文件与源文件字节一致。

Run before implementation:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run portfolio:test
```

Expected: FAIL，因为校验文件尚未导出到 `/p/`。

- [ ] **Step 3: 最小化发布官方校验文件**

将官方文件放入 `apps/portfolio-v2/`，并在 `export-github-pages.mjs` 的固定短链接目录复制阶段增加对该确切文件的 `copyFile`。不实现任意上传或通配复制。

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tools/export-github-pages.mjs
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run portfolio:test
```

Expected: PASS，并能通过 `https://p.nanbostudio.com/` 加官方文件原名的地址读取原始内容。完成平台验证后保留文件，避免后续复核失败。

- [ ] **Step 4: 推送已验证网页发布提交**

在签名端点已经 HTTP 200、JS 接口安全域名保存成功后：

```bash
git status --short --branch
git push origin main
```

Expected: push 成功，GitHub Pages 开始发布包含 `wechat-share.js` 的新版本。

- [ ] **Step 5: 延迟检查线上版本与资源**

Run:

```bash
curl -sS https://p.nanbostudio.com/ | rg 'jweixin-1\.6\.0|wechat-share\.js\?v=pv2-'
curl -sS https://p.nanbostudio.com/build.json
curl -sS -o /dev/null -w '%{http_code}\n' https://p.nanbostudio.com/projects/portfolio-v2/wechat-share.js
```

Expected: 页面含官方 SDK 和带 `pv2-*` 的客户端脚本，build.json 为新版本，客户端脚本 HTTP 200。

- [ ] **Step 6: 微信真机主要验收**

在微信中打开 `https://p.nanbostudio.com/`，等待页面加载后点右上角“发送给朋友”，发送给一个测试联系人。确认：

- 标题为“南铂摄影｜真实客片选风格”。
- 简介为“浏览真实男士客片，挑选喜欢的场景与主题，生成你的拍摄需求。”
- 封面为现有南铂客片分享图。
- 点击卡片仍打开 `https://p.nanbostudio.com/`。

- [ ] **Step 7: 微信收藏转发兼容性记录**

收藏同一网页，再从收藏中转发给测试联系人，记录当前微信客户端实际结果。若收藏转发仍为普通链接，只记录为微信客户端兼容性边界，不更改主要验收结论，也不宣称已被官方接口覆盖。

- [ ] **Step 8: 最终全量验证**

Run:

```bash
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run portfolio:test
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run portfolio:validate
/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run lint
git status --short --branch
curl -sS -o /dev/null -w '%{http_code}\n' https://p.nanbostudio.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://p.nanbostudio.com/projects/portfolio-v2/share-card.jpg
```

Expected: 全部测试和 lint 通过；图库为 158 张照片、23 个主题、5 张首页图；工作树干净并与远端同步；页面与分享图均为 HTTP 200。

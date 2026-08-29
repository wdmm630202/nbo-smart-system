import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function runAnalytics(preference = "") {
  const source = await read("apps/portfolio-v2/analytics.js");
  const storage = new Map(preference ? [["nanbo-anonymous-analytics-consent", preference]] : []);
  const sessionStorage = new Map();
  const scheduled = [];
  const appended = [];
  const requests = [];
  let id = 0;
  const context = {
    Blob,
    Date,
    PerformanceObserver: class { observe() {} },
    URL,
    URLSearchParams,
    console,
    crypto: { randomUUID: () => `session-${++id}` },
    document: {
      addEventListener() {},
      body: { append: (node) => appended.push(node) },
      createElement: () => ({ addEventListener() {}, remove() {}, setAttribute() {} }),
      documentElement: { scrollHeight: 1600 },
      querySelector: () => null,
      referrer: "",
      visibilityState: "visible",
    },
    fetch: async (url, options) => { requests.push({ url, options }); },
    innerHeight: 800,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    location: {
      hostname: "wdmm630202.github.io",
      origin: "https://wdmm630202.github.io",
      pathname: "/nbo-smart-system/p/",
      search: "",
    },
    matchMedia: () => ({ matches: false }),
    navigator: {},
    performance: { now: () => 0 },
    scrollY: 0,
    sessionStorage: {
      getItem: (key) => sessionStorage.get(key) || null,
      removeItem: (key) => sessionStorage.delete(key),
      setItem: (key, value) => sessionStorage.set(key, value),
    },
  };
  context.window = {
    addEventListener() {},
    setInterval() {},
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };

  vm.runInNewContext(source, context);
  for (const timer of scheduled) timer.callback();
  await Promise.resolve();
  return { appended, requests };
}

test("匿名统计不进入客片首屏关键路径", async () => {
  const [app, analytics, html] = await Promise.all([
    read("apps/portfolio-v2/app.js"),
    read("apps/portfolio-v2/analytics.js"),
    read("apps/portfolio-v2/index.html"),
  ]);

  assert.match(html, /<script type="module" src="app\.js/);
  assert.doesNotMatch(html, /<script[^>]+analytics\.js/);
  assert.match(app, /window\.addEventListener\("load", scheduleAnalytics/);
  assert.match(app, /requestIdleCallback/);
  assert.match(app, /import\(`\.\/analytics\.js/);
  assert.ok(gzipSync(analytics).byteLength < 4_096, "统计脚本压缩后必须小于 4 KB");
  assert.doesNotMatch(analytics, /document\.cookie|canvas|getUserMedia|geolocation|deviceMemory|hardwareConcurrency/);
});

test("新访客浏览客片时不显示匿名统计提示条", async () => {
  const { appended } = await runAnalytics();
  assert.equal(appended.length, 0);
});

test("匿名统计默认启动，但尊重客户明确停止的选择", async () => {
  const [defaultVisit, stoppedVisit] = await Promise.all([
    runAnalytics(),
    runAnalytics("no"),
  ]);

  assert.equal(defaultVisit.requests.length, 1);
  assert.equal(defaultVisit.requests[0].url, "https://p.nanbostudio.com/api/portfolio-analytics/collect");
  assert.equal(stoppedVisit.requests.length, 0);
});

test("发布目录包含统计脚本和固定短网址隐私页", async () => {
  const [publishedApp, publishedAnalytics, permanentHtml, permanentPrivacy] = await Promise.all([
    read("docs/projects/portfolio-v2/app.js"),
    read("docs/projects/portfolio-v2/analytics.js"),
    read("docs/p/index.html"),
    read("docs/p/privacy.html"),
  ]);

  assert.match(publishedApp, /\.\/analytics\.js\?v=/);
  assert.match(publishedAnalytics, /portfolio-analytics\/collect/);
  assert.match(permanentHtml, /\/nbo-smart-system\/p\/privacy\.html/);
  assert.match(permanentPrivacy, /匿名浏览统计说明/);
});

test("数据接收端限制来源、体积和保存期限，报表仅负责人可见", async () => {
  const [collector, dashboard, insightsApi, staticDashboard, staticApp, migration] = await Promise.all([
    read("app/api/portfolio-analytics/collect/route.ts"),
    read("app/i/page.tsx"),
    read("app/api/portfolio-analytics/insights/route.ts"),
    read("apps/portfolio-insights/index.html"),
    read("apps/portfolio-insights/app.js"),
    read("drizzle/0000_married_ultimatum.sql"),
  ]);

  assert.match(collector, /https:\/\/wdmm630202\.github\.io/);
  assert.match(collector, /24_000/);
  assert.match(collector, /90 \* 86_400_000/);
  assert.match(collector, /database\.batch/);
  assert.match(dashboard, /getChatGPTUser/);
  assert.match(dashboard, /PORTFOLIO_OWNER_USER_ID/);
  assert.match(insightsApi, /PORTFOLIO_INSIGHTS_TOKEN/);
  assert.match(insightsApi, /Authorization/);
  assert.match(insightsApi, /crypto\.subtle\.digest/);
  assert.match(insightsApi, /Cache-Control.*no-store/);
  assert.match(staticDashboard, /noindex,nofollow,noarchive/);
  assert.match(staticDashboard, /connect-src https:\/\/p\.nanbostudio\.com/);
  assert.match(staticApp, /location\.hash/);
  assert.match(staticApp, /Authorization: `Bearer/);
  assert.match(staticApp, /https:\/\/p\.nanbostudio\.com\/api\/portfolio-analytics\/insights/);
  assert.match(migration, /portfolio_sessions_started_idx/);
  assert.match(migration, /portfolio_interactions_type_target_idx/);
});

test("固定 GitHub 后台页完整导出且不公开访问钥匙", async () => {
  const [sourceHtml, sourceApp, publishedHtml, publishedApp] = await Promise.all([
    read("apps/portfolio-insights/index.html"),
    read("apps/portfolio-insights/app.js"),
    read("docs/i/index.html"),
    read("docs/i/app.js"),
  ]);

  assert.match(sourceHtml, /__NBO_INSIGHTS_VERSION__/);
  assert.doesNotMatch(publishedHtml, /__NBO_INSIGHTS_VERSION__/);
  assert.match(publishedApp, /portfolio-analytics\/insights/);
  assert.doesNotMatch(`${sourceHtml}\n${sourceApp}\n${publishedHtml}\n${publishedApp}`, /PORTFOLIO_INSIGHTS_TOKEN\s*=/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

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

test("匿名统计先征得同意，并提供拒绝与撤回", async () => {
  const [analytics, privacy, html] = await Promise.all([
    read("apps/portfolio-v2/analytics.js"),
    read("apps/portfolio-v2/privacy.html"),
    read("apps/portfolio-v2/index.html"),
  ]);

  assert.match(analytics, /readConsent\(\) !== "yes"/);
  assert.match(analytics, /data-consent="no"/);
  assert.match(analytics, /不收集姓名、手机号、IP 或设备指纹/);
  assert.match(privacy, /停止当前浏览器的匿名统计/);
  assert.match(privacy, /数据保存不超过 90 天/);
  assert.match(html, /匿名统计说明/);
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
  assert.match(staticApp, /location\.hash/);
  assert.match(staticApp, /Authorization: `Bearer/);
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

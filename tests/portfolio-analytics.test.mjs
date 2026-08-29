import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const exists = (path) => access(new URL(path, root)).then(() => true, () => false);
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function measureMobileFooter() {
  const [html, css, qr] = await Promise.all([
    read("apps/portfolio-v2/index.html"),
    read("apps/portfolio-v2/styles.css"),
    readFile(new URL("apps/portfolio-v2/wechat-contact-qr.png", root)),
  ]);
  const footer = html.match(/<footer class="page-footer">[\s\S]*?<\/footer>/)?.[0] || "";
  const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>body{width:390px}</style><div class="app-shell">${footer}</div><output id="metrics"></output><script>const footerRect = document.querySelector(".page-footer").getBoundingClientRect(); const cardRect = document.querySelector(".wechat-contact-card").getBoundingClientRect(); const qrRect = document.querySelector(".wechat-qr-frame img").getBoundingClientRect(); document.querySelector("#metrics").textContent = JSON.stringify({ footerWidth: footerRect.width, footerRight: footerRect.right, cardRight: cardRect.right, qrWidth: qrRect.width, qrHeight: qrRect.height });<\/script>`;
  const server = createServer((request, response) => {
    if (request.url === "/wechat-contact-qr.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(qr);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(chromePath, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--window-size=500,844",
        "--virtual-time-budget=1000",
        "--dump-dom",
        `http://127.0.0.1:${port}/`,
      ]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Chrome 退出码 ${code}: ${stderr}`)));
    });
    const encoded = output.match(/<output id="metrics">([^<]+)<\/output>/)?.[1] || "";
    return JSON.parse(encoded.replaceAll("&quot;", '"'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

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
  const [publishedApp, publishedAnalytics, permanentPrivacy] = await Promise.all([
    read("docs/projects/portfolio-v2/app.js"),
    read("docs/projects/portfolio-v2/analytics.js"),
    read("docs/p/privacy.html"),
  ]);

  assert.match(publishedApp, /\.\/analytics\.js\?v=/);
  assert.match(publishedAnalytics, /portfolio-analytics\/collect/);
  assert.match(permanentPrivacy, /匿名浏览统计说明/);
});

test("客片前台页脚区分微信内轻点和长按识别", async () => {
  const [sourceHtml, publishedHtml, permanentHtml, permanentPrivacy, sourceCss, publishedCss, sourceQr, publishedQr] = await Promise.all([
    read("apps/portfolio-v2/index.html"),
    read("docs/projects/portfolio-v2/index.html"),
    read("docs/p/index.html"),
    read("docs/p/privacy.html"),
    read("apps/portfolio-v2/styles.css"),
    read("docs/projects/portfolio-v2/styles.css"),
    readFile(new URL("apps/portfolio-v2/wechat-contact-qr.png", root)),
    readFile(new URL("docs/projects/portfolio-v2/wechat-contact-qr.png", root)),
  ]);

  const footers = [sourceHtml, publishedHtml, permanentHtml]
    .map((html) => html.match(/<footer class="page-footer">[\s\S]*?<\/footer>/)?.[0] || "");
  const normalizeVersion = (value) => value.replace(/(?:__NBO_BUILD_VERSION__|pv2-[a-f0-9]{12})/g, "VERSION");

  for (const footer of footers) {
    assert.match(footer, /NANBO STUDIO/);
    assert.match(footer, /class="wechat-contact-card"/);
    assert.match(footer, /href="https:\/\/work\.weixin\.qq\.com\/ct\/wcdeb20d42a1baad7b131c4aab095bea3a51"/);
    assert.match(footer, /微信内轻点添加/);
    assert.match(footer, /长按识别二维码/);
    assert.doesNotMatch(footer, /PRIVATE APPOINTMENT|wechat-contact-kicker/);
    assert.doesNotMatch(footer, /匿名统计/);
  }
  assert.match(footers[0], /src="wechat-contact-qr\.png\?v=__NBO_BUILD_VERSION__"/);
  assert.match(footers[1], /src="wechat-contact-qr\.png\?v=pv2-[a-f0-9]{12}"/);
  assert.match(footers[2], /src="wechat-contact-qr\.png\?v=pv2-[a-f0-9]{12}"/);
  assert.equal(normalizeVersion(footers[1]), normalizeVersion(footers[0]));
  assert.equal(normalizeVersion(footers[2]), normalizeVersion(footers[0]));
  assert.equal(publishedCss, sourceCss);
  assert.deepEqual(publishedQr, sourceQr);
  assert.match(permanentPrivacy, /匿名浏览统计说明/);
});

test("手机页脚的企业微信卡片不溢出屏幕", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.footerWidth, 390);
  assert.ok(metrics.cardRight <= metrics.footerRight + 0.5, `卡片右边 ${metrics.cardRight}px 超出页脚 ${metrics.footerRight}px`);
  assert.ok(metrics.qrWidth >= 100 && metrics.qrWidth <= 130, `二维码手机显示宽度异常：${metrics.qrWidth}px`);
});

test("企业微信二维码在手机上保持正方形", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(Math.abs(metrics.qrWidth - metrics.qrHeight) <= 0.5, `二维码被拉伸为 ${metrics.qrWidth} × ${metrics.qrHeight}px`);
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

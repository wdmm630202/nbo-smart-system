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
  const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>body{width:390px}</style><div class="app-shell">${footer}</div><output id="metrics"></output><script>
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const textRect = (selector) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector));
      return range.getBoundingClientRect();
    };
    const footerRect = rect(".page-footer");
    const footerStyle = getComputedStyle(document.querySelector(".page-footer"));
    const cardRect = rect(".wechat-contact-card");
    const cardStyle = getComputedStyle(document.querySelector(".wechat-contact-card"));
    const titleRect = rect(".wechat-contact-title, .wechat-contact-topline > strong");
    const ctaRect = rect(".wechat-contact-link");
    const brandRect = rect(".footer-brand");
    const brandCopyRect = rect(".footer-brand > span:last-child");
    const brandSealRect = rect(".footer-brand .brand-seal");
    const brandTitleRect = rect(".footer-brand strong");
    const brandTitleTextRect = textRect(".footer-brand strong");
    const brandSubtitleTextRect = textRect(".footer-brand small");
    const brandSubtitleRect = rect(".footer-brand small");
    const detailRect = rect(".wechat-contact-details");
    const qrFrameRect = rect(".wechat-qr-frame");
    const qrRect = rect(".wechat-qr-frame img");
    const signatureLeftRect = rect(".footer-signature > span");
    const signatureRightRect = rect(".footer-signature > small");
    const signatureRect = rect(".footer-signature");
    const phoneLink = document.querySelector(".phone-contact-link");
    const phoneRect = phoneLink?.getBoundingClientRect() || null;
    const phoneStyle = phoneLink ? getComputedStyle(phoneLink) : null;
    const contactStack = document.querySelector(".contact-action-stack");
    const contactStackRect = contactStack?.getBoundingClientRect() || null;
    const contactStackStyle = contactStack ? getComputedStyle(contactStack) : null;
    const wechatTextRect = rect(".wechat-contact-link > span");
    const wechatIconRect = rect(".wechat-contact-link i");
    const phoneNumberRect = rect(".phone-contact-number");
    const wechatTailRect = rect(".wechat-contact-link b");
    const phoneTailRect = rect(".phone-contact-link small");
    const ctaStyle = getComputedStyle(document.querySelector(".wechat-contact-link"));
    const rgbChannels = (color) => color.slice(color.indexOf("(") + 1, color.indexOf(")")).split(",").slice(0, 3).map((value) => Number.parseFloat(value));
    const stackRgb = contactStackStyle ? rgbChannels(contactStackStyle.backgroundColor) : [];
    const ctaRgb = rgbChannels(ctaStyle.color);
    const visualLeftRects = [titleRect, ctaRect, brandRect, detailRect, phoneRect].filter(Boolean);
    const titleLineHeight = Number.parseFloat(getComputedStyle(document.querySelector(".wechat-contact-title")).lineHeight);
    const brandSubtitleFontSize = Number.parseFloat(getComputedStyle(document.querySelector(".footer-brand small")).fontSize);
    document.querySelector("#metrics").textContent = JSON.stringify({
      footerWidth: footerRect.width,
      footerHeight: footerRect.height,
      footerRight: footerRect.right,
      cardLeft: cardRect.left,
      cardInnerLeft: cardRect.left + Number.parseFloat(cardStyle.borderLeftWidth),
      cardHeight: cardRect.height,
      cardRight: cardRect.right,
      cardInnerRight: cardRect.right - Number.parseFloat(cardStyle.borderRightWidth),
      titleLeft: titleRect.left,
      titleRight: titleRect.right,
      titleBottom: titleRect.bottom,
      titleLineCount: Math.round(titleRect.height / titleLineHeight),
      ctaLeft: ctaRect.left,
      ctaTop: ctaRect.top,
      ctaBottom: ctaRect.bottom,
      ctaHeight: ctaRect.height,
      brandLeft: brandRect.left,
      brandCopyRight: brandCopyRect.right,
      brandTextLeftAlignmentError: Math.abs(brandTitleTextRect.left - brandSubtitleTextRect.left),
      brandTextRightAlignmentError: Math.abs(brandTitleTextRect.right - brandSubtitleTextRect.right),
      brandTitleTextWidth: brandTitleTextRect.width,
      brandSubtitleTextWidth: brandSubtitleTextRect.width,
      brandSubtitleHeight: brandSubtitleRect.height,
      brandSubtitleFontSize,
      brandTitleLetterSpacing: Number.parseFloat(getComputedStyle(document.querySelector(".footer-brand strong")).letterSpacing),
      brandTop: brandRect.top,
      detailLeft: detailRect.left,
      outerLeftAlignmentError: contactStackRect ? Math.max(titleRect.left, contactStackRect.left, brandSealRect.left) - Math.min(titleRect.left, contactStackRect.left, brandSealRect.left) : null,
      internalLeftAlignmentError: Math.abs(wechatIconRect.left - detailRect.left),
      visualContentLeft: Math.min(...visualLeftRects.map((item) => item.left)),
      visualContentRight: Math.max(...visualLeftRects.map((item) => item.right)),
      qrFrameLeft: qrFrameRect.left,
      qrFrameRight: qrFrameRect.right,
      qrFrameCenter: qrFrameRect.left + (qrFrameRect.width / 2),
      qrWidth: qrRect.width,
      qrHeight: qrRect.height,
      signatureLeft: signatureLeftRect.left,
      signatureRight: signatureRightRect.right,
      signatureRightCenter: signatureRightRect.left + (signatureRightRect.width / 2),
      cardToSignatureGap: signatureRect.top - cardRect.bottom,
      signatureToNavGap: footerRect.bottom - Number.parseFloat(footerStyle.paddingBottom) - signatureRect.bottom,
      phoneHref: phoneLink?.getAttribute("href") || null,
      phoneTop: phoneRect?.top ?? null,
      phoneBottom: phoneRect?.bottom ?? null,
      phoneHeight: phoneRect?.height ?? null,
      phoneBackground: phoneStyle?.backgroundColor ?? null,
      phoneBorderTopWidth: phoneStyle?.borderTopWidth ?? null,
      contactStackPresent: Boolean(contactStack),
      contactStackTop: contactStackRect?.top ?? null,
      contactStackBottom: contactStackRect?.bottom ?? null,
      contactStackRadius: contactStackStyle ? Number.parseFloat(contactStackStyle.borderTopLeftRadius) : null,
      contactStackLinkCount: contactStack?.querySelectorAll(":scope > a").length ?? 0,
      phoneLeft: phoneRect?.left ?? null,
      phoneRight: phoneRect?.right ?? null,
      ctaRight: ctaRect.right,
      actionStackIsDark: stackRgb.length === 3 && stackRgb.every((value) => value <= 32),
      actionTextIsLight: ctaRgb.length === 3 && ctaRgb.every((value) => value >= 230),
      actionStackBackground: contactStackStyle?.backgroundColor ?? null,
      actionTextColor: ctaStyle.color,
      actionMainLeftAlignmentError: Math.max(wechatTextRect.left, phoneNumberRect.left, brandCopyRect.left) - Math.min(wechatTextRect.left, phoneNumberRect.left, brandCopyRect.left),
      actionMainRightAlignmentError: Math.max(wechatTextRect.right, phoneNumberRect.right, brandCopyRect.right) - Math.min(wechatTextRect.right, phoneNumberRect.right, brandCopyRect.right),
      actionMainTextAlignments: [
        getComputedStyle(document.querySelector(".wechat-contact-link > span")).textAlign,
        getComputedStyle(document.querySelector(".phone-contact-number")).textAlign,
        getComputedStyle(document.querySelector(".footer-brand > span:last-child")).textAlign,
      ],
      actionMainLastAlignments: [
        getComputedStyle(document.querySelector(".wechat-contact-link > span")).textAlignLast,
        getComputedStyle(document.querySelector(".phone-contact-number")).textAlignLast,
        getComputedStyle(document.querySelector(".footer-brand > span:last-child")).textAlignLast,
      ],
      brandLineTextAlignments: [
        getComputedStyle(document.querySelector(".footer-brand strong")).textAlign,
        getComputedStyle(document.querySelector(".footer-brand small")).textAlign,
      ],
      brandLineLastAlignments: [
        getComputedStyle(document.querySelector(".footer-brand strong")).textAlignLast,
        getComputedStyle(document.querySelector(".footer-brand small")).textAlignLast,
      ],
      actionTailAlignmentError: Math.abs(wechatTailRect.right - phoneTailRect.right),
      outerRightAlignmentError: contactStackRect ? Math.abs(titleRect.right - contactStackRect.right) : null,
      titleToActionGap: contactStackRect ? contactStackRect.top - titleRect.bottom : null,
      actionToBrandGap: contactStackRect ? brandRect.top - contactStackRect.bottom : null,
      wechatActionHref: document.querySelector(".wechat-contact-link")?.getAttribute("href") || null,
      wechatQrHref: document.querySelector(".wechat-contact-right")?.getAttribute("href") || null,
      wechatLogoPresent: Boolean(document.querySelector(".wechat-contact-link svg.wechat-logo")),
      wechatActionLabel: document.querySelector(".wechat-contact-link > span")?.textContent.trim() || "",
      nestedAnchorCount: document.querySelectorAll("a a").length,
    });
  <\/script>`;
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

async function measureMobileCampaign({ theme = "", slideIndex = 0 } = {}) {
  const sourceHtml = await read("apps/portfolio-v2/index.html");
  const probe = `<output id="homepage-metrics"></output><script>
    window.addEventListener("load", () => window.setTimeout(() => {
      const track = document.querySelector(".campaign-track");
      const slides = [...document.querySelectorAll(".campaign-slide")];
      const progress = [...document.querySelectorAll(".campaign-progress button")];
      if (track && ${slideIndex} > 0) {
        track.style.scrollBehavior = "auto";
        track.scrollLeft = track.clientWidth * ${slideIndex};
        track.dispatchEvent(new Event("scroll"));
      }
      window.setTimeout(() => {
        const trackStyle = track ? getComputedStyle(track) : null;
        const firstTitle = document.querySelector(".campaign-slide-title");
        const bodyFont = getComputedStyle(document.body).fontFamily;
        const titleFont = firstTitle ? getComputedStyle(firstTitle).fontFamily : "";
        document.querySelector("#homepage-metrics").textContent = JSON.stringify({
          slideCount: slides.length,
          progressCount: progress.length,
          uniqueThemes: new Set(slides.map((slide) => slide.dataset.theme)).size,
          linkTargets: slides.map((slide) => slide.querySelector("a")?.getAttribute("href") || ""),
          scrollSnapType: trackStyle?.scrollSnapType || "",
          overflowX: trackStyle?.overflowX || "",
          scrollLeft: track?.scrollLeft || 0,
          scrollWidth: track?.scrollWidth || 0,
          trackWidth: track?.clientWidth || 0,
          slidesFitTrack: track ? slides.every((slide) => Math.abs(slide.getBoundingClientRect().width - track.clientWidth) <= 1) : false,
          activeProgressIndex: progress.findIndex((item) => item.getAttribute("aria-current") === "true"),
          activeTheme: document.querySelector('.theme-filter-button[aria-pressed="true"]')?.dataset.theme || "",
          gallerySummary: document.querySelector("#gallery-summary")?.textContent || "",
          locationHash: location.hash,
          artisticTitleFont: Boolean(titleFont && titleFont !== bodyFont),
          titleOverflowCount: slides.filter((slide) => {
            const title = slide.querySelector(".campaign-slide-title");
            if (!title) return false;
            const titleRect = title.getBoundingClientRect();
            const slideRect = slide.getBoundingClientRect();
            return titleRect.left < slideRect.left + 8 || titleRect.right > slideRect.right - 8;
          }).length,
        });
      }, 420);
    }, 250));
  <\/script>`;
  const page = sourceHtml
    .replace(/<script src="https:\/\/res\.wx\.qq\.com[^>]+><\/script>/, "")
    .replace(/<script type="module" src="wechat-share\.js[^>]+><\/script>/, "")
    .replace("</body>", `${probe}</body>`);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    try {
      if (pathname === "/portfolio-v2/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page);
        return;
      }
      const asset = await readFile(new URL(`apps${pathname}`, root));
      const contentType = pathname.endsWith(".css") ? "text/css; charset=utf-8"
        : pathname.endsWith(".js") ? "text/javascript; charset=utf-8"
          : pathname.endsWith(".webp") ? "image/webp"
            : pathname.endsWith(".jpg") || pathname.endsWith(".jpeg") ? "image/jpeg"
              : pathname.endsWith(".png") ? "image/png"
                : "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType });
      response.end(asset);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
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
        "--window-size=390,844",
        "--virtual-time-budget=2500",
        "--dump-dom",
        `http://127.0.0.1:${port}/portfolio-v2/index.html?v=test${theme ? `&theme=${encodeURIComponent(theme)}` : ""}${theme ? "#works" : ""}`,
      ]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Chrome 退出码 ${code}: ${stderr}`)));
    });
    const encoded = output.match(/<output id="homepage-metrics">([^<]+)<\/output>/)?.[1] || "";
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

test("本地草稿页脚区分企业微信点击添加和长按识别", async () => {
  const sourceHtml = await read("apps/portfolio-v2/index.html");
  const footer = sourceHtml.match(/<footer class="page-footer">[\s\S]*?<\/footer>/)?.[0] || "";

  assert.match(footer, /NANBO STUDIO/);
  assert.match(footer, /class="wechat-contact-card"/);
  assert.match(footer, /href="https:\/\/work\.weixin\.qq\.com\/ca\/cawcdefa3262730343"/);
  assert.match(footer, /微信内点击添加/);
  assert.match(footer, /长按识别二维码/);
  assert.match(footer, /src="wechat-contact-qr\.png\?v=__NBO_BUILD_VERSION__"/);
  assert.doesNotMatch(footer, /PRIVATE APPOINTMENT|wechat-contact-kicker|匿名统计/);
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

test("手机页脚收紧为不超过 300px 的紧凑框架", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.footerHeight <= 300, `页脚仍然过高：${metrics.footerHeight}px`);
  assert.ok(metrics.cardHeight <= 195, `企微卡片仍然过高：${metrics.cardHeight}px`);
});

test("手机企微卡片遵循统一双列栅格", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.ctaTop >= metrics.titleBottom + 5, `引导按钮没有位于标题下方：${metrics.ctaTop}px < ${metrics.titleBottom + 5}px`);
  assert.ok(Math.abs(metrics.ctaLeft - metrics.titleLeft) <= 1, `标题与引导未左对齐：${metrics.titleLeft}px / ${metrics.ctaLeft}px`);
  assert.ok(metrics.outerLeftAlignmentError <= 0.5, `品牌圆章未移到标题与按钮的外侧左辅助线：${metrics.outerLeftAlignmentError}px`);
  assert.ok(metrics.internalLeftAlignmentError <= 0.5, `内容小字未对齐按钮内侧辅助线：${metrics.internalLeftAlignmentError}px`);
  assert.ok(Math.abs(metrics.signatureLeft - metrics.detailLeft) <= 0.5, `底部左署名未右移对齐上方小字竖线：${metrics.detailLeft}px / ${metrics.signatureLeft}px`);
  assert.ok(Math.abs(metrics.signatureRightCenter - metrics.qrFrameCenter) <= 1, `版权未在二维码下方居中：${metrics.qrFrameCenter}px / ${metrics.signatureRightCenter}px`);
  assert.ok(metrics.qrWidth >= 116 && metrics.qrWidth <= 130, `放大后的二维码宽度异常：${metrics.qrWidth}px`);
});

test("手机企微卡片的左中右视觉留白等宽", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  const spaces = [
    metrics.visualContentLeft - metrics.cardInnerLeft,
    metrics.qrFrameLeft - metrics.visualContentRight,
    metrics.cardInnerRight - metrics.qrFrameRight,
  ];
  const spread = Math.max(...spaces) - Math.min(...spaces);
  assert.ok(spread <= 1, `左中右留白不等：${spaces.map((value) => `${value.toFixed(2)}px`).join(" / ")}`);
});

test("手机企微标题始终只占一行", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.titleLineCount, 1, `标题实际占了 ${metrics.titleLineCount} 行`);
});

test("电话入口使用独立的直接拨号链接", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.phoneHref, "tel:17306657880");
  assert.equal(metrics.nestedAnchorCount, 0, "页脚出现了链接嵌套，手机点击行为会冲突");
});

test("拆分卡片后企微按钮和二维码仍保持独立直达", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  const wechatHref = "https://work.weixin.qq.com/ca/cawcdefa3262730343";
  assert.equal(metrics.wechatActionHref, wechatHref);
  assert.equal(metrics.wechatQrHref, wechatHref);
});

test("电话入口位于企微按钮和南铂品牌之间", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.phoneTop >= metrics.ctaBottom - 1, `电话入口没有放在企微按钮下方：${metrics.phoneTop}px`);
  assert.ok(metrics.phoneBottom <= metrics.brandTop - 5, `电话入口与南铂品牌发生拥挤：${metrics.phoneBottom}px / ${metrics.brandTop}px`);
});

test("电话入口以无边框次级行呈现，不与微信主按钮争抢层级", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.phoneBorderTopWidth, "0px");
  assert.equal(metrics.phoneBackground, "rgba(0, 0, 0, 0)");
  assert.ok(metrics.phoneHeight < metrics.ctaHeight, `电话入口 ${metrics.phoneHeight}px 不应高于微信主按钮 ${metrics.ctaHeight}px`);
});

test("微信与电话组成一个双层联系按钮组", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.contactStackPresent, true, "微信与电话没有共用按钮容器");
  assert.equal(metrics.contactStackLinkCount, 2, "按钮组必须保留两个独立点击区域");
  assert.ok(metrics.contactStackTop <= metrics.ctaTop + 0.5 && metrics.contactStackBottom >= metrics.phoneBottom - 0.5, "按钮组没有完整包住两个操作");
  assert.ok(Math.abs(metrics.ctaLeft - metrics.phoneLeft) <= 0.5 && Math.abs(metrics.ctaRight - metrics.phoneRight) <= 0.5, "上下两个操作没有等宽对齐");
  assert.ok(metrics.phoneTop <= metrics.ctaBottom + 1, "两个操作之间仍有分散的空隙");
  assert.ok(metrics.contactStackRadius >= 12, `按钮组圆角不足：${metrics.contactStackRadius}px`);
});

test("微信与电话按钮使用黑底白字", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.actionStackIsDark, true, `联系按钮底色不够深：${metrics.actionStackBackground}`);
  assert.equal(metrics.actionTextIsLight, true, `联系按钮主文字不是浅色：${metrics.actionTextColor}`);
});

test("微信入口使用微信 Logo 和点击文案", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.equal(metrics.wechatLogoPresent, true, "微信入口仍显示文字图标，没有使用微信 Logo");
  assert.equal(metrics.wechatActionLabel, "微信内点击添加");
});

test("首页新品轮播可原生横向滑动并同步进度", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileCampaign({ slideIndex: 1 });
  assert.equal(metrics.slideCount, 4, "首屏应展示 4 个不重复新品主题");
  assert.equal(metrics.uniqueThemes, 4, "新品轮播不应重复跳转到同一主题");
  assert.equal(metrics.progressCount, 4, "每个新品都应有对应进度段");
  assert.match(metrics.scrollSnapType, /^x/);
  assert.ok(["auto", "scroll"].includes(metrics.overflowX), `首屏无法横向滑动：${metrics.overflowX}`);
  assert.equal(metrics.slidesFitTrack, true, "每次滑动应精确对齐一张新品");
  assert.equal(metrics.activeProgressIndex, 1, `滑到第 2 张后进度没有同步：${JSON.stringify(metrics)}`);
  assert.equal(metrics.artisticTitleFont, true, "新品主标题仍在使用普通功能字体");
  assert.equal(metrics.titleOverflowCount, 0, "艺术主标题在手机宽度下被截断");
});

test("新品链接可直达并恢复对应主题详情", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileCampaign({ theme: "city-street" });
  assert.ok(metrics.linkTargets.includes("?theme=city-street#works"), "都市街拍新品没有详情链接");
  assert.equal(metrics.activeTheme, "city-street");
  assert.match(metrics.gallerySummary, /都市街拍/);
  assert.equal(metrics.locationHash, "#works");
});

test("页脚署名在卡片和底部导航之间垂直居中", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.cardToSignatureGap >= 5, `卡片到署名的间距过小：${metrics.cardToSignatureGap}px`);
  assert.ok(metrics.signatureToNavGap >= 5, `署名到导航的间距过小：${metrics.signatureToNavGap}px`);
  assert.ok(Math.abs(metrics.cardToSignatureGap - metrics.signatureToNavGap) <= 1, `署名没有垂直居中：${metrics.cardToSignatureGap}px / ${metrics.signatureToNavGap}px`);
});

test("微信电话主文字与尾部操作分别对齐", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.actionMainLeftAlignmentError <= 0.5, `微信、电话和品牌主文字的左边线错位 ${metrics.actionMainLeftAlignmentError}px`);
  assert.ok(metrics.actionMainRightAlignmentError <= 0.5, `微信、电话和品牌主文字的右边线错位 ${metrics.actionMainRightAlignmentError}px`);
  assert.deepEqual(metrics.actionMainTextAlignments, ["justify", "justify", "right"], "微信电话应两端对齐，品牌文字应右对齐");
  assert.deepEqual(metrics.actionMainLastAlignments, ["justify", "justify", "right"], "单行文字的末行对齐方式不正确");
  assert.deepEqual(metrics.brandLineTextAlignments, ["justify", "right"], "中文品牌名应向左拉开，英文仍保持右对齐");
  assert.deepEqual(metrics.brandLineLastAlignments, ["justify", "right"], "中文品牌名单行应两端对齐，英文末行仍保持右对齐");
  assert.ok(metrics.actionTailAlignmentError <= 0.5, `微信箭头与拨打错位 ${metrics.actionTailAlignmentError}px`);
  assert.ok(metrics.outerRightAlignmentError <= 0.5, `标题与联系按钮组的右边界错位 ${metrics.outerRightAlignmentError}px`);
});

test("标题按钮品牌使用等距垂直节奏", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(Math.abs(metrics.titleToActionGap - metrics.actionToBrandGap) <= 1, `上下间距不等：${metrics.titleToActionGap}px / ${metrics.actionToBrandGap}px`);
});

test("南铂品牌英文署名保持单行", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.brandSubtitleHeight <= metrics.brandSubtitleFontSize * 1.5, `NANBO PORTRAIT 高度 ${metrics.brandSubtitleHeight}px 已经换行`);
  assert.ok(Math.abs(metrics.brandTitleLetterSpacing) <= 0.1, `南铂摄影应依靠两端对齐均匀拉开，不应叠加固定字距：${metrics.brandTitleLetterSpacing}px`);
});

test("南铂摄影四字收紧并与英文 N 左右对齐", { skip: !(await exists(new URL(chromePath, "file://"))) }, async () => {
  const metrics = await measureMobileFooter();
  assert.ok(metrics.brandTextLeftAlignmentError <= 0.5, `南铂摄影左端与英文 N 相差 ${metrics.brandTextLeftAlignmentError}px`);
  assert.ok(metrics.brandTextRightAlignmentError <= 0.5, `南铂摄影右端与英文署名相差 ${metrics.brandTextRightAlignmentError}px`);
  assert.ok(Math.abs(metrics.brandTitleTextWidth - metrics.brandSubtitleTextWidth) <= 0.5, `中英文宽度不一致：${metrics.brandTitleTextWidth}px / ${metrics.brandSubtitleTextWidth}px`);
});

test("页脚署名固定为南铂成立年份 2021", async () => {
  const [html, app] = await Promise.all([
    read("apps/portfolio-v2/index.html"),
    read("apps/portfolio-v2/app.js"),
  ]);
  const footer = html.match(/<footer class="page-footer">[\s\S]*?<\/footer>/)?.[0] || "";
  assert.match(footer, /© 2021 NANBO STUDIO/);
  assert.doesNotMatch(footer, /id="year"/);
  assert.doesNotMatch(app, /querySelector\("#year"\)/);
});

test("拍前准备与喜欢恢复原来的符号图标", async () => {
  const html = await read("apps/portfolio-v2/index.html");
  const nav = html.match(/<nav class="tab-bar"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.doesNotMatch(nav, /<svg class="tab-icon"/);
  assert.match(nav, /data-tab="prep"><span>✓<\/span>/);
  assert.match(nav, /id="favorite-tab"[\s\S]*?<span>♡<b id="nav-favorite-count"/);
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

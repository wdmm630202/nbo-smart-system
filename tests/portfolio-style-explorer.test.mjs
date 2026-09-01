import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import { fixtureStyleCatalog } from "./helpers/portfolio-style-fixtures.mjs";

const explorerModelUrl = new URL("../apps/portfolio-v2/style-explorer-model.js", import.meta.url).href;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = await access(chromePath).then(() => true, () => false);
const browserMeasurements = new Map();

function contentType(pathname) {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function runChrome(url, width, extraFlags = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      `--window-size=${width},1000`,
      "--virtual-time-budget=1400",
      ...extraFlags,
      "--dump-dom",
      url,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Chrome 退出码 ${code}: ${stderr}`));
    });
  });
}

async function measureCustomerStyleExplorer(width, { reducedMotion = false } = {}) {
  const cacheKey = `${width}:${reducedMotion}`;
  if (browserMeasurements.has(cacheKey)) return browserMeasurements.get(cacheKey);

  const measurement = (async () => {
    const sourceHtml = await readFile(new URL("../apps/portfolio-v2/index.html", import.meta.url), "utf8");
    const probe = `<output id="style-explorer-metrics"></output><script>
      window.addEventListener("load", () => window.setTimeout(() => {
        const root = document.querySelector("#style-explorer");
        const grid = document.querySelector("#style-card-grid");
        const cards = [...(grid?.querySelectorAll(".portrait-style-card") || [])];
        const images = [...(grid?.querySelectorAll(".portrait-style-card-image img") || [])];
        const featured = [...(document.querySelectorAll("#style-featured [data-style-id]") || [])];
        const sceneTabs = [...(document.querySelectorAll("#style-scene-tabs [role=tab]") || [])];
        const familyTabs = [...(document.querySelectorAll("#style-family-tabs [role=tab]") || [])];
        const firstCard = cards[0];
        const firstImageWrap = firstCard?.querySelector(".portrait-style-card-image");
        const firstImage = images[0];
        const firstOpen = firstCard?.querySelector(".portrait-style-card-open");
        const firstLike = firstCard?.querySelector(".portrait-style-like");
        const firstLabel = firstCard?.querySelector(".portrait-style-copy strong")?.textContent || "";
        const rootRect = root?.getBoundingClientRect();
        const gridRect = grid?.getBoundingClientRect();
        const cardRect = firstCard?.getBoundingClientRect();
        const imageRect = firstImageWrap?.getBoundingClientRect();
        const initialImageCount = images.filter((image) => image.getAttribute("src")).length;
        const initialOpenHeight = firstOpen?.getBoundingClientRect().height || 0;
        const initialLikeRect = firstLike?.getBoundingClientRect();
        const openStyle = firstOpen ? getComputedStyle(firstOpen) : null;
        const gridStyle = grid ? getComputedStyle(grid) : null;
        const initialTransitionDurations = (openStyle?.transitionDuration || "")
          .split(",").filter(Boolean).map((value) => Number.parseFloat(value) * (value.includes("ms") ? .001 : 1));
        firstOpen?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 71, pointerType: "touch" }));
        const pressing = Boolean(firstOpen?.classList.contains("is-pressing"));
        const pressedTransform = firstOpen ? getComputedStyle(firstOpen).transform : "";
        firstOpen?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 71, pointerType: "touch" }));

        firstImage?.dispatchEvent(new Event("error"));
        const fallbackText = firstCard?.querySelector(".portrait-style-card-fallback")?.textContent.replace(/\\s+/g, " ").trim() || "";
        const fallbackSource = firstImage?.getAttribute("src");
        const oldImages = [...images];
        familyTabs[1]?.click();
        const nextCards = [...(grid?.querySelectorAll(".portrait-style-card") || [])];
        const nextImages = [...(grid?.querySelectorAll(".portrait-style-card-image img") || [])];
        const oldSourcesCleared = oldImages.every((image) => !image.getAttribute("src"));
        const openedStyleId = nextCards[0]?.dataset.styleId || "";
        nextCards[0]?.querySelector(".portrait-style-card-open")?.click();
        const legacyDisclosure = document.querySelector("#legacy-gallery-disclosure");
        document.querySelector("#style-explorer-metrics").textContent = JSON.stringify({
          rootPresent: Boolean(root),
          rootVisible: Boolean(root && !root.hidden && getComputedStyle(root).display !== "none"),
          rootLabelled: root?.getAttribute("aria-labelledby") === "style-explorer-title",
          sceneTabCount: sceneTabs.length,
          familyTabCount: familyTabs.length,
          activeSceneTabs: sceneTabs.filter((item) => item.getAttribute("aria-selected") === "true").length,
          activeFamilyTabs: familyTabs.filter((item) => item.getAttribute("aria-selected") === "true").length,
          featuredIds: featured.map((item) => item.dataset.styleId),
          featuredLabel: document.querySelector("#style-featured")?.getAttribute("aria-label") || "",
          featuredText: document.querySelector("#style-featured")?.textContent.replace(/\\s+/g, " ").trim() || "",
          explorerText: root?.textContent.replace(/\\s+/g, " ").trim() || "",
          cardCount: cards.length,
          imageCount: initialImageCount,
          nextCardCount: nextCards.length,
          nextImageCount: nextImages.filter((image) => image.getAttribute("src")).length,
          oldSourcesCleared,
          openedStyleId,
          openedStyleParam: new URL(location.href).searchParams.get("style") || "",
          openedView: root?.dataset.view || "",
          gridColumns: gridStyle?.gridTemplateColumns.split(" ").filter(Boolean).length || 0,
          cardRatio: cardRect ? cardRect.width / cardRect.height : 0,
          imageRatio: imageRect ? imageRect.width / imageRect.height : 0,
          openHeight: initialOpenHeight,
          likeWidth: initialLikeRect?.width || 0,
          likeHeight: initialLikeRect?.height || 0,
          pressing,
          pressedTransform,
          transitionDurations: initialTransitionDurations,
          firstLabel,
          fallbackText,
          fallbackSource,
          legacyDisclosurePresent: Boolean(legacyDisclosure),
          legacyGalleryInsideDisclosure: Boolean(legacyDisclosure?.contains(document.querySelector("#gallery-grid"))),
          legacyThemeTargetPreserved: Boolean(document.querySelector('[data-theme-link="business-boss"]')),
          albumHookPresent: Boolean(document.querySelector("#style-album")),
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          gridLeftInset: rootRect && gridRect ? gridRect.left - rootRect.left : null,
          gridRightInset: rootRect && gridRect ? rootRect.right - gridRect.right : null,
          cardClipOverflow: gridRect ? Math.max(0, ...cards.map((card) => card.getBoundingClientRect().right - gridRect.right)) : null,
        });
      }, 180));
    </script>`;
    const page = sourceHtml
      .replace(/<script src="https:\/\/res\.wx\.qq\.com[^>]+><\/script>/, "")
      .replace(/<script type="module" src="wechat-share\.js[^>]+><\/script>/, "")
      .replace("</body>", `${probe}</body>`);

    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname === "/portfolio-v2/index.html") {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(page);
          return;
        }
        const asset = await readFile(new URL(`../apps${url.pathname}`, import.meta.url));
        response.writeHead(200, { "Content-Type": contentType(url.pathname) });
        response.end(asset);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      const output = await runChrome(
        `http://127.0.0.1:${port}/portfolio-v2/index.html?v=test`,
        width,
        reducedMotion ? ["--force-prefers-reduced-motion"] : [],
      );
      const encoded = output.match(/<output id="style-explorer-metrics">([^<]+)<\/output>/)?.[1] || "";
      return JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  })();

  browserMeasurements.set(cacheKey, measurement);
  return measurement;
}

async function loadExplorerModel(loadModule = () => import(explorerModelUrl)) {
  try {
    return await loadModule();
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || error.url !== explorerModelUrl) throw error;
    // Keep the first RED run a contract assertion, not an uncaught module-load error.
    return {
      createExplorerState: () => ({}),
      reduceExplorer: () => ({}),
      serializeExplorerLocation: () => new URLSearchParams(),
    };
  }
}

const explorer = await loadExplorerModel();

function libraryFixture() {
  return fixtureStyleCatalog();
}

test("explorer bootstrap classifies only its own missing model as a fallback", async (t) => {
  const cases = [
    {
      name: "uses fallback for its own missing model",
      error: Object.assign(new Error("missing explorer model"), {
        code: "ERR_MODULE_NOT_FOUND",
        url: explorerModelUrl,
      }),
      fallback: true,
    },
    {
      name: "rethrows a missing dependency with the same error object",
      error: Object.assign(new Error("missing dependency"), {
        code: "ERR_MODULE_NOT_FOUND",
        url: new URL("./missing-style-explorer-dependency.js", import.meta.url).href,
      }),
    },
    { name: "rethrows a syntax error with the same error object", error: new SyntaxError("invalid module syntax") },
    { name: "rethrows a top-level runtime error with the same error object", error: new Error("module initialization failed") },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      if (entry.fallback) {
        const fallback = await loadExplorerModel(async () => { throw entry.error; });
        assert.deepEqual(fallback.createExplorerState(), {});
        assert.deepEqual(fallback.reduceExplorer(), {});
        assert.equal(fallback.serializeExplorerLocation().toString(), "");
        return;
      }
      await assert.rejects(
        () => loadExplorerModel(async () => { throw entry.error; }),
        (error) => error === entry.error,
      );
    });
  }
});

test("explorer narrows 132 styles to one eleven-style family and restores return state", () => {
  const library = libraryFixture();
  const state = explorer.createExplorerState(library, {});
  const outdoor = explorer.reduceExplorer(state, { type: "scene", scene: "outdoor" }, library);
  const family = explorer.reduceExplorer(outdoor, { type: "family", familyId: "OUT-02" }, library);
  const album = explorer.reduceExplorer(family, { type: "open-style", styleId: "ST-OUT-02-03", scrollY: 812 }, library);
  const viewer = explorer.reduceExplorer(album, { type: "open-pose", poseIndex: 4 }, library);
  const back = explorer.reduceExplorer(viewer, { type: "back" }, library);

  assert.deepEqual([family.scene, family.familyId, family.view], ["outdoor", "OUT-02", "styles"]);
  assert.deepEqual([album.view, album.returnScrollY], ["album", 812]);
  assert.deepEqual([viewer.view, viewer.poseIndex], ["viewer", 4]);
  assert.equal(back.view, "album");
});

test("explorer restores a coherent style URL and rejects invalid URL values to the indoor default", () => {
  const library = libraryFixture();
  const restored = explorer.createExplorerState(library, new URLSearchParams(
    "scene=outdoor&family=OUT-02&style=ST-OUT-02-03&pose=8",
  ));
  const fallback = explorer.createExplorerState(library, {
    scene: "outdoor",
    family: "OUT-02",
    style: "ST-IN-01-01",
  });

  assert.deepEqual(restored, {
    scene: "outdoor",
    familyId: "OUT-02",
    styleId: "ST-OUT-02-03",
    poseIndex: 0,
    view: "album",
    returnScrollY: 0,
  });
  assert.deepEqual(fallback, {
    scene: "indoor",
    familyId: "IN-01",
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  });
});

test("explorer derives missing URL parents from a valid scene, family, or style", () => {
  const library = libraryFixture();

  assert.deepEqual(explorer.createExplorerState(library, { scene: "outdoor" }), {
    scene: "outdoor",
    familyId: "OUT-01",
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  });
  assert.deepEqual(explorer.createExplorerState(library, { family: "OUT-02" }), {
    scene: "outdoor",
    familyId: "OUT-02",
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  });
  assert.deepEqual(explorer.createExplorerState(library, { style: "ST-OUT-02-03" }), {
    scene: "outdoor",
    familyId: "OUT-02",
    styleId: "ST-OUT-02-03",
    poseIndex: 0,
    view: "album",
    returnScrollY: 0,
  });
});

test("explorer serializes only stable URL fields and keeps pose index session-local", () => {
  const library = libraryFixture();
  const album = explorer.reduceExplorer(
    explorer.createExplorerState(library, {}),
    { type: "open-style", styleId: "ST-IN-01-05", scrollY: 420 },
    library,
  );
  const viewer = explorer.reduceExplorer(album, { type: "open-pose", poseIndex: 7 }, library);
  const location = explorer.serializeExplorerLocation(viewer);

  assert.ok(location instanceof URLSearchParams);
  assert.deepEqual(Object.fromEntries(location), {
    scene: "indoor",
    family: "IN-01",
    style: "ST-IN-01-05",
  });
});

test("explorer bounds pose movement and backs through viewer, album, then styles", () => {
  const library = libraryFixture();
  const state = explorer.reduceExplorer(
    explorer.createExplorerState(library, {}),
    { type: "open-style", styleId: "ST-IN-01-01", scrollY: 260 },
    library,
  );
  const viewer = explorer.reduceExplorer(state, { type: "open-pose", poseIndex: 0 }, library);
  const lastPose = explorer.reduceExplorer(viewer, { type: "move-pose", direction: 20 }, library);
  const firstPose = explorer.reduceExplorer(lastPose, { type: "move-pose", direction: -20 }, library);
  const album = explorer.reduceExplorer(firstPose, { type: "back" }, library);
  const styles = explorer.reduceExplorer(album, { type: "back" }, library);

  assert.deepEqual([lastPose.view, lastPose.poseIndex], ["viewer", 8]);
  assert.deepEqual([firstPose.view, firstPose.poseIndex], ["viewer", 0]);
  assert.deepEqual([album.view, album.poseIndex, album.returnScrollY], ["album", 0, 260]);
  assert.deepEqual([styles.view, styles.styleId, styles.poseIndex, styles.returnScrollY], ["styles", "", 0, 260]);
});

test("customer page renders the progressive explorer with only manual Nanbo picks and one active family", { skip: !hasChrome }, async () => {
  const metrics = await measureCustomerStyleExplorer(390);
  const catalog = JSON.parse(await readFile(new URL("../apps/portfolio-v2/style-catalog.json", import.meta.url), "utf8"));

  assert.equal(metrics.rootPresent, true, "页面没有风格浏览器容器");
  assert.equal(metrics.rootVisible, true, "完整风格资料就绪后浏览器仍被隐藏");
  assert.equal(metrics.rootLabelled, true, "风格浏览器没有可读标题关联");
  assert.equal(metrics.sceneTabCount, 2);
  assert.equal(metrics.familyTabCount, 6);
  assert.equal(metrics.activeSceneTabs, 1);
  assert.equal(metrics.activeFamilyTabs, 1);
  assert.deepEqual(metrics.featuredIds, catalog.featuredStyleIds, "南铂精选没有严格遵循 8 个手工指定 ID 及顺序");
  assert.equal(metrics.featuredLabel, "南铂精选");
  assert.doesNotMatch(metrics.featuredText, /热门|大家常选/);
  assert.equal(metrics.cardCount, 11, "首次只应渲染当前大类 11 张卡");
  assert.equal(metrics.imageCount, 11, "首次只应请求当前大类 11 张封面");
  assert.equal(metrics.albumHookPresent, true, "后续 9 张相册没有稳定挂载点");
});

test("compact style cards keep computed 2:3 card and 3:4 image geometry across phone and desktop", { skip: !hasChrome }, async () => {
  const [phone, desktop] = await Promise.all([
    measureCustomerStyleExplorer(390),
    measureCustomerStyleExplorer(1100),
  ]);

  for (const [label, metrics] of [["手机", phone], ["桌面", desktop]]) {
    assert.ok(Math.abs(metrics.cardRatio - (2 / 3)) <= .012, `${label}卡片比例错误：${metrics.cardRatio}`);
    assert.ok(Math.abs(metrics.imageRatio - (3 / 4)) <= .012, `${label}图片比例错误：${metrics.imageRatio}`);
    assert.ok(metrics.horizontalOverflow <= 0, `${label}端出现 ${metrics.horizontalOverflow}px 横向溢出`);
    assert.ok(metrics.gridLeftInset >= 0 && metrics.gridRightInset >= 0, `${label}风格网格越出内容边界：${metrics.gridLeftInset}px / ${metrics.gridRightInset}px`);
    assert.ok(metrics.cardClipOverflow <= .5, `${label}卡片被网格裁切 ${metrics.cardClipOverflow}px`);
  }
  assert.equal(phone.gridColumns, 2, "390px 应为两列");
  assert.equal(desktop.gridColumns, 3, "桌面应为三列");
});

test("style controls respond on press, clear stale images on family change, and expose readable image fallback", { skip: !hasChrome }, async () => {
  const metrics = await measureCustomerStyleExplorer(390);

  assert.ok(metrics.openHeight >= 44, `整卡按钮触控高度不足：${metrics.openHeight}px`);
  assert.ok(metrics.likeWidth >= 44 && metrics.likeHeight >= 44, `收藏按钮触控尺寸不足：${metrics.likeWidth} × ${metrics.likeHeight}px`);
  assert.equal(metrics.pressing, true, "pointerdown 当帧没有标记按下状态");
  assert.notEqual(metrics.pressedTransform, "none", "按下状态没有可见反馈");
  assert.ok(metrics.transitionDurations.some((duration) => duration >= .16 && duration <= .22), `非手势反馈不在 160–220ms：${metrics.transitionDurations}`);
  assert.match(metrics.fallbackText, /NBO/);
  assert.match(metrics.fallbackText, new RegExp(metrics.firstLabel));
  assert.equal(metrics.fallbackSource, null, "失败图仍保留请求 src");
  assert.equal(metrics.oldSourcesCleared, true, "切换大类后旧图片节点仍保留 src");
  assert.equal(metrics.nextCardCount, 11);
  assert.equal(metrics.nextImageCount, 11);
  assert.equal(metrics.openedStyleParam, metrics.openedStyleId, "点击整张卡片没有打开对应稳定风格 ID");
  assert.equal(metrics.openedView, "album");
});

test("customer wording is honest and the 158-photo gallery remains available behind its disclosure", { skip: !hasChrome }, async () => {
  const metrics = await measureCustomerStyleExplorer(390);

  assert.match(metrics.explorerText, /132 种风格/);
  assert.doesNotMatch(metrics.explorerText, /1188 张不同真实客片/);
  assert.equal(metrics.legacyDisclosurePresent, true);
  assert.equal(metrics.legacyGalleryInsideDisclosure, true);
  assert.equal(metrics.legacyThemeTargetPreserved, true, "旧 theme 快捷入口被破坏");
});

test("reduced-motion keeps feedback without a long moving transition", { skip: !hasChrome }, async () => {
  const metrics = await measureCustomerStyleExplorer(390, { reducedMotion: true });
  assert.equal(metrics.rootVisible, true, "减少动态测试页没有渲染风格浏览器");
  assert.ok(metrics.transitionDurations.length > 0, "没有可观察的交互反馈转场");
  assert.ok(metrics.transitionDurations.every((duration) => duration <= .02), `减少动态后仍存在长转场：${metrics.transitionDurations}`);
});

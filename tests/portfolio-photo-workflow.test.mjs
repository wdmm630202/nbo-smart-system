import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPortfolioItems,
  buildPortfolioThemes,
  emptyPortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import {
  assetPaths,
  buildPortfolioVersion,
  onlinePortfolioUrl,
  recoverIncompletePhotoTransactions,
  replacePhoto,
  root,
  transactionRoot,
  undoLatestPhotoReplacement,
  validateChangedPhotoBundles,
  validatePortfolioLibrary,
} from "../tools/portfolio-photo-lib.mjs";

async function fileHash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function hashes(paths) {
  return Object.fromEntries(await Promise.all(Object.entries(paths)
    .filter(([, path]) => path)
    .map(async ([key, path]) => [key, await fileHash(path)])));
}

async function createAdditionsLibraryFixture(t, additions) {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-additions-library-"));
  const photoRoot = join(directory, "photos");
  const additionsPath = join(directory, "catalog-additions.json");
  await Promise.all(["full", "thumbs", "featured"].map((name) => mkdir(join(photoRoot, name), { recursive: true })));
  const files = [];
  for (let id = 1; id <= portfolioCatalog.photoCount; id += 1) {
    const base = `photo-${String(id).padStart(3, "0")}`;
    files.push(writeFile(join(photoRoot, "full", `${base}.jpg`), `legacy-full-${id}\n`));
    files.push(writeFile(join(photoRoot, "thumbs", `${base}.webp`), `legacy-thumb-${id}\n`));
  }
  for (const id of portfolioCatalog.heroAssetIds) {
    const base = `photo-${String(id).padStart(3, "0")}`;
    files.push(writeFile(join(photoRoot, "featured", `${base}.webp`), `legacy-featured-${id}\n`));
  }
  for (const photo of additions.photos) {
    const base = `photo-${String(photo.id).padStart(3, "0")}`;
    files.push(writeFile(join(photoRoot, "full", `${base}.jpg`), `addition-full-${photo.id}\n`));
    files.push(writeFile(join(photoRoot, "thumbs", `${base}.webp`), `addition-thumb-${photo.id}\n`));
  }
  await Promise.all(files);
  await writeFile(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { additionsPath, photoRoot };
}

function registeredAdditions() {
  return {
    schemaVersion: 1,
    themes: [{
      id: "new-light",
      scene: "indoor",
      label: "新光影",
      description: "新主题",
      coverPhotoId: 159,
    }],
    photos: [
      {
        id: 159,
        scene: "indoor",
        theme: "new-light",
        category: "mood",
        title: "新光影",
        styleTitle: "情绪",
        featured: false,
        visibility: "published",
        publishedAt: "2026-08-31T00:00:00.000Z",
      },
      {
        id: 160,
        scene: "indoor",
        theme: "magazine",
        category: "business",
        title: "杂志肖像",
        styleTitle: "商务",
        featured: false,
        visibility: "archived",
        publishedAt: "2026-08-31T00:01:00.000Z",
      },
    ],
  };
}

function waitForOutput(child, pattern, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`等待管理台超时：${output}`)), timeout);
    const consume = (chunk) => {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timer);
        child.stdout.off("data", consume);
        child.stderr.off("data", consume);
        resolve(output);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
  });
}

test("客片清单生成 158 个唯一稳定编号", () => {
  const items = buildPortfolioItems();
  assert.equal(items.length, 158);
  assert.equal(new Set(items.map((item) => item.id)).size, 158);
  assert.deepEqual([...items].map((item) => item.id).sort((a, b) => a - b), Array.from({ length: 158 }, (_, index) => index + 1));
});

test("主题、气质和图片文件完整", async () => {
  const result = await validatePortfolioLibrary();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.photoCount, portfolioCatalog.photoCount);
  assert.equal(result.themeCount, 23);
});

test("公开库验证已发布和已归档增量的完整资源", async (t) => {
  const fixture = await createAdditionsLibraryFixture(t, registeredAdditions());
  const complete = await validatePortfolioLibrary(fixture);
  assert.equal(complete.ok, true, complete.errors.join("\n"));
  assert.equal(complete.photoCount, 159);
  assert.equal(complete.themeCount, 24);

  await rm(join(fixture.photoRoot, "thumbs/photo-160.webp"));
  const incompleteArchived = await validatePortfolioLibrary(fixture);
  assert.equal(incompleteArchived.ok, false);
  assert.match(incompleteArchived.errors.join("\n"), /NB-160.*缩略图/);
});

test("公开库验证拒绝未知主题引用和断号增量", async (t) => {
  const additions = registeredAdditions();
  additions.photos[1].id = 161;
  additions.photos[1].theme = "missing-theme";
  const fixture = await createAdditionsLibraryFixture(t, additions);
  const result = await validatePortfolioLibrary(fixture);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /NB-160|断号/);
  assert.match(result.errors.join("\n"), /missing-theme/);
});

test("新主题有公开照片时必须使用公开封面", async (t) => {
  const additions = registeredAdditions();
  additions.photos[0].visibility = "archived";
  additions.photos[1] = {
    ...additions.photos[1],
    theme: "new-light",
    title: "新光影",
    visibility: "published",
  };
  const fixture = await createAdditionsLibraryFixture(t, additions);
  const result = await validatePortfolioLibrary(fixture);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /新光影|new-light/);
  assert.match(result.errors.join("\n"), /封面.*公开|公开.*封面/);
});

test("完全归档的新主题可保留归档封面且不展示", async (t) => {
  const additions = registeredAdditions();
  additions.photos[0].visibility = "archived";
  additions.photos[1] = {
    ...additions.photos[1],
    theme: "new-light",
    title: "新光影",
    visibility: "archived",
  };
  const fixture = await createAdditionsLibraryFixture(t, additions);
  const result = await validatePortfolioLibrary(fixture);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.photoCount, 158);
  assert.equal(result.themeCount, 23);
});

test("客户运行时对网络、HTTP、畸形 JSON 和合并错误都降级到历史图库", async () => {
  const { buildCustomerPortfolio, loadPortfolioAdditions } = await import("../apps/portfolio-v2/portfolio-runtime.js");
  const warnings = [];
  const networkFallback = await loadPortfolioAdditions({
    fetchImpl: async () => { throw new Error("offline"); },
    url: "./catalog-additions.json?v=test",
    fallback: emptyPortfolioAdditions,
    warn: (...args) => warnings.push(args),
  });
  const httpFallback = await loadPortfolioAdditions({
    fetchImpl: async () => ({ ok: false, status: 503 }),
    url: "./catalog-additions.json?v=test",
    fallback: emptyPortfolioAdditions,
    warn: (...args) => warnings.push(args),
  });
  assert.equal(networkFallback, emptyPortfolioAdditions);
  assert.equal(httpFallback, emptyPortfolioAdditions);
  const malformedFallback = await loadPortfolioAdditions({
    fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("broken JSON"); } }),
    url: "./catalog-additions.json?v=test",
    fallback: emptyPortfolioAdditions,
    warn: (...args) => warnings.push(args),
  });
  assert.equal(malformedFallback, emptyPortfolioAdditions);
  assert.equal(warnings.length, 3);

  const malformedModel = buildCustomerPortfolio({
    catalog: portfolioCatalog,
    additions: { schemaVersion: 1, themes: [], photos: [{ id: 159, phone: "13800138000" }] },
    fallback: emptyPortfolioAdditions,
    warn: (...args) => warnings.push(args),
    buildItems: buildPortfolioItems,
    buildThemes: buildPortfolioThemes,
  });
  assert.equal(malformedModel.items.length, 158);
  assert.equal(malformedModel.themes.length, 23);
  assert.equal(warnings.length, 4);

  const model = buildCustomerPortfolio({
    catalog: portfolioCatalog,
    additions: registeredAdditions(),
    buildItems: buildPortfolioItems,
    buildThemes: buildPortfolioThemes,
  });
  assert.equal(model.items.length, 159);
  assert.equal(model.themes.length, 24);
  assert.equal(model.items.some(({ id }) => id === 159), true);
  assert.equal(model.items.some(({ id }) => id === 160), false);
  assert.deepEqual(model.counts, {
    photos: 159,
    themes: 24,
    scenes: { indoor: 121, outdoor: 38 },
    sceneThemes: { indoor: 14, outdoor: 10 },
  });
});

test("发布版本由代码与照片内容确定", async () => {
  const [first, second, sourceIndex] = await Promise.all([
    buildPortfolioVersion(),
    buildPortfolioVersion(),
    readFile(join(root, "apps/portfolio-v2/index.html"), "utf8"),
  ]);
  assert.match(first, /^pv2-[a-f0-9]{12}$/);
  assert.equal(first, second);
  assert.match(sourceIndex, /type="module"/);
  assert.match(sourceIndex, /__NBO_BUILD_VERSION__/);
  assert.match(sourceIndex, /https:\/\/res\.wx\.qq\.com\/open\/js\/jweixin-1\.6\.0\.js/);
  assert.match(sourceIndex, /wechat-share\.js\?v=__NBO_BUILD_VERSION__/);
});

test("发布版本包含增量清单和已归档资源", async (t) => {
  const additions = registeredAdditions();
  const fixture = await createAdditionsLibraryFixture(t, additions);
  const before = await buildPortfolioVersion(fixture);

  await writeFile(join(fixture.photoRoot, "full/photo-160.jpg"), "archived-asset-changed\n");
  const afterArchivedAsset = await buildPortfolioVersion(fixture);
  assert.notEqual(afterArchivedAsset, before);

  additions.photos[1].visibility = "published";
  await writeFile(fixture.additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
  const afterManifest = await buildPortfolioVersion(fixture);
  assert.notEqual(afterManifest, afterArchivedAsset);
});

test("企业微信二维码跟随客片版本刷新", async () => {
  const qrPath = join(root, "apps/portfolio-v2/wechat-contact-qr.png");
  const [sourceIndex, originalQr, before] = await Promise.all([
    readFile(join(root, "apps/portfolio-v2/index.html"), "utf8"),
    readFile(qrPath),
    buildPortfolioVersion(),
  ]);
  assert.match(sourceIndex, /wechat-contact-qr\.png\?v=__NBO_BUILD_VERSION__/);

  const changedQr = Buffer.from(originalQr);
  changedQr[changedQr.length - 1] ^= 1;
  try {
    await writeFile(qrPath, changedQr);
    const after = await buildPortfolioVersion();
    assert.notEqual(after, before, "更换企业微信二维码后必须生成新的发布版本");
  } finally {
    await writeFile(qrPath, originalQr);
  }
});

test("微信分享客户端进入内容版本并完整发布", async () => {
  const [source, published, shortHtml, longHtml, sourceImage, publishedImage] = await Promise.all([
    readFile(join(root, "apps/portfolio-v2/wechat-share.js"), "utf8"),
    readFile(join(root, "docs/projects/portfolio-v2/wechat-share.js"), "utf8"),
    readFile(join(root, "docs/p/index.html"), "utf8"),
    readFile(join(root, "docs/projects/portfolio-v2/index.html"), "utf8"),
    readFile(join(root, "apps/portfolio-v2/share-card-square.jpg")),
    readFile(join(root, "docs/projects/portfolio-v2/share-card-square.jpg")),
  ]);

  assert.equal(published, source);
  assert.deepEqual(publishedImage, sourceImage);
  assert.match(source, /share-card-square\.jpg/);
  for (const html of [shortHtml, longHtml]) {
    assert.match(html, /wechat-share\.js\?v=pv2-[a-f0-9]{12}/);
    assert.match(html, /share-card-square\.jpg\?v=pv2-[a-f0-9]{12}/);
    assert.match(html, /<meta property="og:url" content="https:\/\/p\.nanbostudio\.com\/\?share=pv2-[a-f0-9]{12}" \/>/);
    assert.match(html, /<meta property="og:title" content="南铂摄影｜268元拍2套｜先选风格，再预约时间到店开拍📷" \/>/);
    assert.match(html, /<meta property="og:description" content="浏览真实客片，找到适合你的场景与表达；在线确认风格与需求，到店完成拍摄" \/>/);
    assert.doesNotMatch(html, /__NBO_BUILD_VERSION__/);
  }
});

test("微信 JS 安全域名校验文件按原字节发布", async () => {
  const [source, published] = await Promise.all([
    readFile(join(root, "apps/portfolio-v2/MP_verify_ZCU9ptvNi6e2Zgi3.txt")),
    readFile(join(root, "docs/p/MP_verify_ZCU9ptvNi6e2Zgi3.txt")),
  ]);

  assert.deepEqual(published, source);
});

test("微信 JS 安全域名校验文件按原字节发布", async () => {
  const [source, published] = await Promise.all([
    readFile(join(root, "apps/portfolio-v2/MP_verify_ZCU9ptvNi6e2Zgi3.txt")),
    readFile(join(root, "docs/p/MP_verify_ZCU9ptvNi6e2Zgi3.txt")),
  ]);

  assert.deepEqual(published, source);
});

test("对外固定短链接不包含内部版本路径", async () => {
  const [shortIndex, shortBuild, longBuild] = await Promise.all([
    readFile(join(root, "docs/p/index.html"), "utf8"),
    readFile(join(root, "docs/p/build.json"), "utf8"),
    readFile(join(root, "docs/projects/portfolio-v2/build.json"), "utf8"),
  ]);
  assert.match(shortIndex, /<base href="\.\.\/projects\/portfolio-v2\/" \/>/);
  assert.match(shortIndex, /rel="canonical" href="https:\/\/wdmm630202\.github\.io\/nbo-smart-system\/p\/"/);
  assert.match(shortIndex, /href="\/nbo-smart-system\/p\/#works"/);
  assert.doesNotMatch(shortIndex, /href="#/);
  assert.doesNotMatch(shortIndex, /__NBO_BUILD_VERSION__/);
  assert.equal(shortBuild, longBuild);
  assert.equal(onlinePortfolioUrl, "https://wdmm630202.github.io/nbo-smart-system/p/");
});

test("发布必须包含同编号的全套图片", () => {
  const normalIncomplete = validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-158.jpg",
  ]);
  assert.equal(normalIncomplete.ok, false);
  assert.match(normalIncomplete.errors.join("\n"), /NB-158.*缩略图/);

  const normalComplete = validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-158.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-158.webp",
  ]);
  assert.equal(normalComplete.ok, true, normalComplete.errors.join("\n"));

  const heroIncomplete = validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-137.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-137.webp",
  ]);
  assert.equal(heroIncomplete.ok, false);
  assert.match(heroIncomplete.errors.join("\n"), /NB-137.*首页图/);

  const heroComplete = validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-137.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-137.webp",
    "apps/portfolio/assets/photos/featured/photo-137.webp",
  ]);
  assert.deepEqual(heroComplete, { ok: true, errors: [], slots: [137] });
});

test("换图可撤销，且会跳过损坏的较新备份", { timeout: 60_000 }, async () => {
  const id = 158;
  const targets = assetPaths(id);
  const candidate = assetPaths(157).full;
  const safetyDir = await mkdtemp(join(tmpdir(), "nanbo-transaction-test-"));
  const safetyPaths = {
    full: join(safetyDir, "full.jpg"),
    thumb: join(safetyDir, "thumb.webp"),
  };
  const originalHashes = await hashes(targets);
  let result;
  let corruptBackup = "";
  await copyFile(targets.full, safetyPaths.full);
  await copyFile(targets.thumb, safetyPaths.thumb);

  try {
    result = await replacePhoto(id, candidate, "portfolio-workflow-test.jpg");
    const replacedHashes = await hashes(targets);
    assert.notEqual(replacedHashes.full, originalHashes.full);
    assert.notEqual(replacedHashes.thumb, originalHashes.thumb);

    corruptBackup = join(result.backupDir, "..", "zzzz-corrupt-test");
    await mkdir(corruptBackup, { recursive: true });
    await writeFile(join(corruptBackup, "meta.json"), "{损坏的记录\n");

    await undoLatestPhotoReplacement(id);
    assert.deepEqual(await hashes(targets), originalHashes);
  } finally {
    // 即使断言失败，也把用户原图按字节恢复。
    await copyFile(safetyPaths.full, targets.full);
    await copyFile(safetyPaths.thumb, targets.thumb);
    if (result?.backupDir) await rm(result.backupDir, { recursive: true, force: true });
    if (corruptBackup) await rm(corruptBackup, { recursive: true, force: true });
    await rm(safetyDir, { recursive: true, force: true });
  }
});

test("启动恢复会修复中断的首页图事务", { timeout: 30_000 }, async () => {
  const id = 137;
  const targets = assetPaths(id);
  const other = assetPaths(127);
  const safetyDir = await mkdtemp(join(tmpdir(), "nanbo-recovery-test-"));
  const beforeDir = join(safetyDir, "before");
  const transactionDir = join(transactionRoot, `test-${Date.now()}-${randomBytes(4).toString("hex")}`);
  const originalHashes = await hashes(targets);
  await mkdir(beforeDir, { recursive: true });
  await copyFile(targets.full, join(beforeDir, "full.jpg"));
  await copyFile(targets.thumb, join(beforeDir, "thumb.webp"));
  await copyFile(targets.featured, join(beforeDir, "featured.webp"));

  try {
    await mkdir(join(transactionDir, "before"), { recursive: true });
    await copyFile(targets.full, join(transactionDir, "before/full.jpg"));
    await copyFile(targets.thumb, join(transactionDir, "before/thumb.webp"));
    await copyFile(targets.featured, join(transactionDir, "before/featured.webp"));
    await writeFile(join(transactionDir, "transaction.json"), `${JSON.stringify({
      id,
      operation: "replace",
      status: "committing",
      historyMetaPath: "",
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`);

    // 制造只有高清图和首页图已被覆盖的中断状态。
    await copyFile(other.full, targets.full);
    await copyFile(other.featured, targets.featured);
    assert.notDeepEqual(await hashes(targets), originalHashes);

    const recovered = await recoverIncompletePhotoTransactions();
    assert.ok(recovered.includes("NB-137"));
    assert.deepEqual(await hashes(targets), originalHashes);
  } finally {
    await copyFile(join(beforeDir, "full.jpg"), targets.full);
    await copyFile(join(beforeDir, "thumb.webp"), targets.thumb);
    await copyFile(join(beforeDir, "featured.webp"), targets.featured);
    await rm(transactionDir, { recursive: true, force: true });
    await rm(safetyDir, { recursive: true, force: true });
  }
});

test("第二次启动不会恢复第一个进程的活跃事务", { timeout: 30_000 }, async () => {
  const port = 44_000 + randomBytes(2).readUInt16BE() % 1_000;
  const sandbox = await mkdtemp(join(tmpdir(), "nanbo-manager-startup-"));
  const draftDirectory = join(sandbox, "drafts");
  const additionsPath = join(sandbox, "catalog-additions.json");
  const publicPhotoRoot = join(sandbox, "public");
  await mkdir(publicPhotoRoot, { recursive: true });
  await writeFile(additionsPath, `${JSON.stringify({ schemaVersion: 1, themes: [], photos: [] }, null, 2)}\n`);
  const environment = {
    ...process.env,
    NANBO_PORTFOLIO_PORT: String(port),
    NANBO_PORTFOLIO_DRAFT_ROOT: draftDirectory,
    NANBO_PORTFOLIO_ADDITIONS_PATH: additionsPath,
    NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT: publicPhotoRoot,
  };
  const serverScript = join(root, "tools/portfolio-manager-server.mjs");
  const first = spawn(process.execPath, [serverScript], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const sentinelDir = join(transactionRoot, `active-instance-test-${Date.now()}-${randomBytes(4).toString("hex")}`);
  const sentinelPath = join(sentinelDir, "transaction.json");
  try {
    await waitForOutput(first, /南铂客片管理台：/);
    await mkdir(sentinelDir, { recursive: true });
    await writeFile(sentinelPath, "{正在由第一个进程写入\n");

    const second = spawn(process.execPath, [serverScript], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const secondOutputPromise = waitForOutput(second, /已在运行/);
    const [secondOutput, [exitCode]] = await Promise.all([secondOutputPromise, once(second, "exit")]);
    assert.equal(exitCode, 0, secondOutput);
    assert.equal(await readFile(sentinelPath, "utf8"), "{正在由第一个进程写入\n");
  } finally {
    await rm(sentinelDir, { recursive: true, force: true });
    if (first.exitCode === null) {
      first.kill("SIGTERM");
      await once(first, "exit");
    }
    await rm(sandbox, { recursive: true, force: true });
  }
});

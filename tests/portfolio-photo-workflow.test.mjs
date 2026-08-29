import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPortfolioItems, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
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
  assert.equal(result.heroAssetCount, 5);
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
    assert.match(html, /<meta property="og:title" content="南铂摄影｜先选风格，再预约到店拍摄" \/>/);
    assert.match(html, /<meta property="og:description" content="浏览真实男士客片，挑选喜欢的场景与主题，生成拍摄需求，让沟通更轻松，预约到店更高效。" \/>/);
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
  const environment = { ...process.env, NANBO_PORTFOLIO_PORT: String(port) };
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
  }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPortfolioItems,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import { buildStyleLibrary } from "../apps/portfolio-v2/style-library.js";
import { readStylePreferences } from "../apps/portfolio-v2/style-preferences.js";
import * as photoLib from "../tools/portfolio-photo-lib.mjs";

const styleStoreUrl = new URL("../tools/portfolio-style-store.mjs", import.meta.url);
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = await access(chromePath).then(() => true, () => false);
let sourceFixtureRoot = "";
let validPhoto = "";
let newerValidPhoto = "";
let wrongRatioPhoto = "";

const deferredStyleImageScript = `(() => {
  const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
  const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
  window.__styleImageProbes = [];
  window.__styleCreatedObjectUrls = [];
  window.__styleRevokedObjectUrls = [];
  URL.createObjectURL = (value) => {
    const objectUrl = originalCreateObjectUrl(value);
    window.__styleCreatedObjectUrls.push(objectUrl);
    return objectUrl;
  };
  URL.revokeObjectURL = (value) => {
    window.__styleRevokedObjectUrls.push(String(value));
    originalRevokeObjectUrl(value);
  };
  window.Image = class DeferredStyleImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this._src = "";
    }
    set src(value) {
      this._src = String(value);
      window.__styleImageProbes.push(this);
    }
    get src() {
      return this._src;
    }
  };
  window.__finishStyleImageProbe = (index, { width = 900, height = 1200, error = false } = {}) => {
    const probe = window.__styleImageProbes[index];
    if (!probe) throw new Error("missing deferred style image probe " + index);
    if (error) {
      probe.onerror?.(new Event("error"));
      return;
    }
    probe.naturalWidth = width;
    probe.naturalHeight = height;
    probe.onload?.(new Event("load"));
  };
})()`;

function waitForManagerOutput(child, pattern, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`等待风格管理接口超时：${output}`)), timeout);
    const consume = (chunk) => {
      output += chunk;
      if (!pattern.test(output)) return;
      clearTimeout(timer);
      child.stdout.off("data", consume);
      child.stderr.off("data", consume);
      resolve(output);
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
  });
}

async function startManagerFixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "nanbo-style-manager-api-"));
  const draftRoot = join(sandbox, "drafts");
  const photoRoot = join(sandbox, "photos");
  const additionsPath = join(sandbox, "catalog-additions.json");
  const catalogPath = join(sandbox, "style-catalog.json");
  const assignmentsPath = join(sandbox, "style-slot-assignments.json");
  const publishedRoot = join(sandbox, "docs/projects/portfolio-v2");
  const publishedAdditionsPath = join(publishedRoot, "catalog-additions.json");
  const publishedCatalogPath = join(publishedRoot, "style-catalog.json");
  const publishedAssignmentsPath = join(publishedRoot, "style-slot-assignments.json");
  const [catalog, assignments] = await Promise.all([
    readFile(new URL("../apps/portfolio-v2/style-catalog.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../apps/portfolio-v2/style-slot-assignments.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assignments.assignments["ST-IN-01-01"].slots[0].assetId = 137;
  assignments.assignments["ST-IN-01-02"].slots[0].assetId = 137;
  const additions = { schemaVersion: 1, themes: [], photos: [] };
  await Promise.all([
    mkdir(draftRoot, { recursive: true }),
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
    mkdir(join(photoRoot, "featured"), { recursive: true }),
    mkdir(publishedRoot, { recursive: true }),
  ]);
  await Promise.all([
    copyFile(photoLib.assetPaths(158).full, join(photoRoot, "full/photo-158.jpg")),
    copyFile(photoLib.assetPaths(158).thumb, join(photoRoot, "thumbs/photo-158.webp")),
    writeFile(additionsPath, `${JSON.stringify(additions, null, 2)}\n`),
    writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
    writeFile(publishedAdditionsPath, `${JSON.stringify(additions, null, 2)}\n`),
    writeFile(publishedCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(publishedAssignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
  ]);

  const child = spawn(process.execPath, [fileURLToPath(new URL("../tools/portfolio-manager-server.mjs", import.meta.url))], {
    env: {
      ...process.env,
      NANBO_PORTFOLIO_PORT: "0",
      NANBO_PORTFOLIO_FIXTURE_ROOT: sandbox,
      NANBO_PORTFOLIO_DRAFT_ROOT: draftRoot,
      NANBO_PORTFOLIO_ADDITIONS_PATH: additionsPath,
      NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT: photoRoot,
      NANBO_PORTFOLIO_STYLE_ROOT: sandbox,
      NANBO_PORTFOLIO_STYLE_CATALOG_PATH: catalogPath,
      NANBO_PORTFOLIO_STYLE_ASSIGNMENTS_PATH: assignmentsPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(sandbox, { recursive: true, force: true });
  });
  const output = await waitForManagerOutput(child, /南铂客片管理台：/);
  const selectedPort = output.match(/南铂客片管理台：http:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
  assert.ok(selectedPort && selectedPort !== "0", `管理台未使用系统分配的随机端口：${output}`);
  const url = `http://127.0.0.1:${selectedPort}/`;
  const session = await (await fetch(new URL("api/session", url))).json();
  return {
    additionsPath,
    assignmentsPath,
    catalogPath,
    child,
    exactOrigin: new URL(url).origin,
    photoRoot,
    publishedAdditionsPath,
    publishedAssignmentsPath,
    publishedCatalogPath,
    publishedRoot,
    sandbox,
    token: session.token,
    url,
    postJson(path, body, headers = {}) {
      return fetch(new URL(path, url), {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin: new URL(url).origin,
          "x-nanbo-token": session.token,
          ...headers,
        },
      });
    },
  };
}

async function startManagerBrowser(t, url, { width = 1280, reducedMotion = false, beforeLoadScript = "" } = {}) {
  const profileDir = await mkdtemp(join(tmpdir(), "nanbo-manager-chrome-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Chrome DevTools 启动超时：${stderr}`)), 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome 提前退出（${code}）：${stderr}`));
    });
  });

  const socket = new WebSocket(debuggerUrl);
  const pending = new Map();
  let nextMessageId = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
    else waiting.resolve(message.result);
  });
  const command = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++nextMessageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  await command("Page.enable", {}, sessionId);
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 700,
    screenWidth: width,
    screenHeight: 900,
  }, sessionId);
  if (reducedMotion) {
    await command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    }, sessionId);
  }
  if (beforeLoadScript) {
    await command("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoadScript }, sessionId);
  }
  await command("Page.navigate", { url }, sessionId);

  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "浏览器脚本执行失败");
    }
    return result.result?.value;
  };
  const waitFor = async (expression, timeout = 10_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`等待浏览器状态超时：${expression}`);
  };
  const setFileInput = async (selector, path) => {
    const documentTree = await command("DOM.getDocument", { depth: 1, pierce: true }, sessionId);
    const selected = await command("DOM.querySelector", { nodeId: documentTree.root.nodeId, selector }, sessionId);
    assert.ok(selected.nodeId, `找不到文件选择器 ${selector}`);
    await command("DOM.setFileInputFiles", { files: Array.isArray(path) ? path : [path], nodeId: selected.nodeId }, sessionId);
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (input) input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
  };

  t.after(async () => {
    socket.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "close");
    }
    await rm(profileDir, { recursive: true, force: true });
  });
  return { evaluate, setFileInput, waitFor };
}

async function startDeferredStyleManager(t) {
  const server = await startManagerFixture(t);
  const browser = await startManagerBrowser(t, server.url, {
    width: 1280,
    beforeLoadScript: deferredStyleImageScript,
  });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const input = document.querySelector('input[name="library-mode"][value="styles"]');
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  return { browser, server };
}

function responseFromNodeRequest(options, writeRequest = (request) => request.end()) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          body: text ? JSON.parse(text) : null,
          status: response.statusCode,
        });
      });
    });
    request.on("error", reject);
    writeRequest(request);
  });
}

function allObjectKeys(value, keys = new Set()) {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) allObjectKeys(item, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    allObjectKeys(child, keys);
  }
  return keys;
}

async function loadStyleStoreModule() {
  try {
    return await import(styleStoreUrl.href);
  } catch (error) {
    assert.fail(`portfolio style store behavior is unavailable: ${error.message}`);
  }
}

async function generateJpeg(path, size, color, metadata = "") {
  const ffmpeg = await photoLib.resolveBinary("ffmpeg");
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=${size}:d=0.1`,
    "-frames:v", "1",
  ];
  if (metadata) args.push("-metadata", `comment=${metadata}`);
  args.push("-q:v", "2", path);
  await photoLib.run(ffmpeg, args);
}

test.before(async () => {
  sourceFixtureRoot = await mkdtemp(join(tmpdir(), "nanbo-style-source-"));
  validPhoto = join(sourceFixtureRoot, "valid-private.jpg");
  newerValidPhoto = join(sourceFixtureRoot, "newer-private.jpg");
  wrongRatioPhoto = join(sourceFixtureRoot, "wrong-ratio.jpg");
  await generateJpeg(validPhoto, "900x1200", "0x6b4f3f", "NANBO_PRIVATE_TEST");
  await generateJpeg(newerValidPhoto, "1200x1600", "0x45586f", "NANBO_NEWER_PRIVATE_TEST");
  await generateJpeg(wrongRatioPhoto, "1600x1200", "0x45586f");
});

test.after(async () => {
  if (sourceFixtureRoot) await rm(sourceFixtureRoot, { recursive: true, force: true });
});

async function createStyleStoreFixture(t, options = {}) {
  const { createPortfolioStyleStore } = await loadStyleStoreModule();
  assert.equal(typeof createPortfolioStyleStore, "function", "createPortfolioStyleStore must be a public function");
  const directory = await mkdtemp(join(tmpdir(), "nanbo-style-store-"));
  const rootDir = join(directory, "workspace");
  const photoRoot = join(rootDir, "photos");
  const additionsPath = join(rootDir, "catalog-additions.json");
  const catalogPath = join(rootDir, "style-catalog.json");
  const assignmentsPath = join(rootDir, "style-slot-assignments.json");
  const [catalog, assignments] = await Promise.all([
    readFile(new URL("../apps/portfolio-v2/style-catalog.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../apps/portfolio-v2/style-slot-assignments.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const sharedAssetId = options.sharedAssetId ?? 137;
  assignments.assignments["ST-IN-01-01"].slots[0].assetId = sharedAssetId;
  assignments.assignments["ST-IN-01-02"].slots[0].assetId = sharedAssetId;
  await mkdir(rootDir, { recursive: true });
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
    writeFile(additionsPath, `${JSON.stringify({ schemaVersion: 1, themes: [], photos: [] }, null, 2)}\n`),
    writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    additionsPath,
    assignmentsPath,
    catalogPath,
    directory,
    photoRoot,
    rootDir,
    createStore: (storeOptions = {}) => createPortfolioStyleStore({
      rootDir,
      photoRoot,
      additionsPath,
      catalogPath,
      assignmentsPath,
      ...storeOptions,
    }),
    store: createPortfolioStyleStore({ rootDir, photoRoot, additionsPath, catalogPath, assignmentsPath }),
    validPhoto,
    wrongRatioPhoto,
  };
}

async function fileBytes(path) {
  return readFile(path);
}

async function stageFullBatch(store, inputPath = validPhoto) {
  const batchId = await store.createBatch();
  for (let position = 1; position <= 9; position += 1) {
    await store.stageBatchFile(batchId, position, inputPath);
  }
  return batchId;
}

async function transactionMetas(rootDir) {
  const transactionRoot = join(rootDir, ".local/portfolio-style-transactions");
  let entries = [];
  try {
    entries = await readdir(transactionRoot);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const metas = [];
  for (const entry of entries.sort()) {
    try {
      metas.push(JSON.parse(await readFile(join(transactionRoot, entry, "meta.json"), "utf8")));
    } catch {
      // History readers intentionally tolerate a corrupt entry.
    }
  }
  return metas;
}

test("asset codes support NB-1000 without changing three-digit legacy codes", () => {
  assert.equal(photoLib.slotCode(1), "NB-001");
  assert.equal(photoLib.slotCode(37), "NB-037");
  assert.equal(photoLib.slotCode(999), "NB-999");
  assert.equal(photoLib.slotCode(1000), "NB-1000");
  assert.equal(typeof photoLib.assertPublicAssetCode, "function", "public asset code validation is unavailable");
  assert.equal(photoLib.assertPublicAssetCode("NB-001"), 1);
  assert.equal(photoLib.assertPublicAssetCode("NB-1000"), 1000);
  assert.throws(() => photoLib.assertPublicAssetCode("NB-01"), /asset|NB-|\u8d44\u4ea7|\u7f16\u53f7/i);
  assert.throws(() => photoLib.assertPublicAssetCode("NB-0001"), /asset|NB-|\u8d44\u4ea7|\u7f16\u53f7/i);
});

test("changed photo bundles recognize complete four-digit assets", () => {
  assert.deepEqual(photoLib.validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-1000.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-1000.webp",
  ]), { ok: true, errors: [], slots: [1000] });
});

test("changed photo bundles reject non-canonical leading zeroes", () => {
  const nonCanonical = photoLib.validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-0001.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-0001.webp",
  ]);
  assert.equal(nonCanonical.ok, false);
  assert.match(nonCanonical.errors.join("\n"), /规范|编号|photo-001/i);
  assert.deepEqual(photoLib.validateChangedPhotoBundles([
    "apps/portfolio/assets/photos/full/photo-001.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-001.webp",
  ]), { ok: true, errors: [], slots: [1] });
});

test("style store exposes only published additions and rejects archived slot references", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const additions = {
    schemaVersion: 1,
    themes: [],
    photos: [159, 160].map((id) => ({
      id,
      scene: "indoor",
      theme: "business-boss",
      category: "business",
      title: `增量客片 ${id}`,
      styleTitle: "商务",
      featured: false,
      visibility: id === 159 ? "published" : "archived",
      publishedAt: "2026-09-01T00:00:00.000Z",
    })),
  };
  const assignments = JSON.parse(await readFile(fixture.assignmentsPath, "utf8"));
  assignments.assignments["ST-IN-01-01"].slots[1] = {
    ...assignments.assignments["ST-IN-01-01"].slots[1],
    assetId: 159,
    source: "upload",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  await Promise.all([
    writeFile(fixture.additionsPath, `${JSON.stringify(additions, null, 2)}\n`),
    writeFile(fixture.assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
  ]);

  const state = await fixture.store.read();
  assert.deepEqual(
    state.assets.map(({ id }) => id),
    buildPortfolioItems(portfolioCatalog, additions).map(({ id }) => id),
  );
  assert.equal(state.assetCount, 159);
  assert.equal(state.counts.assets, 159);
  assert.deepEqual(state.assetIds.slice(-2), [159, 160], "archived IDs remain reserved for future allocation");

  assignments.assignments["ST-IN-01-01"].slots[1].assetId = 160;
  await writeFile(fixture.assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`);
  await assert.rejects(() => fixture.store.read(), /公共资产|160/);
});

test("replacing a reused slot creates one sanitized asset and changes only that slot", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await fixture.store.read();
  const otherBefore = before.slotById["ST-IN-01-02-P01"];

  const result = await fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "new.jpg",
  });
  const after = await fixture.store.read();

  assert.deepEqual(result, {
    assetId: 159,
    code: "NB-159",
    slotId: "ST-IN-01-01-P01",
  });
  assert.equal(after.slotById["ST-IN-01-01-P01"].assetId, 159);
  assert.equal(after.slotById["ST-IN-01-01-P01"].source, "upload");
  assert.equal(after.slotById["ST-IN-01-02-P01"].assetId, 137);
  assert.deepEqual(after.slotById["ST-IN-01-02-P01"], otherBefore);
  assert.equal(before.assetCount + 1, after.assetCount);

  const fullPath = join(fixture.photoRoot, "full/photo-159.jpg");
  const thumbPath = join(fixture.photoRoot, "thumbs/photo-159.webp");
  const [fullInfo, thumbInfo] = await Promise.all([
    photoLib.probeImage(fullPath),
    photoLib.probeImage(thumbPath),
  ]);
  assert.deepEqual({ width: fullInfo.width, height: fullInfo.height }, { width: 1080, height: 1440 });
  assert.deepEqual({ width: thumbInfo.width, height: thumbInfo.height }, { width: 480, height: 640 });

  const ffprobe = await photoLib.resolveBinary("ffprobe");
  const metadata = await photoLib.run(ffprobe, [
    "-v", "error", "-show_entries", "format_tags", "-of", "json", fullPath,
  ]);
  assert.doesNotMatch(metadata.stdout, /NANBO_PRIVATE_TEST/);

  const metas = await transactionMetas(fixture.rootDir);
  assert.equal(metas.length, 1);
  assert.equal(metas[0].operation, "replace-slot");
  assert.equal(metas[0].status, "committed");
});

test("invalid source validation leaves manifests, assets, and journal untouched", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const [additionsBefore, assignmentsBefore] = await Promise.all([
    fileBytes(fixture.additionsPath),
    fileBytes(fixture.assignmentsPath),
  ]);

  await assert.rejects(() => fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.wrongRatioPhoto,
    originalName: "landscape.jpg",
  }), /3:4/);

  assert.deepEqual(await fileBytes(fixture.additionsPath), additionsBefore);
  assert.deepEqual(await fileBytes(fixture.assignmentsPath), assignmentsBefore);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "full")), []);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "thumbs")), []);
  assert.deepEqual(await transactionMetas(fixture.rootDir), []);
});

test("nine-photo batch is atomic when one file is invalid", { timeout: 120_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const originalAssignments = JSON.parse(await readFile(fixture.assignmentsPath, "utf8"));
  assert.equal(typeof fixture.store.createBatch, "function", "createBatch behavior is unavailable");
  assert.equal(typeof fixture.store.stageBatchFile, "function", "stageBatchFile behavior is unavailable");
  assert.equal(typeof fixture.store.commitBatch, "function", "commitBatch behavior is unavailable");
  const batchId = await fixture.store.createBatch();
  assert.match(batchId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (let position = 1; position <= 8; position += 1) {
    await fixture.store.stageBatchFile(batchId, position, fixture.validPhoto);
  }
  await assert.rejects(
    fixture.store.stageBatchFile(batchId, 9, fixture.wrongRatioPhoto),
    /3:4|尺寸/,
  );
  await assert.rejects(
    fixture.store.commitBatch({
      batchId,
      styleId: "ST-IN-01-01",
      orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    }),
    /缺少第 9 张/,
  );
  assert.deepEqual(JSON.parse(await readFile(fixture.assignmentsPath, "utf8")), originalAssignments);
  assert.deepEqual(JSON.parse(await readFile(fixture.additionsPath, "utf8")).photos, []);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "full")), []);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "thumbs")), []);
});

test("batch commit installs eighteen assets and two manifests with consecutive unique IDs", { timeout: 180_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const batchId = await stageFullBatch(fixture.store);
  const result = await fixture.store.commitBatch({
    batchId,
    styleId: "ST-IN-01-01",
    orderedPositions: [9, 8, 7, 6, 5, 4, 3, 2, 1],
  });
  assert.deepEqual(result.assetIds, [159, 160, 161, 162, 163, 164, 165, 166, 167]);
  assert.equal(new Set(result.assetIds).size, 9);
  const after = await fixture.store.read();
  assert.deepEqual(
    after.styles.find(({ id }) => id === "ST-IN-01-01").slots.map(({ assetId }) => assetId),
    [167, 166, 165, 164, 163, 162, 161, 160, 159],
  );
  assert.equal(after.assignments.assignments["ST-IN-01-01"].maturity, "updating");
  assert.equal(after.assignments.assignments["ST-IN-01-01"].slots.every(({ source }) => source === "upload"), true);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "full")), result.assetIds.map((id) => `photo-${id}.jpg`));
  assert.deepEqual(await readdir(join(fixture.photoRoot, "thumbs")), result.assetIds.map((id) => `photo-${id}.webp`));
  const batchTransaction = (await transactionMetas(fixture.rootDir)).find(({ operation }) => operation === "replace-style-batch");
  assert.equal(batchTransaction.status, "committed");
  assert.equal(batchTransaction.outputs.length, 20);
  await assert.rejects(() => stat(join(fixture.rootDir, ".local/portfolio-style-batches", batchId)), { code: "ENOENT" });
  await assert.rejects(() => fixture.store.commitBatch({
    batchId,
    styleId: "ST-IN-01-01",
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  }), /不存在|已处理/);
  assert.equal((await fixture.store.read()).additions.photos.length, 9);
});

test("each slot in a committed nine-photo batch has independent persisted undo history", { timeout: 180_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const styleId = "ST-IN-01-01";
  const originalAssetIds = [137, 81, 129, 11, 93, 139, 147, 157, 73];
  const batchId = await stageFullBatch(fixture.store);
  await fixture.store.commitBatch({
    batchId,
    styleId,
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  });
  const batchTransaction = (await transactionMetas(fixture.rootDir))
    .find(({ operation }) => operation === "replace-style-batch");
  assert.equal(batchTransaction.previousAssignments.length, 9);
  assert.deepEqual(batchTransaction.previousAssignments.map(({ slotId, assetId, previousAssignment }) => ({
    slotId,
    assetId,
    previousAssetId: previousAssignment.assetId,
  })), originalAssetIds.map((previousAssetId, index) => ({
    slotId: `${styleId}-P${String(index + 1).padStart(2, "0")}`,
    assetId: 159 + index,
    previousAssetId,
  })));

  for (let index = 0; index < 9; index += 1) {
    const slotId = `${styleId}-P${String(index + 1).padStart(2, "0")}`;
    const undone = await fixture.createStore().undoSlot(slotId);
    assert.equal(undone.restoredAssetId, originalAssetIds[index], slotId);
    assert.equal((await fixture.createStore().read()).slotById[slotId].assetId, originalAssetIds[index], slotId);
  }
  const restored = await fixture.createStore().read();
  assert.deepEqual(restored.styles.find(({ id }) => id === styleId).slots.map(({ assetId }) => assetId), originalAssetIds);
  assert.deepEqual(restored.additions.photos, []);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "full")), []);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "thumbs")), []);
});

test("batch positions are single-assignment, discard is idempotent, and expired staging is removed", { timeout: 60_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const batchId = await fixture.store.createBatch();
  await fixture.store.stageBatchFile(batchId, 1, fixture.validPhoto);
  await assert.rejects(() => fixture.store.stageBatchFile(batchId, 1, fixture.validPhoto), /第 1 张.*已|重复/);
  assert.deepEqual(await fixture.store.discardBatch(batchId), { batchId, discarded: true });
  assert.deepEqual(await fixture.store.discardBatch(batchId), { batchId, discarded: false });

  const expiringStore = fixture.createStore({ batchTtlMs: 5 });
  const expiredId = await expiringStore.createBatch();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await assert.rejects(() => expiringStore.stageBatchFile(expiredId, 1, fixture.validPhoto), /过期|不存在/);
  await assert.rejects(() => stat(join(fixture.rootDir, ".local/portfolio-style-batches", expiredId)), { code: "ENOENT" });
});

test("batch staging rejects a realpath escape before writing outside the workspace", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const outside = join(fixture.directory, "outside-batches");
  const batchRoot = join(fixture.rootDir, ".local/portfolio-style-batches");
  await mkdir(join(fixture.rootDir, ".local"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, batchRoot);
  await assert.rejects(() => fixture.store.createBatch(), /realpath|符号链接|越界|rootDir/);
  assert.deepEqual(await readdir(outside), []);
});

test("a late batch output failure rolls back all eighteen assets and both manifests, then permits retry", { timeout: 180_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const batchId = await stageFullBatch(fixture.store);
  const [additionsBefore, assignmentsBefore] = await Promise.all([
    fileBytes(fixture.additionsPath),
    fileBytes(fixture.assignmentsPath),
  ]);
  const blockingThumb = join(fixture.photoRoot, "thumbs/photo-167.webp");
  await mkdir(blockingThumb);
  const input = {
    batchId,
    styleId: "ST-IN-01-01",
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
  await assert.rejects(() => fixture.store.commitBatch(input));
  assert.deepEqual(await fileBytes(fixture.additionsPath), additionsBefore);
  assert.deepEqual(await fileBytes(fixture.assignmentsPath), assignmentsBefore);
  assert.deepEqual(await readdir(join(fixture.photoRoot, "full")), []);
  assert.deepEqual((await readdir(join(fixture.photoRoot, "thumbs"))).filter((name) => name !== "photo-167.webp"), []);
  assert.equal((await stat(blockingThumb)).isDirectory(), true);
  assert.equal((await transactionMetas(fixture.rootDir)).at(-1).status, "rolled-back");

  await rm(blockingThumb, { recursive: true, force: true });
  const retry = await fixture.store.commitBatch(input);
  assert.deepEqual(retry.assetIds, [159, 160, 161, 162, 163, 164, 165, 166, 167]);
});

test("concurrent duplicate batch commits publish once and never allocate a second ID range", { timeout: 180_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const otherStore = fixture.createStore();
  const batchId = await stageFullBatch(fixture.store);
  const input = {
    batchId,
    styleId: "ST-IN-01-01",
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
  const results = await Promise.allSettled([
    fixture.store.commitBatch(input),
    otherStore.commitBatch(input),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  const after = await fixture.store.read();
  assert.deepEqual(after.additions.photos.map(({ id }) => id), [159, 160, 161, 162, 163, 164, 165, 166, 167]);
  assert.equal((await transactionMetas(fixture.rootDir)).filter(({ operation, status }) => operation === "replace-style-batch" && status === "committed").length, 1);
});

test("a mid-commit asset failure rolls back additions, assignments, full, and thumb", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const [additionsBefore, assignmentsBefore] = await Promise.all([
    fileBytes(fixture.additionsPath),
    fileBytes(fixture.assignmentsPath),
  ]);
  const blockingThumb = join(fixture.photoRoot, "thumbs/photo-159.webp");
  await mkdir(blockingThumb);

  await assert.rejects(() => fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "rollback.jpg",
  }));

  assert.deepEqual(await fileBytes(fixture.additionsPath), additionsBefore);
  assert.deepEqual(await fileBytes(fixture.assignmentsPath), assignmentsBefore);
  await assert.rejects(() => stat(join(fixture.photoRoot, "full/photo-159.jpg")), { code: "ENOENT" });
  assert.equal((await stat(blockingThumb)).isDirectory(), true);
  const metas = await transactionMetas(fixture.rootDir);
  assert.equal(metas.length, 1);
  assert.equal(metas[0].operation, "replace-slot");
  assert.equal(metas[0].status, "rolled-back");
});

test("reads on one store serialize behind an active replacement instead of recovering it", { timeout: 60_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  let replacementSettled = false;
  const replacement = fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "read-race.jpg",
  }).finally(() => { replacementSettled = true; });
  const readers = Array.from({ length: 12 }, async () => {
    let count = 0;
    while (!replacementSettled && count < 200) {
      await fixture.store.read();
      count += 1;
    }
    return count;
  });

  const [result, readCounts] = await Promise.all([replacement, Promise.all(readers)]);
  const after = await fixture.store.read();
  assert.ok(readCounts.reduce((sum, count) => sum + count, 0) > 0);
  assert.equal(after.slotById["ST-IN-01-01-P01"].assetId, result.assetId);
  assert.equal(after.additions.photos.some(({ id }) => id === result.assetId), true);
  assert.equal((await stat(join(fixture.photoRoot, `full/photo-${result.assetId}.jpg`))).isFile(), true);
  assert.equal((await stat(join(fixture.photoRoot, `thumbs/photo-${result.assetId}.webp`))).isFile(), true);
});

test("two store instances repeatedly allocate distinct assets without losing either slot update", { timeout: 120_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const firstStore = fixture.store;
  const secondStore = fixture.createStore();
  const rounds = [
    ["ST-IN-01-01-P02", "ST-IN-01-02-P02"],
    ["ST-IN-01-01-P03", "ST-IN-01-02-P03"],
    ["ST-IN-01-01-P04", "ST-IN-01-02-P04"],
  ];

  for (const [firstSlotId, secondSlotId] of rounds) {
    const [first, second] = await Promise.all([
      firstStore.replaceSlot({ slotId: firstSlotId, inputPath: fixture.validPhoto, originalName: `${firstSlotId}.jpg` }),
      secondStore.replaceSlot({ slotId: secondSlotId, inputPath: fixture.validPhoto, originalName: `${secondSlotId}.jpg` }),
    ]);
    assert.notEqual(first.assetId, second.assetId);
    const after = await firstStore.read();
    assert.equal(after.slotById[firstSlotId].assetId, first.assetId);
    assert.equal(after.slotById[secondSlotId].assetId, second.assetId);
    assert.equal(after.additions.photos.some(({ id }) => id === first.assetId), true);
    assert.equal(after.additions.photos.some(({ id }) => id === second.assetId), true);
  }
});

test("store lock rejects configured path traversal and recovers a dead owner's stale lock", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const { createPortfolioStyleStore } = await loadStyleStoreModule();
  assert.throws(() => createPortfolioStyleStore({
    rootDir: fixture.rootDir,
    photoRoot: join(fixture.rootDir, "../outside-photos"),
    additionsPath: fixture.additionsPath,
    catalogPath: fixture.catalogPath,
    assignmentsPath: fixture.assignmentsPath,
  }), /rootDir|路径|越界/);

  const lockPath = join(fixture.rootDir, ".local/portfolio-style-store.lock");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
    schemaVersion: 1,
    pid: 999_999_999,
    host: hostname(),
    token: "abcdef0123456789abcdef01",
    createdAt: "2000-01-01T00:00:00.000Z",
    heartbeatAt: "2000-01-01T00:00:00.000Z",
  }, null, 2)}\n`);

  const state = await fixture.store.read();
  assert.equal(state.counts.styles, 132);
  await assert.rejects(() => stat(lockPath), { code: "ENOENT" });
});

test("a fresh foreign-host lock times out without being deleted", { timeout: 2_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const lockPath = join(fixture.rootDir, ".local/portfolio-style-store.lock");
  const ownerPath = join(lockPath, "owner.json");
  const now = new Date().toISOString();
  const ownerBytes = `${JSON.stringify({
    schemaVersion: 1,
    pid: 42,
    host: "foreign-host.example",
    token: "1234567890abcdef12345678",
    createdAt: now,
    heartbeatAt: now,
  }, null, 2)}\n`;
  await mkdir(lockPath, { recursive: true });
  await writeFile(ownerPath, ownerBytes);

  const store = fixture.createStore({ lockWaitTimeoutMs: 75 });
  await assert.rejects(() => store.read(), /等待风格存储锁超时/);
  assert.equal(await readFile(ownerPath, "utf8"), ownerBytes);
});

test("an expired foreign-host heartbeat can be recovered", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const lockPath = join(fixture.rootDir, ".local/portfolio-style-store.lock");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
    schemaVersion: 1,
    pid: 42,
    host: "foreign-host.example",
    token: "1234567890abcdef12345678",
    createdAt: "2000-01-01T00:00:00.000Z",
    heartbeatAt: "2000-01-01T00:00:00.000Z",
  }, null, 2)}\n`);

  assert.equal((await fixture.store.read()).counts.styles, 132);
  await assert.rejects(() => stat(lockPath), { code: "ENOENT" });
});

test("recovery rejects a photo parent symlink outside root without deleting its target", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const externalDirectory = join(fixture.directory, "outside-root");
  const externalSentinel = join(externalDirectory, "photo-159.jpg");
  const fullDirectory = join(fixture.photoRoot, "full");
  await mkdir(externalDirectory);
  await writeFile(externalSentinel, "outside sentinel stays\n");
  await rm(fullDirectory, { recursive: true });
  await symlink(externalDirectory, fullDirectory, "dir");

  const transactionName = "2099-01-01T00-00-00-000Z-symlink-recovery";
  const transactionDirectory = join(
    fixture.rootDir,
    ".local/portfolio-style-transactions",
    transactionName,
  );
  const logicalTarget = join(fullDirectory, "photo-159.jpg");
  await mkdir(join(transactionDirectory, "before"), { recursive: true });
  await writeFile(join(transactionDirectory, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "replace-slot",
    status: "committing",
    outputs: [{
      action: "write",
      beforeKind: "missing",
      key: "full",
      target: logicalTarget,
      temporaryPath: `${logicalTarget}.tmp-style-${transactionName}`,
    }],
  }, null, 2)}\n`);

  const rejection = await fixture.store.read().then(() => null, (error) => error);
  const externalBytes = await readFile(externalSentinel, "utf8").catch((error) => `ERROR:${error.code}`);
  assert.deepEqual({
    rejected: rejection instanceof Error,
    externalBytes,
  }, {
    rejected: true,
    externalBytes: "outside sentinel stays\n",
  });
  assert.match(rejection.message, /越界|symlink|符号链接|根目录/i);
});

test("undo skips corrupt newest history and removes an unreferenced copy-on-write asset", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  await fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "undo.jpg",
  });
  const transactionRoot = join(fixture.rootDir, ".local/portfolio-style-transactions");
  const corruptHistory = join(transactionRoot, "zzzz-corrupt-history");
  await mkdir(corruptHistory);
  await writeFile(join(corruptHistory, "meta.json"), "{broken history\n");

  assert.equal(typeof fixture.store.undoSlot, "function", "undoSlot behavior is unavailable");
  const result = await fixture.store.undoSlot("ST-IN-01-01-P01");
  const after = await fixture.store.read();

  assert.equal(result.slotId, "ST-IN-01-01-P01");
  assert.equal(result.restoredAssetId, 137);
  assert.equal(result.removedAssetId, 159);
  assert.equal(after.slotById["ST-IN-01-01-P01"].assetId, 137);
  assert.equal(after.assetCount, 158);
  assert.equal(after.additions.photos.some(({ id }) => id === 159), false);
  await assert.rejects(() => stat(join(fixture.photoRoot, "full/photo-159.jpg")), { code: "ENOENT" });
  await assert.rejects(() => stat(join(fixture.photoRoot, "thumbs/photo-159.webp")), { code: "ENOENT" });
  assert.ok((await transactionMetas(fixture.rootDir)).some((meta) => meta.operation === "undo-slot" && meta.status === "committed"));
});

test("undo skips a parseable newest history entry with an incomplete prior assignment", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  await fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "undo-complete-history.jpg",
  });
  const corruptHistory = join(fixture.rootDir, ".local/portfolio-style-transactions/zzzz-incomplete-history");
  await mkdir(corruptHistory);
  await writeFile(join(corruptHistory, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "replace-slot",
    status: "committed",
    slotId: "ST-IN-01-01-P01",
    assetId: 159,
    previousAssetId: 42,
    previousAssignment: { assetId: 42 },
    previousLayoutUpdatedAt: null,
  }, null, 2)}\n`);

  const result = await fixture.store.undoSlot("ST-IN-01-01-P01");
  const after = await fixture.store.read();
  assert.equal(result.restoredAssetId, 137);
  assert.equal(after.slotById["ST-IN-01-01-P01"].assetId, 137);
});

test("an incomplete committed undo record cannot consume a valid replacement", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  await fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "undo-source.jpg",
  });
  const transactionRoot = join(fixture.rootDir, ".local/portfolio-style-transactions");
  const sourceTransaction = (await readdir(transactionRoot)).find((entry) => !entry.startsWith("zzzz"));
  assert.ok(sourceTransaction);
  const incompleteUndo = join(transactionRoot, "zzzz-incomplete-undo");
  await mkdir(incompleteUndo);
  await writeFile(join(incompleteUndo, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "undo-slot",
    status: "committed",
    createdAt: "2026-09-01T00:00:00.000Z",
    committedAt: "2026-09-01T00:00:01.000Z",
    sourceTransaction,
    slotId: "ST-IN-01-01-P01",
    assetId: 159,
    restoredAssetId: 137,
    removedAssetId: 159,
  }, null, 2)}\n`);
  const mismatchedName = "zzzz-mismatched-undo";
  const mismatchedUndo = join(transactionRoot, mismatchedName);
  await mkdir(mismatchedUndo);
  await writeFile(join(mismatchedUndo, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "undo-slot",
    status: "committed",
    createdAt: "2026-09-01T00:00:02.000Z",
    committedAt: "2026-09-01T00:00:03.000Z",
    ownerPid: process.pid,
    ownerToken: "abcdef0123456789abcdef01",
    sourceTransaction,
    slotId: "ST-IN-01-01-P01",
    assetId: 159,
    restoredAssetId: 42,
    removedAssetId: 159,
    outputs: [
      {
        key: "full",
        action: "delete",
        beforeKind: "file",
        target: join(fixture.photoRoot, "full/photo-159.jpg"),
        temporaryPath: "",
      },
      {
        key: "thumb",
        action: "delete",
        beforeKind: "file",
        target: join(fixture.photoRoot, "thumbs/photo-159.webp"),
        temporaryPath: "",
      },
      {
        key: "additions",
        action: "write",
        beforeKind: "file",
        target: fixture.additionsPath,
        temporaryPath: `${fixture.additionsPath}.tmp-style-${mismatchedName}`,
      },
      {
        key: "assignments",
        action: "write",
        beforeKind: "file",
        target: fixture.assignmentsPath,
        temporaryPath: `${fixture.assignmentsPath}.tmp-style-${mismatchedName}`,
      },
    ],
  }, null, 2)}\n`);

  const result = await fixture.store.undoSlot("ST-IN-01-01-P01");
  assert.equal(result.restoredAssetId, 137);
  assert.equal((await fixture.store.read()).slotById["ST-IN-01-01-P01"].assetId, 137);
});

test("undo never treats a legacy NB-001 through NB-158 asset as removable copy-on-write data", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const legacyFull = join(fixture.photoRoot, "full/photo-137.jpg");
  const legacyThumb = join(fixture.photoRoot, "thumbs/photo-137.webp");
  await Promise.all([
    writeFile(legacyFull, "legacy full stays\n"),
    writeFile(legacyThumb, "legacy thumb stays\n"),
  ]);
  const fakeHistory = join(fixture.rootDir, ".local/portfolio-style-transactions/zzzz-fake-legacy-history");
  await mkdir(fakeHistory, { recursive: true });
  await writeFile(join(fakeHistory, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "replace-slot",
    status: "committed",
    slotId: "ST-IN-01-01-P01",
    assetId: 137,
    previousAssetId: 51,
    previousAssignment: {
      assetId: 51,
      poseLabel: "拍摄参考 01",
      source: "seed",
      updatedAt: null,
    },
    previousLayoutUpdatedAt: null,
  }, null, 2)}\n`);

  await assert.rejects(() => fixture.store.undoSlot("ST-IN-01-01-P01"), /没有更早的可用备份/);
  assert.equal(await readFile(legacyFull, "utf8"), "legacy full stays\n");
  assert.equal(await readFile(legacyThumb, "utf8"), "legacy thumb stays\n");
});

test("undo preserves a new asset while another stable slot still references it", { timeout: 30_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  await fixture.store.replaceSlot({
    slotId: "ST-IN-01-01-P01",
    inputPath: fixture.validPhoto,
    originalName: "shared-after-upload.jpg",
  });
  const assignments = JSON.parse(await readFile(fixture.assignmentsPath, "utf8"));
  assignments.assignments["ST-IN-01-02"].slots[0] = {
    ...assignments.assignments["ST-IN-01-02"].slots[0],
    assetId: 159,
    source: "upload",
    updatedAt: new Date().toISOString(),
  };
  await writeFile(fixture.assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`);

  assert.equal(typeof fixture.store.undoSlot, "function", "undoSlot behavior is unavailable");
  const result = await fixture.store.undoSlot("ST-IN-01-01-P01");
  const after = await fixture.store.read();

  assert.equal(result.removedAssetId, null);
  assert.equal(after.slotById["ST-IN-01-01-P01"].assetId, 137);
  assert.equal(after.slotById["ST-IN-01-02-P01"].assetId, 159);
  assert.equal(after.additions.photos.some(({ id }) => id === 159), true);
  assert.equal((await stat(join(fixture.photoRoot, "full/photo-159.jpg"))).isFile(), true);
  assert.equal((await stat(join(fixture.photoRoot, "thumbs/photo-159.webp"))).isFile(), true);
});

test("layout reorders only one style and keeps source-derived reference maturity", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await fixture.store.read();
  const styleId = "ST-IN-01-01";
  const beforeAssets = before.styles.find((style) => style.id === styleId).slots.map((slot) => slot.assetId);
  const otherBefore = before.assignments.assignments["ST-IN-01-02"];
  const catalogBefore = await fileBytes(fixture.catalogPath);
  const orderedSlotIds = Array.from({ length: 9 }, (_, index) => `${styleId}-P${String(9 - index).padStart(2, "0")}`);

  assert.equal(typeof fixture.store.updateLayout, "function", "updateLayout behavior is unavailable");
  await fixture.store.updateLayout({
    styleId,
    orderedSlotIds,
    coverSlotId: `${styleId}-P09`,
    maturity: "reference",
  });
  const after = await fixture.store.read();
  const target = after.styles.find((style) => style.id === styleId);

  assert.deepEqual(target.slots.map((slot) => slot.assetId), [...beforeAssets].reverse());
  assert.equal(target.coverPosition, 1);
  assert.equal(target.maturity, "reference");
  assert.ok(!Number.isNaN(Date.parse(target.updatedAt)));
  assert.deepEqual(after.assignments.assignments["ST-IN-01-02"], otherBefore);
  assert.deepEqual(await fileBytes(fixture.catalogPath), catalogBefore);
  assert.ok((await transactionMetas(fixture.rootDir)).some((meta) => meta.operation === "update-layout" && meta.status === "committed"));
});

test("persisted reorder keeps slot identity, cover, pose, and replacement history attached", { timeout: 60_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const styleId = "ST-IN-01-01";
  const firstSlotId = `${styleId}-P01`;
  const secondSlotId = `${styleId}-P02`;
  await fixture.store.replaceSlot({
    slotId: firstSlotId,
    inputPath: fixture.validPhoto,
    originalName: "stable-identity.jpg",
  });
  await fixture.store.updateSlotMeta({ slotId: firstSlotId, poseLabel: "P01 审核姿势" });
  const before = await fixture.store.read();
  const target = before.styles.find(({ id }) => id === styleId);
  await fixture.store.updateLayout({
    styleId,
    orderedSlotIds: [secondSlotId, firstSlotId, ...target.slots.slice(2).map(({ id }) => id)],
    coverSlotId: firstSlotId,
    maturity: "updating",
  });

  const restarted = await fixture.createStore().read();
  assert.deepEqual({
    first: {
      assetId: restarted.slotById[firstSlotId].assetId,
      isCover: restarted.slotById[firstSlotId].isCover,
      poseLabel: restarted.slotById[firstSlotId].poseLabel,
      position: restarted.slotById[firstSlotId].position,
    },
    second: {
      assetId: restarted.slotById[secondSlotId].assetId,
      isCover: restarted.slotById[secondSlotId].isCover,
      position: restarted.slotById[secondSlotId].position,
    },
  }, {
    first: { assetId: 159, isCover: true, poseLabel: "P01 审核姿势", position: 2 },
    second: { assetId: 81, isCover: false, position: 1 },
  });

  const undone = await fixture.createStore().undoSlot(firstSlotId);
  assert.deepEqual(undone, { slotId: firstSlotId, restoredAssetId: 137, removedAssetId: 159 });
  const afterUndo = await fixture.createStore().read();
  assert.equal(afterUndo.slotById[firstSlotId].assetId, 137);
  assert.equal(afterUndo.slotById[firstSlotId].position, 2);
  assert.equal(afterUndo.slotById[firstSlotId].isCover, true);
});

test("manager reorder exports stable public identity so an existing pose preference keeps the same asset", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const styleId = "ST-IN-01-01";
  const selectedSlotId = `${styleId}-P01`;
  const before = await fixture.store.read();
  const beforeAssetId = before.slotById[selectedSlotId].assetId;
  const style = before.styles.find(({ id }) => id === styleId);

  await fixture.store.updateLayout({
    styleId,
    orderedSlotIds: [style.slots[1].id, style.slots[0].id, ...style.slots.slice(2).map(({ id }) => id)],
    coverSlotId: selectedSlotId,
    maturity: "reference",
  });

  const [catalog, assignments, after] = await Promise.all([
    readFile(fixture.catalogPath, "utf8").then(JSON.parse),
    readFile(fixture.assignmentsPath, "utf8").then(JSON.parse),
    fixture.createStore().read(),
  ]);
  const publicLibrary = buildStyleLibrary({ catalog, assignments, assets: after.assets });
  const storage = {
    getItem(key) {
      return key === "nanbo-selected-poses" ? JSON.stringify([selectedSlotId]) : "[]";
    },
    setItem() {},
  };
  const preferences = readStylePreferences(storage, publicLibrary);
  const selectedPublicSlot = publicLibrary.slots.find(({ id }) => preferences.slotIds.has(id));

  assert.equal(selectedPublicSlot.id, selectedSlotId);
  assert.equal(selectedPublicSlot.assetId, beforeAssetId);
  assert.equal(selectedPublicSlot.position, 2);
  assert.equal(selectedPublicSlot.isCover, true);
});

test("maturity is derived from upload sources and complete requires same-style origin plus explicit public confirmation", { timeout: 240_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const styleId = "ST-IN-01-01";
  await fixture.store.replaceSlot({
    slotId: `${styleId}-P01`,
    inputPath: fixture.validPhoto,
    originalName: "one-upload.jpg",
  });
  let state = await fixture.store.read();
  assert.equal(state.assignments.assignments[styleId].maturity, "updating");
  await assert.rejects(() => fixture.store.updateLayout({
    styleId,
    orderedSlotIds: state.styles.find(({ id }) => id === styleId).slots.map(({ id }) => id),
    coverSlotId: `${styleId}-P01`,
    maturity: "complete",
  }), /9 张|upload|完整|公开/);
  await fixture.store.undoSlot(`${styleId}-P01`);
  state = await fixture.store.read();
  assert.equal(state.assignments.assignments[styleId].maturity, "reference");

  const batchId = await stageFullBatch(fixture.store);
  await fixture.store.commitBatch({
    batchId,
    styleId,
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  });
  state = await fixture.store.read();
  const target = state.styles.find(({ id }) => id === styleId);
  assert.equal(target.maturity, "updating", "nine uploads stay updating until the operator explicitly confirms public eligibility");
  await fixture.store.updateLayout({
    styleId,
    orderedSlotIds: target.slots.map(({ id }) => id),
    coverSlotId: target.coverSlotId || `${styleId}-P01`,
    maturity: "complete",
  });
  assert.equal((await fixture.store.read()).assignments.assignments[styleId].maturity, "complete");

  const forgedStyleId = "ST-IN-01-02";
  const assignments = JSON.parse(await readFile(fixture.assignmentsPath, "utf8"));
  assignments.assignments[forgedStyleId].slots = assignments.assignments[styleId].slots.map((slot, index) => ({
    ...slot,
    poseLabel: assignments.assignments[forgedStyleId].slots[index].poseLabel,
  }));
  assignments.assignments[forgedStyleId].maturity = "updating";
  assignments.assignments[forgedStyleId].updatedAt = new Date().toISOString();
  await writeFile(fixture.assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`);
  state = await fixture.store.read();
  const forgedStyle = state.styles.find(({ id }) => id === forgedStyleId);
  await assert.rejects(() => fixture.store.updateLayout({
    styleId: forgedStyleId,
    orderedSlotIds: forgedStyle.slots.map(({ id }) => id),
    coverSlotId: forgedStyle.coverSlotId || `${forgedStyleId}-P01`,
    maturity: "complete",
  }), /本风格|来源|origin|创建/);
});

test("style metadata changes only reviewed public fields and accepts hidden visibility", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await fixture.store.read();
  const styleId = "ST-IN-01-01";
  const styleBefore = before.catalog.styles.find((style) => style.id === styleId);
  const assignmentsBefore = await fileBytes(fixture.assignmentsPath);
  const additionsBefore = await fileBytes(fixture.additionsPath);

  assert.equal(typeof fixture.store.updateStyleMeta, "function", "updateStyleMeta behavior is unavailable");
  await fixture.store.updateStyleMeta({
    styleId,
    label: "职业形象升级",
    audience: "需要可信职业表达的男士",
    description: "保持真实人物状态的清晰职业肖像",
    visibility: "hidden",
  });
  const after = await fixture.store.read();
  const styleAfter = after.catalog.styles.find((style) => style.id === styleId);

  assert.deepEqual(styleAfter, {
    ...styleBefore,
    label: "职业形象升级",
    audience: "需要可信职业表达的男士",
    description: "保持真实人物状态的清晰职业肖像",
    visibility: "hidden",
  });
  assert.equal(after.counts.publishedStyles, 131);
  assert.deepEqual(await fileBytes(fixture.assignmentsPath), assignmentsBefore);
  assert.deepEqual(await fileBytes(fixture.additionsPath), additionsBefore);
  assert.ok((await transactionMetas(fixture.rootDir)).some((meta) => meta.operation === "update-style-meta" && meta.status === "committed"));
});

test("slot metadata changes only the selected stable slot pose label", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await fixture.store.read();
  const slotId = "ST-IN-01-01-P03";
  const slotBefore = before.assignments.assignments["ST-IN-01-01"].slots[2];
  const catalogBefore = await fileBytes(fixture.catalogPath);
  const additionsBefore = await fileBytes(fixture.additionsPath);

  assert.equal(typeof fixture.store.updateSlotMeta, "function", "updateSlotMeta behavior is unavailable");
  await fixture.store.updateSlotMeta({ slotId, poseLabel: "倚墙侧身站姿" });
  const after = await fixture.store.read();

  assert.deepEqual(after.assignments.assignments["ST-IN-01-01"].slots[2], {
    ...slotBefore,
    poseLabel: "倚墙侧身站姿",
  });
  assert.deepEqual(after.assignments.assignments["ST-IN-01-02"], before.assignments.assignments["ST-IN-01-02"]);
  assert.deepEqual(await fileBytes(fixture.catalogPath), catalogBefore);
  assert.deepEqual(await fileBytes(fixture.additionsPath), additionsBefore);
  assert.ok((await transactionMetas(fixture.rootDir)).some((meta) => meta.operation === "update-slot-meta" && meta.status === "committed"));
});

test("metadata and layout fields are strict and reject before starting a transaction", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await Promise.all([
    fileBytes(fixture.catalogPath),
    fileBytes(fixture.assignmentsPath),
    fileBytes(fixture.additionsPath),
  ]);
  assert.equal(typeof fixture.store.updateStyleMeta, "function", "updateStyleMeta behavior is unavailable");
  assert.equal(typeof fixture.store.updateSlotMeta, "function", "updateSlotMeta behavior is unavailable");
  assert.equal(typeof fixture.store.updateLayout, "function", "updateLayout behavior is unavailable");

  await assert.rejects(() => fixture.store.updateStyleMeta({
    styleId: "ST-IN-01-01",
    label: "职业形象",
    audience: "职业男士",
    description: "真实职业肖像",
    visibility: "published",
    familyId: "OUT-06",
  }), /不允许字段 familyId/);
  await assert.rejects(() => fixture.store.updateStyleMeta({
    styleId: "ST-IN-01-01",
    label: "职业形象",
    audience: "职业男士",
    description: "真实职业肖像",
    visibility: "archived",
  }), /可见性/);
  await assert.rejects(() => fixture.store.updateSlotMeta({
    slotId: "ST-IN-01-01-P01",
    poseLabel: "站姿",
    assetId: 999,
  }), /不允许字段 assetId/);
  await assert.rejects(() => fixture.store.updateLayout({
    styleId: "ST-IN-01-01",
    orderedSlotIds: Array(9).fill("ST-IN-01-01-P01"),
    coverSlotId: "ST-IN-01-01-P01",
    maturity: "reference",
  }), /9 个|重复|完整/);

  assert.deepEqual(await Promise.all([
    fileBytes(fixture.catalogPath),
    fileBytes(fixture.assignmentsPath),
    fileBytes(fixture.additionsPath),
  ]), before);
  assert.deepEqual(await transactionMetas(fixture.rootDir), []);
});

test("transaction recovery rejects a tampered temporary path without touching that file", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const sentinel = join(fixture.directory, "must-not-delete.txt");
  await writeFile(sentinel, "keep me\n");
  const transactionDir = join(fixture.rootDir, ".local/portfolio-style-transactions/zzzz-tampered");
  await mkdir(join(transactionDir, "before"), { recursive: true });
  await writeFile(join(transactionDir, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "update-slot-meta",
    status: "prepared",
    outputs: [{
      action: "write",
      beforeKind: "file",
      key: "assignments",
      target: fixture.assignmentsPath,
      temporaryPath: sentinel,
    }],
  }, null, 2)}\n`);

  await assert.rejects(() => fixture.store.read(), /事务|临时|越界/);
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("recovery with one missing file backup leaves every target unchanged", { timeout: 5_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await Promise.all([
    fileBytes(fixture.additionsPath),
    fileBytes(fixture.assignmentsPath),
  ]);
  const transactionName = "zzzz-missing-file-backup";
  const transactionDir = join(fixture.rootDir, ".local/portfolio-style-transactions", transactionName);
  const temporaryAdditions = `${fixture.additionsPath}.tmp-style-${transactionName}`;
  const temporaryAssignments = `${fixture.assignmentsPath}.tmp-style-${transactionName}`;
  await mkdir(join(transactionDir, "before"), { recursive: true });
  await Promise.all([
    writeFile(join(transactionDir, "before/assignments"), "backup must not install\n"),
    writeFile(temporaryAdditions, "pending additions\n"),
    writeFile(temporaryAssignments, "pending assignments\n"),
  ]);
  await writeFile(join(transactionDir, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "replace-slot",
    status: "committing",
    outputs: [
      {
        action: "write",
        beforeKind: "file",
        key: "additions",
        target: fixture.additionsPath,
        temporaryPath: temporaryAdditions,
      },
      {
        action: "write",
        beforeKind: "file",
        key: "assignments",
        target: fixture.assignmentsPath,
        temporaryPath: temporaryAssignments,
      },
    ],
  }, null, 2)}\n`);

  await assert.rejects(() => fixture.store.read(), /恢复|备份|事务|ENOENT/);
  const after = await Promise.all([
    fileBytes(fixture.additionsPath),
    fileBytes(fixture.assignmentsPath),
  ]);
  assert.deepEqual(after.map((bytes, index) => bytes.equals(before[index])), [true, true]);
});

test("recovery rejects a symlink file backup even when it resolves inside root", { timeout: 5_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const before = await fileBytes(fixture.additionsPath);
  const transactionName = "zzzz-symlink-file-backup";
  const transactionDir = join(fixture.rootDir, ".local/portfolio-style-transactions", transactionName);
  const backupSource = join(transactionDir, "backup-source.json");
  const temporaryAdditions = `${fixture.additionsPath}.tmp-style-${transactionName}`;
  await mkdir(join(transactionDir, "before"), { recursive: true });
  await Promise.all([
    writeFile(backupSource, "{\"schemaVersion\":1,\"themes\":[],\"photos\":[]}\n"),
    writeFile(temporaryAdditions, "pending additions\n"),
  ]);
  await symlink(backupSource, join(transactionDir, "before/additions"));
  await writeFile(join(transactionDir, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "replace-slot",
    status: "committing",
    outputs: [{
      action: "write",
      beforeKind: "file",
      key: "additions",
      target: fixture.additionsPath,
      temporaryPath: temporaryAdditions,
    }],
  }, null, 2)}\n`);

  const rejection = await fixture.store.read().then(() => null, (error) => error);
  assert.deepEqual({
    rejected: rejection instanceof Error,
    additionsUnchanged: (await fileBytes(fixture.additionsPath)).equals(before),
  }, {
    rejected: true,
    additionsUnchanged: true,
  });
  assert.match(rejection.message, /备份|普通文件|symlink|符号链接|事务/i);
});

test("transaction recovery cannot target a legacy photo asset", async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const legacyFull = join(fixture.photoRoot, "full/photo-137.jpg");
  await writeFile(legacyFull, "legacy recovery guard\n");
  const transactionDir = join(fixture.rootDir, ".local/portfolio-style-transactions/zzzz-legacy-target");
  await mkdir(join(transactionDir, "before"), { recursive: true });
  await writeFile(join(transactionDir, "meta.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "undo-slot",
    status: "committing",
    outputs: [{
      action: "delete",
      beforeKind: "missing",
      key: "full",
      target: legacyFull,
      temporaryPath: "",
    }],
  }, null, 2)}\n`);

  await assert.rejects(() => fixture.store.read(), /事务|资产|越界/);
  assert.equal(await readFile(legacyFull, "utf8"), "legacy recovery guard\n");
});

test("style mutation routes reject missing tokens, missing origins, and foreign origins", { timeout: 30_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const missingToken = await fetch(new URL("api/style-slots/undo?slot=ST-IN-01-01-P01", server.url), {
    method: "POST",
    headers: { origin: server.exactOrigin },
  });
  assert.equal(missingToken.status, 403);
  assert.equal((await missingToken.json()).code, "AUTH_REQUIRED");

  const missingOrigin = await fetch(new URL("api/style-slots/meta", server.url), {
    method: "POST",
    body: JSON.stringify({ slotId: "ST-IN-01-01-P01", poseLabel: "正面站姿" }),
    headers: { "content-type": "application/json", "x-nanbo-token": server.token },
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).code, "ORIGIN_FORBIDDEN");

  const foreignOrigin = await fetch(new URL("api/styles/layout", server.url), {
    method: "POST",
    body: JSON.stringify({
      styleId: "ST-IN-01-01",
      orderedSlotIds: [],
      coverSlotId: "",
      maturity: "reference",
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      "x-nanbo-token": server.token,
    },
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await foreignOrigin.json()).code, "ORIGIN_FORBIDDEN");
});

test("style library GET exposes the complete safe management view without private fields", { timeout: 30_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const response = await fetch(new URL("api/style-library", server.url));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ["counts", "families", "ok", "pendingCount", "styles", "syncStatus", "version"]);
  assert.deepEqual(payload.counts, {
    assets: 158,
    indoor: 66,
    outdoor: 66,
    publishedStyles: 132,
    slots: 1188,
    styles: 132,
  });
  assert.equal(payload.families.length, 12);
  assert.equal(payload.styles.length, 132);
  assert.equal(payload.styles.every((style) => style.slots.length === 9
    && typeof style.maturity === "string"
    && typeof style.completeEligible === "boolean"), true);
  assert.equal(payload.pendingCount, 0);
  assert.deepEqual(payload.syncStatus, {
    available: true,
    label: "待同步风格",
    message: "静态公开副本与本机风格资料一致",
  });
  assert.match(payload.version, /^style-[0-9a-f]{12}$/);

  const forbiddenKeys = new Set([
    "approvedForPublicUse",
    "authorization",
    "backupDir",
    "full",
    "fullUrl",
    "inputPath",
    "log",
    "originalName",
    "path",
    "thumb",
    "thumbUrl",
    "token",
    "transactionDir",
  ]);
  const exposedKeys = allObjectKeys(payload);
  assert.deepEqual([...forbiddenKeys].filter((key) => exposedKeys.has(key)), []);
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(server.sandbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(payload), /\/Users\/|portfolio-style-transactions|selectedName/);
});

test("pendingCount tracks changed styles against static copies and returns to zero after export", { timeout: 30_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const originalCatalog = JSON.parse(await readFile(server.catalogPath, "utf8"));
  const originalAssignments = JSON.parse(await readFile(server.assignmentsPath, "utf8"));
  const getLibrary = async () => (await (await fetch(new URL("api/style-library", server.url))).json());
  const writeSource = async ({ catalog = originalCatalog, assignments = originalAssignments } = {}) => {
    await Promise.all([
      writeFile(server.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
      writeFile(server.assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
    ]);
  };

  const cases = [
    ["metadata", ({ catalog }) => { catalog.styles[0].label = "待同步职业形象"; }],
    ["visibility", ({ catalog }) => { catalog.styles[0].visibility = "hidden"; }],
    ["layout and cover", ({ assignments }) => {
      const layout = assignments.assignments["ST-IN-01-01"];
      layout.slots.reverse();
      layout.coverPosition = 1;
    }],
    ["pose", ({ assignments }) => {
      assignments.assignments["ST-IN-01-01"].slots[0].poseLabel = "待同步正面站姿";
    }],
    ["source", ({ assignments }) => {
      const slot = assignments.assignments["ST-IN-01-01"].slots[0];
      slot.source = "upload";
      slot.updatedAt = "2026-09-02T00:00:00.000Z";
    }],
    ["asset", ({ assignments }) => {
      const slots = assignments.assignments["ST-IN-01-01"].slots;
      [slots[0].assetId, slots[1].assetId] = [slots[1].assetId, slots[0].assetId];
    }],
  ];

  for (const [label, mutate] of cases) {
    const catalog = structuredClone(originalCatalog);
    const assignments = structuredClone(originalAssignments);
    mutate({ catalog, assignments });
    await writeSource({ catalog, assignments });
    const payload = await getLibrary();
    assert.equal(payload.pendingCount, 1, label);
    assert.equal(payload.syncStatus.available, true, label);
  }

  const exportedAssignments = structuredClone(originalAssignments);
  exportedAssignments.assignments["ST-IN-01-01"].slots[0] = {
    ...exportedAssignments.assignments["ST-IN-01-01"].slots[0],
    source: "upload",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
  await writeSource({ assignments: exportedAssignments });
  await writeFile(server.publishedAssignmentsPath, `${JSON.stringify(exportedAssignments, null, 2)}\n`);
  const afterExport = await getLibrary();
  assert.equal(afterExport.pendingCount, 0, "upload-backed slots are not pending after static export");
  assert.equal(afterExport.syncStatus.available, true);
});

test("missing or invalid static style copies never report a false zero", { timeout: 30_000 }, async (t) => {
  const server = await startManagerFixture(t);
  await rm(server.publishedCatalogPath);
  let payload = await (await fetch(new URL("api/style-library", server.url))).json();
  assert.equal(payload.pendingCount, 132);
  assert.deepEqual(payload.syncStatus, {
    available: false,
    label: "待同步风格",
    message: "静态公开副本缺失或无法校验，请重新导出",
  });

  await writeFile(server.publishedCatalogPath, "{invalid\n");
  payload = await (await fetch(new URL("api/style-library", server.url))).json();
  assert.equal(payload.pendingCount, 132);
  assert.equal(payload.syncStatus.available, false);
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(server.sandbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("asset reference lookup returns every affected style and stable slot", { timeout: 30_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const assignments = JSON.parse(await readFile(server.assignmentsPath, "utf8"));
  const expectedSlotIds = [];
  const expectedStyleIds = [];
  for (const [styleId, layout] of Object.entries(assignments.assignments)) {
    layout.slots.forEach((slot, index) => {
      if (slot.assetId !== 137) return;
      expectedSlotIds.push(`${styleId}-P${String(index + 1).padStart(2, "0")}`);
      expectedStyleIds.push(styleId);
    });
  }

  const response = await fetch(new URL("api/assets/references?id=137", server.url));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.assetId, 137);
  assert.deepEqual(payload.slotIds, expectedSlotIds);
  assert.deepEqual(payload.styleIds, [...new Set(expectedStyleIds)]);
  assert.equal(payload.count, expectedSlotIds.length);
  assert.ok(payload.count > 1);
  assert.equal(payload.slotIds.every((slotId) => /^ST-(IN|OUT)-/.test(slotId)), true);
});

test("style API rejects ambiguous IDs and JSON fields with stable error codes", { timeout: 30_000 }, async (t) => {
  const server = await startManagerFixture(t);
  for (const query of ["id=0137", "id=1e2", "id=137&id=138", "assetId=137"]) {
    const response = await fetch(new URL(`api/assets/references?${query}`, server.url));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).code, "INVALID_ASSET_ID", query);
  }
  const missingAsset = await fetch(new URL("api/assets/references?id=9999", server.url));
  assert.equal(missingAsset.status, 404);
  assert.equal((await missingAsset.json()).code, "ASSET_NOT_FOUND");

  const invalidSlot = await server.postJson("api/style-slots/meta", {
    slotId: "ST-IN-1-1-P1",
    poseLabel: "正面站姿",
  });
  assert.equal(invalidSlot.status, 400);
  assert.equal((await invalidSlot.json()).code, "INVALID_SLOT_ID");

  const extraField = await server.postJson("api/styles/meta", {
    styleId: "ST-IN-01-01",
    label: "职业形象",
    audience: "职场男士",
    description: "干净利落",
    visibility: "published",
    localPath: "/tmp/private.jpg",
  });
  assert.equal(extraField.status, 400);
  const extraFieldPayload = await extraField.json();
  assert.equal(extraFieldPayload.code, "STYLE_VALIDATION_FAILED");
  assert.doesNotMatch(JSON.stringify(extraFieldPayload), /Error:|\bat\s+.*\.mjs:/);
});

test("style mutation endpoints update only the isolated manifests and preserve copy-on-write references", { timeout: 60_000 }, async (t) => {
  const productionCatalogPath = new URL("../apps/portfolio-v2/style-catalog.json", import.meta.url);
  const productionAssignmentsPath = new URL("../apps/portfolio-v2/style-slot-assignments.json", import.meta.url);
  const productionBefore = await Promise.all([
    readFile(productionCatalogPath),
    readFile(productionAssignmentsPath),
  ]);
  const server = await startManagerFixture(t);
  const initialLibrary = await (await fetch(new URL("api/style-library", server.url))).json();
  const initialStyle = initialLibrary.styles.find(({ id }) => id === "ST-IN-01-01");

  const slotMeta = await server.postJson("api/style-slots/meta", {
    slotId: "ST-IN-01-01-P01",
    poseLabel: "正面站姿",
  });
  assert.equal(slotMeta.status, 200);
  assert.deepEqual((await slotMeta.json()).result, { slotId: "ST-IN-01-01-P01", poseLabel: "正面站姿" });

  const styleMeta = await server.postJson("api/styles/meta", {
    styleId: "ST-IN-01-01",
    label: "职业形象测试",
    audience: "需要正式头像的男士",
    description: "以稳定目光呈现清晰职业状态",
    visibility: "hidden",
  });
  assert.equal(styleMeta.status, 200);
  assert.equal((await styleMeta.json()).result.visibility, "hidden");

  const orderedSlotIds = initialStyle.slots.map(({ id }) => id).reverse();
  const layout = await server.postJson("api/styles/layout", {
    styleId: initialStyle.id,
    orderedSlotIds,
    coverSlotId: orderedSlotIds[0],
    maturity: "reference",
  });
  assert.equal(layout.status, 200);
  assert.deepEqual((await layout.json()).result, {
    styleId: initialStyle.id,
    coverPosition: 1,
    maturity: "reference",
  });

  const image = await readFile(validPhoto);
  const replacement = await fetch(new URL("api/style-slots/replace?slot=ST-IN-01-01-P01", server.url), {
    method: "POST",
    body: image,
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": encodeURIComponent("/Users/customer/private/客户王先生.jpg"),
      "x-nanbo-token": server.token,
    },
  });
  assert.equal(replacement.status, 200);
  const replacementPayload = await replacement.json();
  assert.deepEqual(replacementPayload.result, {
    assetId: 159,
    code: "NB-159",
    slotId: "ST-IN-01-01-P01",
  });
  assert.doesNotMatch(JSON.stringify(replacementPayload), /\/Users\/customer|originalName|private/);

  const references = await (await fetch(new URL("api/assets/references?id=159", server.url))).json();
  assert.deepEqual(references, {
    assetId: 159,
    slotIds: ["ST-IN-01-01-P01"],
    styleIds: ["ST-IN-01-01"],
    count: 1,
  });
  const undo = await server.postJson("api/style-slots/undo?slot=ST-IN-01-01-P01", null, {
    "x-nanbo-operation-id": "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(undo.status, 200);
  assert.equal(
    (await undo.json()).result.restoredAssetId,
    initialStyle.slots.find(({ id }) => id === "ST-IN-01-01-P01").assetId,
  );

  const after = await (await fetch(new URL("api/style-library", server.url))).json();
  const updatedStyle = after.styles.find(({ id }) => id === initialStyle.id);
  assert.equal(updatedStyle.label, "职业形象测试");
  assert.equal(updatedStyle.visibility, "hidden");
  assert.equal(updatedStyle.maturity, "reference");
  assert.equal(updatedStyle.slots[0].poseLabel, initialStyle.slots.at(-1).poseLabel);
  assert.deepEqual(await Promise.all([
    readFile(productionCatalogPath),
    readFile(productionAssignmentsPath),
  ]), productionBefore);
});

test("raw style uploads enforce Content-Length, clean temporary files, and release the shared busy lock after abort", { timeout: 60_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const oversized = await responseFromNodeRequest({
    headers: {
      "content-length": String((50 * 1024 * 1024) + 1),
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "oversized.jpg",
      "x-nanbo-token": server.token,
    },
    method: "POST",
    path: "/api/style-slots/replace?slot=ST-IN-01-01-P01",
    host: "127.0.0.1",
    port: Number(new URL(server.url).port),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.code, "PAYLOAD_TOO_LARGE");

  const uploadsBefore = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("nanbo-upload-")));
  const invalidImage = await fetch(new URL("api/style-slots/replace?slot=ST-IN-01-01-P01", server.url), {
    method: "POST",
    body: "not an image",
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "invalid.jpg",
      "x-nanbo-token": server.token,
    },
  });
  assert.notEqual(invalidImage.status, 200);
  const uploadsAfter = (await readdir(tmpdir())).filter((name) => name.startsWith("nanbo-upload-") && !uploadsBefore.has(name));
  assert.deepEqual(uploadsAfter, []);

  const slowRequest = connect(Number(new URL(server.url).port), "127.0.0.1");
  const slowClosed = once(slowRequest, "close");
  await once(slowRequest, "connect");
  slowRequest.write([
    "POST /api/style-slots/replace?slot=ST-IN-01-01-P01 HTTP/1.1",
    `Host: 127.0.0.1:${new URL(server.url).port}`,
    `Origin: ${server.exactOrigin}`,
    `X-Nanbo-Token: ${server.token}`,
    "X-File-Name: aborted.jpg",
    "Content-Type: image/jpeg",
    "Content-Length: 1024",
    "Connection: close",
    "",
    "abc",
  ].join("\r\n"));
  let busy;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    busy = await server.postJson("api/style-slots/meta", {
      slotId: "ST-IN-01-01-P01",
      poseLabel: "忙锁测试",
    });
    if (busy.status === 409) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(busy.status, 409);
  assert.deepEqual(await busy.json(), {
    ok: false,
    code: "MUTATION_BUSY",
    error: "管理台正在执行其他修改，请稍后重试",
  });
  const publishBusy = await fetch(new URL("api/publish", server.url), {
    method: "POST",
    headers: { origin: server.exactOrigin, "x-nanbo-token": server.token },
  });
  assert.equal(publishBusy.status, 409);
  assert.equal((await publishBusy.json()).code, "MUTATION_BUSY");
  slowRequest.destroy();
  await slowClosed;

  let afterAbort;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    afterAbort = await server.postJson("api/style-slots/meta", {
      slotId: "ST-IN-01-01-P01",
      poseLabel: "中断后可继续",
    });
    if (afterAbort.status !== 409) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(afterAbort.status, 200);
});

test("single-slot replacement replays a dropped committed response without allocating another asset", { timeout: 90_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const operationId = "11111111-1111-4111-8111-111111111111";
  const image = await readFile(validPhoto);
  const request = (body = image, overrides = {}) => fetch(new URL("api/style-slots/replace?slot=ST-IN-01-01-P01", server.url), {
    method: "POST",
    body,
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "ambiguous-single.jpg",
      "x-nanbo-operation-id": operationId,
      "x-nanbo-token": server.token,
      ...overrides,
    },
  });

  const committedButDropped = await request();
  assert.equal(committedButDropped.status, 200);
  await committedButDropped.arrayBuffer();

  const replay = await request();
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).result, {
    assetId: 159,
    code: "NB-159",
    slotId: "ST-IN-01-01-P01",
  });
  const state = await (await fetch(new URL("api/style-library", server.url))).json();
  assert.equal(state.counts.assets, 159);
  assert.equal(state.styles.find(({ id }) => id === "ST-IN-01-01").slots.find(({ id }) => id === "ST-IN-01-01-P01").assetId, 159);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "replace-slot").length, 1);

  const mismatchedFile = await request(await readFile(newerValidPhoto));
  assert.equal(mismatchedFile.status, 400);
  assert.match((await mismatchedFile.json()).error, /operation|操作编号|重试内容|不一致/i);

  const missingToken = await request(image, { "x-nanbo-token": "" });
  assert.equal(missingToken.status, 403);
  const foreignOrigin = await request(image, { origin: "https://evil.example" });
  assert.equal(foreignOrigin.status, 403);
});

test("single-slot committed replay rejects stale success after a later replacement", { timeout: 90_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const request = (body, operationId, name) => fetch(new URL("api/style-slots/replace?slot=ST-IN-01-01-P01", server.url), {
    method: "POST",
    body,
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": name,
      "x-nanbo-operation-id": operationId,
      "x-nanbo-token": server.token,
    },
  });
  const imageA = await readFile(validPhoto);
  const imageB = await readFile(newerValidPhoto);
  const operationA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const operationB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  assert.equal((await request(imageA, operationA, "A.jpg")).status, 200);
  assert.equal((await request(imageB, operationB, "B.jpg")).status, 200);

  const staleReplay = await request(imageA, operationA, "A.jpg");
  assert.equal(staleReplay.status, 400);
  assert.match((await staleReplay.json()).error, /操作编号|重试内容|当前|不一致/);
  const state = await (await fetch(new URL("api/style-library", server.url))).json();
  assert.equal(state.styles.find(({ id }) => id === "ST-IN-01-01").slots.find(({ id }) => id === "ST-IN-01-01-P01").assetId, 160);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "replace-slot").length, 2);
});

test("style-slot undo replays one committed transition for an exact operation retry", { timeout: 90_000 }, async (t) => {
  const fixture = await createStyleStoreFixture(t);
  const slotId = "ST-IN-01-01-P01";
  await fixture.store.replaceSlot({
    slotId,
    inputPath: fixture.validPhoto,
    originalName: "undo-idempotent.jpg",
  });
  const operationId = "44444444-4444-4444-8444-444444444444";

  const first = await fixture.store.undoSlot({ slotId, operationId });
  const replay = await fixture.createStore().undoSlot({ slotId, operationId });

  assert.deepEqual(replay, first);
  assert.equal((await fixture.store.read()).slotById[slotId].assetId, 137);
  assert.equal((await transactionMetas(fixture.rootDir)).filter(({ operation }) => operation === "undo-slot").length, 1);
  await assert.rejects(
    () => fixture.store.undoSlot({ slotId: "ST-IN-01-02-P01", operationId }),
    /操作编号|重试内容|不一致/,
  );
});

test("style-slot undo API replays a dropped committed response without consuming older history", { timeout: 90_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const image = await readFile(validPhoto);
  const slotId = "ST-IN-01-01-P01";
  const replace = await fetch(new URL(`api/style-slots/replace?slot=${slotId}`, server.url), {
    method: "POST",
    body: image,
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "undo-api.jpg",
      "x-nanbo-operation-id": "55555555-5555-4555-8555-555555555555",
      "x-nanbo-token": server.token,
    },
  });
  assert.equal(replace.status, 200);
  const operationId = "66666666-6666-4666-8666-666666666666";
  const request = (slot = slotId) => fetch(new URL(`api/style-slots/undo?slot=${slot}`, server.url), {
    method: "POST",
    headers: {
      origin: server.exactOrigin,
      "x-nanbo-operation-id": operationId,
      "x-nanbo-token": server.token,
    },
  });

  const first = await request();
  assert.equal(first.status, 200);
  const firstResult = (await first.json()).result;
  const replay = await request();
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).result, firstResult);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "undo-slot").length, 1);

  const mismatch = await request("ST-IN-01-02-P01");
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /操作编号|重试内容|不一致/);
});

test("style manager retries a dropped undo response with one operation id", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const slotId = "ST-IN-01-01-P01";
  const replace = await fetch(new URL(`api/style-slots/replace?slot=${slotId}`, server.url), {
    method: "POST",
    body: await readFile(validPhoto),
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "undo-browser.jpg",
      "x-nanbo-operation-id": "77777777-7777-4777-8777-777777777777",
      "x-nanbo-token": server.token,
    },
  });
  assert.equal(replace.status, 200);

  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const input = document.querySelector('input[name="library-mode"][value="styles"]');
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor(`document.querySelector('[data-style-slot-id="${slotId}"] [data-asset-code="NB-159"]')`);
  await browser.evaluate(`(() => {
    window.__styleUndoOperationIds = [];
    window.__dropStyleUndoResponse = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      const isUndo = (init.method || "GET") === "POST" && String(url).includes("/api/style-slots/undo");
      if (isUndo) window.__styleUndoOperationIds.push(new Headers(init.headers).get("x-nanbo-operation-id"));
      const response = await nativeFetch(input, init);
      if (isUndo && response.ok && window.__dropStyleUndoResponse) {
        window.__dropStyleUndoResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟风格撤销响应丢失");
      }
      return response;
    };
    document.querySelector('[data-style-slot-id="${slotId}"] .style-slot-undo').click();
  })()`);
  await browser.waitFor('document.querySelector("#toast")?.textContent.length > 0');
  const firstOperationId = await browser.evaluate("window.__styleUndoOperationIds[0]");
  assert.match(firstOperationId || "", /^[0-9a-f-]{36}$/);
  await browser.evaluate(`document.querySelector('[data-style-slot-id="${slotId}"] .style-slot-undo').click()`);
  await browser.waitFor(`document.querySelector('[data-style-slot-id="${slotId}"] [data-asset-code="NB-137"]')`, 30_000);
  const operationIds = await browser.evaluate("[...window.__styleUndoOperationIds]");
  assert.equal(operationIds.length, 2);
  assert.equal(operationIds[1], operationIds[0]);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "undo-slot").length, 1);
});

test("global replace and undo APIs replay committed results only after auth and exact-origin checks", { timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const image = await readFile(validPhoto);
  const replaceOperationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const replaceRequest = (body = image, headers = {}) => fetch(new URL("api/replace?id=158", server.url), {
    method: "POST",
    body,
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "global-api.jpg",
      "x-nanbo-operation-id": replaceOperationId,
      "x-nanbo-token": server.token,
      ...headers,
    },
  });

  const first = await replaceRequest();
  assert.equal(first.status, 200);
  const firstResult = (await first.json()).result;
  assert.equal((await replaceRequest(image, { "x-nanbo-token": "" })).status, 403);
  assert.equal((await replaceRequest(image, { origin: "http://localhost.invalid" })).status, 403);
  const replay = await replaceRequest();
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).result, firstResult);
  assert.equal((await readdir(join(server.sandbox, ".local/portfolio-photo-backups/photo-158"))).length, 1);
  const mismatchedReplace = await replaceRequest(await readFile(newerValidPhoto));
  assert.equal(mismatchedReplace.status, 400);
  assert.match((await mismatchedReplace.json()).error, /操作编号|重试内容|不一致/);

  const undoOperationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const undoRequest = (id = 158, headers = {}) => fetch(new URL(`api/undo?id=${id}`, server.url), {
    method: "POST",
    headers: {
      origin: server.exactOrigin,
      "x-nanbo-operation-id": undoOperationId,
      "x-nanbo-token": server.token,
      ...headers,
    },
  });
  const undone = await undoRequest();
  assert.equal(undone.status, 200);
  const undoneResult = (await undone.json()).result;
  assert.equal((await undoRequest(158, { "x-nanbo-token": "" })).status, 403);
  assert.equal((await undoRequest(158, { origin: "http://localhost.invalid" })).status, 403);
  const undoReplay = await undoRequest();
  assert.equal(undoReplay.status, 200);
  assert.deepEqual((await undoReplay.json()).result, undoneResult);
  const mismatchedUndo = await undoRequest(157);
  assert.equal(mismatchedUndo.status, 400);
  assert.match((await mismatchedUndo.json()).error, /操作编号|重试内容|不一致/);
});

test("legacy manager retries dropped global replace and undo responses without a second transition", { skip: !hasChrome, timeout: 180_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const targetPaths = {
    full: join(server.photoRoot, "full/photo-158.jpg"),
    thumb: join(server.photoRoot, "thumbs/photo-158.webp"),
  };
  const original = await Promise.all([readFile(targetPaths.full), readFile(targetPaths.thumb)]);
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    window.confirm = () => true;
    window.__globalReplaceOperationIds = [];
    window.__globalUndoOperationIds = [];
    window.__dropGlobalReplaceResponse = true;
    window.__dropGlobalUndoResponse = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init.method || "GET";
      const headers = new Headers(init.headers);
      const isReplace = method === "POST" && String(url).includes("/api/replace?id=158");
      const isUndo = method === "POST" && String(url).includes("/api/undo?id=158");
      if (isReplace) window.__globalReplaceOperationIds.push(headers.get("x-nanbo-operation-id"));
      if (isUndo) window.__globalUndoOperationIds.push(headers.get("x-nanbo-operation-id"));
      const response = await nativeFetch(input, init);
      if (isReplace && response.ok && window.__dropGlobalReplaceResponse) {
        window.__dropGlobalReplaceResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟全局替换响应丢失");
      }
      if (isUndo && response.ok && window.__dropGlobalUndoResponse) {
        window.__dropGlobalUndoResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟全局撤销响应丢失");
      }
      return response;
    };
    document.querySelector('[data-id="158"]').click();
  })()`);
  await browser.waitFor('document.querySelector("#photo-dialog")?.open');
  await browser.setFileInput("#photo-file", validPhoto);
  await browser.waitFor('document.querySelector("#replace-button")?.disabled === false');
  await browser.evaluate('document.querySelector("#replace-button").click()');
  await browser.waitFor('document.querySelector("#global-reference-dialog")?.open');
  await browser.evaluate(`(() => {
    document.querySelector("#global-replace-all-start").click();
    document.querySelector("#global-replace-all-final").click();
  })()`);
  await browser.waitFor("window.__globalReplaceOperationIds.length === 1", 30_000);
  const firstReplaceOperationId = await browser.evaluate("window.__globalReplaceOperationIds[0]");
  assert.match(firstReplaceOperationId || "", /^[0-9a-f-]{36}$/);
  await browser.waitFor('document.querySelector("#file-feedback")?.textContent.includes("模拟全局替换响应丢失")', 30_000);

  await browser.evaluate('document.querySelector("#replace-button").click()');
  await browser.waitFor('document.querySelector("#global-reference-dialog")?.open');
  await browser.evaluate(`(() => {
    document.querySelector("#global-replace-all-start").click();
    document.querySelector("#global-replace-all-final").click();
  })()`);
  await browser.waitFor('document.querySelector("#photo-dialog")?.open === false', 30_000);
  const replaceOperationIds = await browser.evaluate("[...window.__globalReplaceOperationIds]");
  assert.equal(replaceOperationIds.length, 2);
  assert.equal(replaceOperationIds[1], replaceOperationIds[0]);
  assert.equal((await readdir(join(server.sandbox, ".local/portfolio-photo-backups/photo-158"))).length, 1);

  await browser.evaluate('document.querySelector(\'[data-id="158"]\').click()');
  await browser.waitFor('document.querySelector("#photo-dialog")?.open');
  await browser.evaluate('document.querySelector("#undo-button").click()');
  await browser.waitFor("window.__globalUndoOperationIds.length === 1", 30_000);
  const firstUndoOperationId = await browser.evaluate("window.__globalUndoOperationIds[0]");
  assert.match(firstUndoOperationId || "", /^[0-9a-f-]{36}$/);
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("模拟全局撤销响应丢失")', 30_000);
  await browser.evaluate('document.querySelector("#undo-button").click()');
  await browser.waitFor('document.querySelector("#photo-dialog")?.open === false', 30_000);
  const undoOperationIds = await browser.evaluate("[...window.__globalUndoOperationIds]");
  assert.equal(undoOperationIds.length, 2);
  assert.equal(undoOperationIds[1], undoOperationIds[0]);
  assert.deepEqual(await Promise.all([readFile(targetPaths.full), readFile(targetPaths.thumb)]), original);
});

test("batch position staging replays a dropped response only for the exact same file", { timeout: 90_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const created = await server.postJson("api/style-batches", null);
  const { batchId } = (await created.json()).result;
  const operationId = "22222222-2222-4222-8222-222222222222";
  const stage = (body) => fetch(new URL(`api/style-batches/${batchId}/files/1`, server.url), {
    method: "PUT",
    body,
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "ambiguous-stage.jpg",
      "x-nanbo-operation-id": operationId,
      "x-nanbo-token": server.token,
    },
  });

  const image = await readFile(validPhoto);
  const committedButDropped = await stage(image);
  assert.equal(committedButDropped.status, 200);
  await committedButDropped.arrayBuffer();

  const replay = await stage(image);
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).result, { batchId, position: 1 });

  const mismatchedFile = await stage(await readFile(newerValidPhoto));
  assert.equal(mismatchedFile.status, 400);
  assert.match((await mismatchedFile.json()).error, /operation|操作编号|重试内容|不一致/i);
});

test("batch commit replays a dropped committed response and leaves the authoritative batch state complete", { timeout: 180_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const created = await server.postJson("api/style-batches", null);
  const { batchId } = (await created.json()).result;
  const image = await readFile(validPhoto);
  for (let position = 1; position <= 9; position += 1) {
    const staged = await fetch(new URL(`api/style-batches/${batchId}/files/${position}`, server.url), {
      method: "PUT",
      body: image,
      headers: {
        "content-type": "image/jpeg",
        origin: server.exactOrigin,
        "x-file-name": `commit-${position}.jpg`,
        "x-nanbo-token": server.token,
      },
    });
    assert.equal(staged.status, 200, `position ${position}`);
  }
  const operationId = "33333333-3333-4333-8333-333333333333";
  const payload = {
    styleId: "ST-IN-01-01",
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
  const commit = () => server.postJson(`api/style-batches/${batchId}/commit`, payload, {
    "x-nanbo-operation-id": operationId,
  });

  const committedButDropped = await commit();
  assert.equal(committedButDropped.status, 200);
  await committedButDropped.arrayBuffer();

  const replay = await commit();
  assert.equal(replay.status, 200);
  const replayedResult = (await replay.json()).result;
  assert.deepEqual(replayedResult, {
    batchId,
    styleId: "ST-IN-01-01",
    assetIds: [159, 160, 161, 162, 163, 164, 165, 166, 167],
  });
  const state = await (await fetch(new URL("api/style-library", server.url))).json();
  assert.deepEqual(
    state.styles.find(({ id }) => id === "ST-IN-01-01").slots.map(({ assetId }) => assetId),
    replayedResult.assetIds,
  );
  assert.equal(state.counts.assets, 167);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "replace-style-batch").length, 1);
});

test("single-slot manager retries a dropped committed response with the same operation id", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__ambiguousSingleOperations = [];
    window.__dropSingleResponse = true;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      const isReplacement = (init.method || "GET") === "POST" && String(url).includes("/api/style-slots/replace");
      if (isReplacement) {
        window.__ambiguousSingleOperations.push(new Headers(init.headers).get("x-nanbo-operation-id"));
      }
      const response = await nativeFetch(input, init);
      if (isReplacement && response.ok && window.__dropSingleResponse) {
        window.__dropSingleResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟单张响应丢失");
      }
      return response;
    };
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-replace").click()');
  await browser.waitFor('document.querySelector("#style-slot-replace-dialog")?.open');
  await browser.setFileInput("#style-slot-file", validPhoto);
  await browser.waitFor('document.querySelector("#style-slot-confirm")?.disabled === false');
  await browser.evaluate('document.querySelector("#style-slot-confirm").click()');
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("模拟单张响应丢失")', 30_000);
  assert.equal(await browser.evaluate('document.querySelector("#style-slot-replace-dialog")?.open'), true);

  await browser.evaluate('document.querySelector("#style-slot-confirm").click()');
  await browser.waitFor('document.querySelector("#style-slot-replace-dialog")?.open === false', 30_000);
  const result = await browser.evaluate(`(() => ({
    assetCode: document.querySelector('[data-style-slot-id="ST-IN-01-01-P01"] [data-asset-code]')?.dataset.assetCode,
    operationIds: [...window.__ambiguousSingleOperations],
  }))()`);
  assert.equal(result.assetCode, "NB-159");
  assert.equal(result.operationIds.length, 2);
  assert.match(result.operationIds[0] || "", /^[0-9a-f-]{36}$/);
  assert.equal(result.operationIds[1], result.operationIds[0]);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "replace-slot").length, 1);
});

test("external single-slot attempts do not reuse identity for equal file metadata or after another success", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  const result = await browser.evaluate(`(async () => {
    const nativeFetch = window.fetch.bind(window);
    const library = await (await nativeFetch("/api/style-library")).json();
    const root = document.querySelector("#style-library-view").cloneNode(true);
    root.id = "style-library-idempotency-probe";
    root.hidden = true;
    document.body.append(root);
    const operations = [];
    const committed = new Map();
    let authoritative = "seed";
    let dropFirstA = true;
    const requestJson = async (path, options = {}) => {
      if (path === "/api/style-library") return library;
      if (String(path).startsWith("/api/assets/references")) return { slotIds: [] };
      if (!String(path).startsWith("/api/style-slots/replace")) return { ok: true };
      const operationId = new Headers(options.headers).get("x-nanbo-operation-id");
      const tag = options.body.__testTag;
      operations.push({ operationId, tag });
      if (committed.has(operationId)) {
        if (committed.get(operationId) !== tag) throw new Error("same operation id used for different bytes");
        if (authoritative !== tag) throw new Error("stale committed replay did not apply over current state");
        return { ok: true };
      }
      committed.set(operationId, tag);
      authoritative = tag;
      if (tag === "A" && dropFirstA) {
        dropFirstA = false;
        throw new TypeError("simulated dropped A response");
      }
      return { ok: true };
    };
    const { createStyleMode } = await import("/style-mode.js");
    const mode = createStyleMode({ root, requestJson, showToast() {}, openPreview() {} });
    const fileOptions = { type: "image/jpeg", lastModified: 1_725_000_000_000 };
    const fileA = new File([new Uint8Array([1, 2, 3, 4])], "same.jpg", fileOptions);
    const fileB = new File([new Uint8Array([4, 3, 2, 1])], "same.jpg", fileOptions);
    fileA.__testTag = "A";
    fileB.__testTag = "B";
    const errors = [];
    for (const file of [fileA, fileB, fileA]) {
      try {
        await mode.replaceSlot("ST-IN-01-01-P01", file);
        errors.push("");
      } catch (error) {
        errors.push(error.message);
      }
    }
    root.remove();
    return { authoritative, errors, operations };
  })()`);

  assert.match(result.errors[0], /dropped A/);
  assert.equal(result.errors[1], "");
  assert.equal(result.errors[2], "");
  assert.equal(result.authoritative, "A");
  assert.deepEqual(result.operations.map(({ tag }) => tag), ["A", "B", "A"]);
  assert.equal(new Set(result.operations.map(({ operationId }) => operationId)).size, 3);
});

test("batch manager retries dropped stage and commit responses with stable operation ids", { skip: !hasChrome, timeout: 180_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const copies = [];
  const bytes = await readFile(validPhoto);
  for (let position = 1; position <= 9; position += 1) {
    const path = join(server.sandbox, `ambiguous-ui-${position}.jpg`);
    await writeFile(path, bytes);
    copies.push(path);
  }
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__ambiguousBatchOperations = { stage: [], commit: [] };
    window.__dropStageResponse = true;
    window.__dropCommitResponse = true;
    window.fetch = async (input, init = {}) => {
      const url = String(typeof input === "string" ? input : input.url);
      const method = init.method || "GET";
      const isStage = method === "PUT" && url.includes("/api/style-batches/") && url.endsWith("/files/1");
      const isCommit = method === "POST" && url.includes("/api/style-batches/") && url.endsWith("/commit");
      if (isStage) window.__ambiguousBatchOperations.stage.push(new Headers(init.headers).get("x-nanbo-operation-id"));
      if (isCommit) window.__ambiguousBatchOperations.commit.push(new Headers(init.headers).get("x-nanbo-operation-id"));
      const response = await nativeFetch(input, init);
      if (isStage && response.ok && window.__dropStageResponse) {
        window.__dropStageResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟暂存响应丢失");
      }
      if (isCommit && response.ok && window.__dropCommitResponse) {
        window.__dropCommitResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟提交响应丢失");
      }
      return response;
    };
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("#style-batch-open").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open');
  await browser.setFileInput("#style-batch-files", copies);
  await browser.waitFor('document.querySelector("[data-batch-position=\\"1\\"]")?.dataset.batchStatus === "error"', 30_000);
  await browser.waitFor('document.querySelector("[data-batch-position=\\"9\\"]")?.dataset.batchStatus === "ready"', 30_000);
  await browser.setFileInput('[data-batch-position="1"] .style-batch-retry input', copies[0]);
  await browser.waitFor('window.__ambiguousBatchOperations.stage.length === 2', 30_000);
  const stageOperations = await browser.evaluate('[...window.__ambiguousBatchOperations.stage]');
  assert.match(stageOperations[0] || "", /^[0-9a-f-]{36}$/);
  assert.equal(stageOperations[1], stageOperations[0]);
  await browser.waitFor('document.querySelector("#style-batch-commit")?.disabled === false', 30_000);

  await browser.evaluate('document.querySelector("#style-batch-commit").click()');
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("模拟提交响应丢失")', 30_000);
  assert.equal(await browser.evaluate('document.querySelector("#style-batch-dialog")?.open'), true);
  await browser.evaluate('document.querySelector("#style-batch-commit").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open === false', 30_000);
  const commitOperations = await browser.evaluate('[...window.__ambiguousBatchOperations.commit]');
  assert.equal(commitOperations.length, 2);
  assert.match(commitOperations[0] || "", /^[0-9a-f-]{36}$/);
  assert.equal(commitOperations[1], commitOperations[0]);
  const state = await (await fetch(new URL("api/style-library", server.url))).json();
  assert.equal(state.counts.assets, 167);
  assert.equal((await transactionMetas(server.sandbox)).filter(({ operation }) => operation === "replace-style-batch").length, 1);
});

test("batch API requires token and exact origin for POST, PUT, and DELETE and keeps partial staging private", { timeout: 180_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const fakeBatchId = "2d3e2fb5-1cd5-4ea4-a2f8-1a7461874f41";
  const missingToken = await fetch(new URL(`api/style-batches/${fakeBatchId}/files/1`, server.url), {
    method: "PUT",
    headers: { origin: server.exactOrigin },
    body: "private",
  });
  assert.equal(missingToken.status, 403);
  assert.equal((await missingToken.json()).code, "AUTH_REQUIRED");
  const foreignDelete = await fetch(new URL(`api/style-batches/${fakeBatchId}`, server.url), {
    method: "DELETE",
    headers: { origin: "https://evil.example", "x-nanbo-token": server.token },
  });
  assert.equal(foreignDelete.status, 403);
  assert.equal((await foreignDelete.json()).code, "ORIGIN_FORBIDDEN");

  const created = await server.postJson("api/style-batches", null);
  assert.equal(created.status, 200);
  const { batchId } = (await created.json()).result;
  assert.match(batchId, /^[0-9a-f-]{36}$/);
  const image = await readFile(validPhoto);
  const assignmentsBefore = await readFile(server.assignmentsPath);
  for (let position = 1; position <= 8; position += 1) {
    const staged = await fetch(new URL(`api/style-batches/${batchId}/files/${position}`, server.url), {
      method: "PUT",
      body: image,
      headers: {
        "content-type": "image/jpeg",
        origin: server.exactOrigin,
        "x-file-name": `batch-${position}.jpg`,
        "x-nanbo-token": server.token,
      },
    });
    assert.equal(staged.status, 200, `position ${position}`);
  }
  const invalid = await fetch(new URL(`api/style-batches/${batchId}/files/9`, server.url), {
    method: "PUT",
    body: await readFile(wrongRatioPhoto),
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "invalid-nine.jpg",
      "x-nanbo-token": server.token,
    },
  });
  assert.equal(invalid.status, 400);
  const ambiguous = await server.postJson(`api/style-batches/${batchId}/commit`, {
    batchId: fakeBatchId,
    styleId: "ST-IN-01-01",
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  });
  assert.equal(ambiguous.status, 400);
  assert.match((await ambiguous.json()).error, /不允许字段 batchId/);
  const incomplete = await server.postJson(`api/style-batches/${batchId}/commit`, {
    styleId: "ST-IN-01-01",
    orderedPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  });
  assert.equal(incomplete.status, 400);
  assert.match((await incomplete.json()).error, /缺少第 9 张/);
  assert.deepEqual(await readFile(server.assignmentsPath), assignmentsBefore);

  const discarded = await fetch(new URL(`api/style-batches/${batchId}`, server.url), {
    method: "DELETE",
    headers: { origin: server.exactOrigin, "x-nanbo-token": server.token },
  });
  assert.equal(discarded.status, 200);
  assert.deepEqual((await discarded.json()).result, { batchId, discarded: true });
});

test("batch PUT enforces the body limit, releases the busy lock, and removes upload temporaries", { timeout: 60_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const created = await server.postJson("api/style-batches", null);
  const { batchId } = (await created.json()).result;
  const uploadsBefore = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("nanbo-upload-")));
  const oversized = await responseFromNodeRequest({
    headers: {
      "content-length": String((50 * 1024 * 1024) + 1),
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "oversized.jpg",
      "x-nanbo-token": server.token,
    },
    method: "PUT",
    path: `/api/style-batches/${batchId}/files/1`,
    host: "127.0.0.1",
    port: Number(new URL(server.url).port),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.code, "PAYLOAD_TOO_LARGE");

  const invalid = await fetch(new URL(`api/style-batches/${batchId}/files/1`, server.url), {
    method: "PUT",
    body: "not an image",
    headers: {
      "content-type": "image/jpeg",
      origin: server.exactOrigin,
      "x-file-name": "invalid.jpg",
      "x-nanbo-token": server.token,
    },
  });
  assert.notEqual(invalid.status, 200);
  const uploadsAfter = (await readdir(tmpdir())).filter((name) => name.startsWith("nanbo-upload-") && !uploadsBefore.has(name));
  assert.deepEqual(uploadsAfter, []);
  const afterFailure = await server.postJson("api/style-batches", null);
  assert.equal(afterFailure.status, 200);
});

test("hierarchical manager mode renders 6 families, 11 styles, and 9 slots while preserving every mode selection", { skip: !hasChrome, timeout: 60_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const browser = await startManagerBrowser(t, server.url, { width: 390 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const publicSearch = document.querySelector("#search-input");
    publicSearch.value = "NB-137";
    publicSearch.dispatchEvent(new Event("input", { bubbles: true }));
    const draftFilter = document.querySelector("#draft-status-filter");
    draftFilter.value = "archived";
    draftFilter.dispatchEvent(new Event("change", { bubbles: true }));
    const stylesMode = document.querySelector('input[name="library-mode"][value="styles"]');
    stylesMode.checked = true;
    stylesMode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.waitFor('[...document.querySelectorAll("#style-slot-grid [data-reference-count]")].every((node) => node.dataset.referenceCount)');

  const initial = await browser.evaluate(`(() => {
    const root = document.querySelector("#style-library-view");
    const controls = [...root.querySelectorAll("button, input, select, textarea")]
      .filter((control) => !control.hidden && getComputedStyle(control).display !== "none"
        && getComputedStyle(control).visibility !== "hidden" && control.getBoundingClientRect().width > 2
        && (!control.closest("dialog") || control.closest("dialog").open));
    return {
      rootVisible: !root.hidden,
      publicHidden: document.querySelector("#public-library-view").hidden,
      draftsHidden: document.querySelector("#draft-library-view").hidden,
      familyCount: document.querySelectorAll("#style-family-list [data-style-family-id]").length,
      styleCount: document.querySelectorAll("#style-list [data-style-id]").length,
      slotCount: document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length,
      stableSlotIds: [...document.querySelectorAll("#style-slot-grid [data-style-slot-id]")].every((card) => /^ST-IN-01-01-P0[1-9]$/.test(card.dataset.styleSlotId)),
      assetCodes: [...document.querySelectorAll("#style-slot-grid [data-asset-code]")].every((node) => /^NB-\\d{3,}$/.test(node.dataset.assetCode)),
      referenceCounts: [...document.querySelectorAll("#style-slot-grid [data-reference-count]")].every((node) => Number(node.dataset.referenceCount) >= 1),
      slotSummary: document.querySelector("#style-slot-count")?.textContent,
      uniqueSummary: document.querySelector("#style-unique-assets")?.textContent,
      maturity: document.querySelector("#style-maturity-label")?.textContent,
      syncSummary: document.querySelector("#style-sync-status")?.textContent,
      allTargets44: controls.every((control) => control.getBoundingClientRect().height >= 44),
      shortTargets: controls.filter((control) => control.getBoundingClientRect().height < 44)
        .map((control) => control.tagName.toLowerCase() + "#" + control.id + "." + control.className + ":" + control.getBoundingClientRect().height),
      horizontalOverflow: root.scrollWidth - root.clientWidth,
    };
  })()`);
  assert.deepEqual({
    rootVisible: initial.rootVisible,
    publicHidden: initial.publicHidden,
    draftsHidden: initial.draftsHidden,
    familyCount: initial.familyCount,
    styleCount: initial.styleCount,
    slotCount: initial.slotCount,
    stableSlotIds: initial.stableSlotIds,
    assetCodes: initial.assetCodes,
    referenceCounts: initial.referenceCounts,
    slotSummary: initial.slotSummary,
    uniqueSummary: initial.uniqueSummary,
    maturity: initial.maturity,
    syncSummary: initial.syncSummary,
  }, {
    rootVisible: true,
    publicHidden: true,
    draftsHidden: true,
    familyCount: 6,
    styleCount: 11,
    slotCount: 9,
    stableSlotIds: true,
    assetCodes: true,
    referenceCounts: true,
    slotSummary: "9 个照片位",
    uniqueSummary: "9 张独立资产",
    maturity: "风格参考",
    syncSummary: "待同步风格 0",
  });
  assert.equal(initial.allTargets44, true, initial.shortTargets.join("\n"));
  assert.ok(initial.horizontalOverflow <= 1, `390px 风格管理横向溢出 ${initial.horizontalOverflow}px`);

  const selection = await browser.evaluate(`(async () => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
    const click = async (selector) => { document.querySelector(selector).click(); await wait(); };
    await click('[data-style-scene="outdoor"]');
    await click('[data-style-family-id="OUT-02"]');
    await click('[data-style-id="ST-OUT-02-03"]');
    const family = document.querySelector('[data-style-family-id="OUT-02"]');
    family.focus();
    family.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await wait();
    const keyboardFamily = document.querySelector('#style-family-list [aria-selected="true"]');
    const keyboardFamilyFocused = document.activeElement === keyboardFamily;
    const publicMode = document.querySelector('input[name="library-mode"][value="public"]');
    publicMode.checked = true;
    publicMode.dispatchEvent(new Event("change", { bubbles: true }));
    const draftsMode = document.querySelector('input[name="library-mode"][value="drafts"]');
    draftsMode.checked = true;
    draftsMode.dispatchEvent(new Event("change", { bubbles: true }));
    const stylesMode = document.querySelector('input[name="library-mode"][value="styles"]');
    stylesMode.checked = true;
    stylesMode.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    return {
      search: document.querySelector("#search-input").value,
      draftStatus: document.querySelector("#draft-status-filter").value,
      scene: document.querySelector('#style-scene-list [aria-selected="true"]')?.dataset.styleScene,
      family: keyboardFamily?.dataset.styleFamilyId,
      familyFocused: keyboardFamilyFocused,
      selectedStyle: document.querySelector('#style-list [aria-selected="true"]')?.dataset.styleId,
      activeMode: document.querySelector('input[name="library-mode"]:checked')?.value,
    };
  })()`);
  assert.deepEqual(selection, {
    search: "NB-137",
    draftStatus: "archived",
    scene: "outdoor",
    family: "OUT-03",
    familyFocused: true,
    selectedStyle: "ST-OUT-03-01",
    activeMode: "styles",
  });
});

test("slot reorder is pointer and keyboard accessible, stays visual until save, and carries cover identity", { skip: !hasChrome, timeout: 90_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const beforeBytes = await readFile(server.assignmentsPath);
  const before = JSON.parse(beforeBytes).assignments["ST-IN-01-01"];
  const assetBySlotId = Object.fromEntries(before.slots.map((slot, index) => [
    `ST-IN-01-01-P${String(index + 1).padStart(2, "0")}`,
    slot.assetId,
  ]));
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    window.__layoutMutationRequests = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if ((init.method || "GET") !== "GET" && String(url).includes("/api/styles/layout")) {
        window.__layoutMutationRequests.push({ url: String(url), body: init.body });
      }
      return originalFetch(input, init);
    };
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid .style-slot-drag").length === 9');

  const visual = await browser.evaluate(`(() => {
    const first = document.querySelector('[data-style-slot-id="ST-IN-01-01-P01"] .style-slot-drag');
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    const grid = document.querySelector("#style-slot-grid");
    const source = document.querySelector('[data-style-slot-id="ST-IN-01-01-P09"] .style-slot-drag');
    const target = document.querySelector('[data-style-slot-id="ST-IN-01-01-P02"]');
    const targetRect = target.getBoundingClientRect();
    source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 41, clientX: 1, clientY: 1 }));
    grid.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 41,
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
    }));
    grid.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 41 }));
    const cards = [...document.querySelectorAll("#style-slot-grid [data-style-slot-id]")];
    const activeHandle = document.activeElement.closest?.("[data-style-slot-id]");
    return {
      order: cards.map((card) => card.dataset.styleSlotId),
      coverId: document.querySelector("#style-slot-grid .is-cover")?.dataset.styleSlotId,
      layoutPosts: [...window.__layoutMutationRequests],
      keyboardFocusId: activeHandle?.dataset.styleSlotId || "",
      handleHeight: document.querySelector('[data-style-slot-id="ST-IN-01-01-P01"] .style-slot-drag')?.getBoundingClientRect().height || 0,
      saveDisabled: document.querySelector("#style-layout-save")?.disabled,
    };
  })()`);
  assert.deepEqual(visual.order, [
    "ST-IN-01-01-P09",
    "ST-IN-01-01-P02",
    "ST-IN-01-01-P03",
    "ST-IN-01-01-P04",
    "ST-IN-01-01-P05",
    "ST-IN-01-01-P06",
    "ST-IN-01-01-P07",
    "ST-IN-01-01-P08",
    "ST-IN-01-01-P01",
  ]);
  assert.equal(visual.coverId, "ST-IN-01-01-P01");
  assert.deepEqual(visual.layoutPosts, []);
  assert.ok(["ST-IN-01-01-P01", "ST-IN-01-01-P09"].includes(visual.keyboardFocusId));
  assert.ok(visual.handleHeight >= 44);
  assert.equal(visual.saveDisabled, false);
  assert.deepEqual(await readFile(server.assignmentsPath), beforeBytes);

  await browser.evaluate('document.querySelector("#style-layout-save").click()');
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("顺序与封面已保存")');
  const after = JSON.parse(await readFile(server.assignmentsPath)).assignments["ST-IN-01-01"];
  assert.deepEqual(after.slots.map(({ assetId }) => assetId), visual.order.map((slotId) => assetBySlotId[slotId]));
  assert.equal(after.coverPosition, 9);
  assert.equal((await browser.evaluate("window.__layoutMutationRequests.length")), 1);
});

test("nine-photo manager reports the invalid position without committing partial assignments and discards staging", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const validCopies = [];
  const validBytes = await readFile(validPhoto);
  for (let position = 1; position <= 8; position += 1) {
    const path = join(server.sandbox, `batch-valid-${position}.jpg`);
    await writeFile(path, validBytes);
    validCopies.push(path);
  }
  const before = await Promise.all([
    readFile(server.assignmentsPath),
    readFile(server.additionsPath),
    readdir(join(server.photoRoot, "full")),
    readdir(join(server.photoRoot, "thumbs")),
  ]);
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("#style-batch-open").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open');
  await browser.setFileInput("#style-batch-files", [...validCopies, wrongRatioPhoto]);
  await browser.waitFor('document.querySelectorAll("#style-batch-list [data-batch-position]").length === 9');
  await browser.waitFor("document.querySelector('[data-batch-position=\"9\"]')?.dataset.batchStatus === 'error'", 30_000);
  const partial = await browser.evaluate(`(() => ({
    statuses: [...document.querySelectorAll("#style-batch-list [data-batch-position]")].map((row) => row.dataset.batchStatus),
    ninth: document.querySelector('[data-batch-position="9"]')?.textContent.replace(/\\s+/g, " ").trim(),
    commitDisabled: document.querySelector("#style-batch-commit")?.disabled,
    retryHeight: document.querySelector('[data-batch-position="9"] .style-batch-retry')?.getBoundingClientRect().height || 0,
  }))()`);
  assert.deepEqual(partial.statuses.slice(0, 8), Array(8).fill("ready"));
  assert.equal(partial.statuses[8], "error");
  assert.match(partial.ninth, /3:4|尺寸|裁/);
  assert.equal(partial.commitDisabled, true);
  assert.ok(partial.retryHeight >= 44);
  assert.deepEqual(await Promise.all([
    readFile(server.assignmentsPath),
    readFile(server.additionsPath),
    readdir(join(server.photoRoot, "full")),
    readdir(join(server.photoRoot, "thumbs")),
  ]), before);

  await browser.evaluate('document.querySelector("#style-batch-cancel").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open === false');
  const batchRoot = join(server.sandbox, ".local/portfolio-style-batches");
  assert.deepEqual(await readdir(batchRoot), []);
  assert.equal(await browser.evaluate("document.activeElement?.id"), "style-batch-open");
});

test("batch cancel keeps a failed deletion retryable and restores opener focus only after cleanup", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const validCopies = [];
  const validBytes = await readFile(validPhoto);
  for (let position = 1; position <= 8; position += 1) {
    const path = join(server.sandbox, `batch-delete-retry-${position}.jpg`);
    await writeFile(path, validBytes);
    validCopies.push(path);
  }
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("#style-batch-open").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open');
  await browser.setFileInput("#style-batch-files", [...validCopies, wrongRatioPhoto]);
  await browser.waitFor("document.querySelector('[data-batch-position=\"9\"]')?.dataset.batchStatus === 'error'", 30_000);
  const batchRoot = join(server.sandbox, ".local/portfolio-style-batches");
  assert.equal((await readdir(batchRoot)).length, 1);

  await browser.evaluate(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.__batchDeleteAttempts = 0;
    window.fetch = (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if ((init.method || "GET") === "DELETE" && String(url).includes("/api/style-batches/")) {
        window.__batchDeleteAttempts += 1;
        if (window.__batchDeleteAttempts === 1) return Promise.reject(new Error("模拟删除失败"));
      }
      return originalFetch(input, init);
    };
    document.querySelector("#style-batch-cancel").click();
  })()`);
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("模拟删除失败")');
  assert.equal(await browser.evaluate('document.querySelector("#style-batch-dialog")?.open'), true);
  assert.equal(await browser.evaluate('document.querySelector("#style-batch-cancel")?.disabled'), false);
  assert.equal((await readdir(batchRoot)).length, 1);

  await browser.evaluate('document.querySelector("#style-batch-cancel").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open === false');
  assert.equal(await browser.evaluate("window.__batchDeleteAttempts"), 2);
  assert.deepEqual(await readdir(batchRoot), []);
  assert.equal(await browser.evaluate("document.activeElement?.id"), "style-batch-open");
});

test("manager can undo a slot after committing a nine-photo batch", { skip: !hasChrome, timeout: 180_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const copies = [];
  const bytes = await readFile(validPhoto);
  for (let position = 1; position <= 9; position += 1) {
    const path = join(server.sandbox, `batch-undo-${position}.jpg`);
    await writeFile(path, bytes);
    copies.push(path);
  }
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("#style-batch-open").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open');
  await browser.setFileInput("#style-batch-files", copies);
  await browser.waitFor('document.querySelector("#style-batch-commit")?.disabled === false', 30_000);
  await browser.evaluate('document.querySelector("#style-batch-commit").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open === false', 30_000);
  await browser.waitFor('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] [data-asset-code=\\"NB-159\\"]")');
  assert.equal(await browser.evaluate('document.querySelectorAll("#style-slot-grid .style-slot-undo:not([hidden])").length'), 9);

  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-undo").click()');
  await browser.waitFor('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] [data-asset-code=\\"NB-137\\"]")', 30_000);
  assert.equal((await fetch(new URL("api/assets/references?id=159", server.url))).status, 404);
});

test("mixed-MIME reselection invalidates a ready batch, renders nine retryable rows, and commits only the new batch", { skip: !hasChrome, timeout: 180_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const validBytes = await readFile(validPhoto);
  const oldFiles = [];
  const newFiles = [];
  for (let position = 1; position <= 9; position += 1) {
    const oldPath = join(server.sandbox, `old-ready-${position}.jpg`);
    const newPath = join(server.sandbox, `new-selection-${position}.jpg`);
    await Promise.all([writeFile(oldPath, validBytes), writeFile(newPath, validBytes)]);
    oldFiles.push(oldPath);
    newFiles.push(newPath);
  }
  const invalidGif = join(server.sandbox, "new-selection-9.gif");
  await writeFile(invalidGif, Buffer.from("GIF89a-invalid-style-batch", "ascii"));

  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    window.__batchNetwork = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      window.__batchNetwork.push({ method: init.method || "GET", url: String(url) });
      return originalFetch(input, init);
    };
    const mode = document.querySelector('input[name="library-mode"][value="styles"]');
    mode.checked = true;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("#style-batch-open").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open');
  await browser.setFileInput("#style-batch-files", oldFiles);
  await browser.waitFor('document.querySelector("#style-batch-commit")?.disabled === false', 30_000);

  await browser.setFileInput("#style-batch-files", [...newFiles.slice(0, 8), invalidGif]);
  try {
    await browser.waitFor(`document.querySelectorAll("#style-batch-list [data-batch-position]").length === 9
      && [...document.querySelectorAll("#style-batch-list [data-batch-position]")].slice(0, 8).every((row) => row.dataset.batchStatus === "ready")
      && document.querySelector('[data-batch-position="9"]')?.dataset.batchStatus === "error"`, 30_000);
  } catch (error) {
    const diagnostic = await browser.evaluate(`(() => ({
      rows: [...document.querySelectorAll("#style-batch-list [data-batch-position]")]
        .map((row) => ({ position: row.dataset.batchPosition, status: row.dataset.batchStatus, text: row.textContent.replace(/\\s+/g, " ").trim() })),
      commitDisabled: document.querySelector("#style-batch-commit")?.disabled,
      dialogOpen: document.querySelector("#style-batch-dialog")?.open,
      network: [...window.__batchNetwork],
    }))()`);
    throw new Error(`${error.message}；诊断=${JSON.stringify(diagnostic)}`);
  }
  const invalidState = await browser.evaluate(`(() => ({
    commitDisabled: document.querySelector("#style-batch-commit")?.disabled,
    retryCount: document.querySelectorAll("#style-batch-list .style-batch-retry").length,
    rowCount: document.querySelectorAll("#style-batch-list [data-batch-position]").length,
    ninthText: document.querySelector('[data-batch-position="9"]')?.textContent.replace(/\\s+/g, " ").trim(),
    network: [...window.__batchNetwork],
  }))()`);
  assert.deepEqual({
    commitDisabled: invalidState.commitDisabled,
    retryCount: invalidState.retryCount,
    rowCount: invalidState.rowCount,
  }, { commitDisabled: true, retryCount: 1, rowCount: 9 });
  assert.match(invalidState.ninthText, /JPG|PNG|WebP|支持/);
  const stagedBatchIds = [...new Set(invalidState.network
    .filter(({ method, url }) => method === "PUT" && url.includes("/api/style-batches/"))
    .map(({ url }) => url.match(/style-batches\/([0-9a-f-]{36})\/files/)?.[1])
    .filter(Boolean))];
  assert.equal(stagedBatchIds.length, 2);
  assert.notEqual(stagedBatchIds[0], stagedBatchIds[1]);
  assert.equal(invalidState.network.some(({ method, url }) => method === "DELETE" && url.includes(stagedBatchIds[0])), true);

  await browser.setFileInput('[data-batch-position="9"] .style-batch-retry input', newFiles[8]);
  await browser.waitFor('document.querySelector("#style-batch-commit")?.disabled === false', 30_000);
  await browser.evaluate('document.querySelector("#style-batch-commit").click()');
  await browser.waitFor('document.querySelector("#style-batch-dialog")?.open === false', 30_000);
  await browser.waitFor('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] [data-asset-code=\\"NB-159\\"]")');
  const commitBatchIds = await browser.evaluate(`window.__batchNetwork
    .filter(({ method, url }) => method === "POST" && url.includes("/commit"))
    .map(({ url }) => url.match(/style-batches\\/([0-9a-f-]{36})\\/commit/)?.[1])`);
  assert.deepEqual(commitBatchIds, [stagedBatchIds[1]]);
});

test("stale single-slot load cannot cross into a newly opened slot", { skip: !hasChrome, timeout: 60_000 }, async (t) => {
  const { browser } = await startDeferredStyleManager(t);
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-replace").click()');
  await browser.waitFor('document.querySelector("#style-slot-replace-dialog")?.open');
  await browser.setFileInput("#style-slot-file", validPhoto);
  await browser.waitFor("window.__styleImageProbes.length === 1");
  const staleUrl = await browser.evaluate("window.__styleCreatedObjectUrls[0]");

  await browser.evaluate(`(() => {
    document.querySelector("#style-slot-cancel").click();
    document.querySelector('[data-style-slot-id="ST-IN-01-01-P02"] .style-slot-replace').click();
    window.__finishStyleImageProbe(0, { width: 900, height: 1200 });
  })()`);
  await browser.evaluate("new Promise((resolve) => setTimeout(resolve, 0))");

  const state = await browser.evaluate(`(() => ({
    title: document.querySelector("#style-slot-replace-title")?.textContent,
    inputFiles: document.querySelector("#style-slot-file")?.files.length,
    confirmDisabled: document.querySelector("#style-slot-confirm")?.disabled,
    previewHidden: document.querySelector("#style-slot-new-preview")?.hidden,
    previewSrc: document.querySelector("#style-slot-new-preview")?.getAttribute("src"),
    revokedStaleUrl: window.__styleRevokedObjectUrls.filter((url) => url === ${JSON.stringify(staleUrl)}).length,
  }))()`);
  assert.deepEqual(state, {
    title: "只替换 ST-IN-01-01-P02",
    inputFiles: 0,
    confirmDisabled: true,
    previewHidden: true,
    previewSrc: null,
    revokedStaleUrl: 1,
  });
});

test("stale single-slot load cannot overwrite a newer candidate in the same slot", { skip: !hasChrome, timeout: 60_000 }, async (t) => {
  const { browser } = await startDeferredStyleManager(t);
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-replace").click()');
  await browser.waitFor('document.querySelector("#style-slot-replace-dialog")?.open');
  await browser.setFileInput("#style-slot-file", validPhoto);
  await browser.waitFor("window.__styleImageProbes.length === 1");
  await browser.setFileInput("#style-slot-file", newerValidPhoto);
  await browser.waitFor("window.__styleImageProbes.length === 2");
  const urls = await browser.evaluate("[...window.__styleCreatedObjectUrls]");

  await browser.evaluate("window.__finishStyleImageProbe(1, { width: 1200, height: 1600 })");
  await browser.evaluate("new Promise((resolve) => setTimeout(resolve, 0))");
  await browser.evaluate("window.__finishStyleImageProbe(0, { width: 900, height: 1200 })");
  await browser.evaluate("new Promise((resolve) => setTimeout(resolve, 0))");

  const state = await browser.evaluate(`(() => ({
    label: document.querySelector("#style-slot-new-label")?.textContent,
    previewSrc: document.querySelector("#style-slot-new-preview")?.getAttribute("src"),
    confirmDisabled: document.querySelector("#style-slot-confirm")?.disabled,
    revokedOld: window.__styleRevokedObjectUrls.filter((url) => url === ${JSON.stringify(urls[0])}).length,
    revokedNew: window.__styleRevokedObjectUrls.filter((url) => url === ${JSON.stringify(urls[1])}).length,
  }))()`);
  assert.deepEqual(state, {
    label: "1200×1600",
    previewSrc: urls[1],
    confirmDisabled: false,
    revokedOld: 1,
    revokedNew: 0,
  });
});

test("stale single-slot error after close only revokes its own URL", { skip: !hasChrome, timeout: 60_000 }, async (t) => {
  const { browser } = await startDeferredStyleManager(t);
  const toastBefore = await browser.evaluate('document.querySelector("#toast")?.textContent');
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-replace").click()');
  await browser.waitFor('document.querySelector("#style-slot-replace-dialog")?.open');
  await browser.setFileInput("#style-slot-file", validPhoto);
  await browser.waitFor("window.__styleImageProbes.length === 1");
  const staleUrl = await browser.evaluate("window.__styleCreatedObjectUrls[0]");

  await browser.evaluate(`(() => {
    document.querySelector("#style-slot-cancel").click();
    window.__finishStyleImageProbe(0, { error: true });
  })()`);
  await browser.evaluate("new Promise((resolve) => setTimeout(resolve, 0))");

  const state = await browser.evaluate(`(() => ({
    dialogOpen: document.querySelector("#style-slot-replace-dialog")?.open,
    inputFiles: document.querySelector("#style-slot-file")?.files.length,
    confirmDisabled: document.querySelector("#style-slot-confirm")?.disabled,
    previewHidden: document.querySelector("#style-slot-new-preview")?.hidden,
    previewSrc: document.querySelector("#style-slot-new-preview")?.getAttribute("src"),
    toast: document.querySelector("#toast")?.textContent,
    revokedStaleUrl: window.__styleRevokedObjectUrls.filter((url) => url === ${JSON.stringify(staleUrl)}).length,
  }))()`);
  assert.deepEqual(state, {
    dialogOpen: false,
    inputFiles: 0,
    confirmDisabled: true,
    previewHidden: true,
    previewSrc: null,
    toast: toastBefore,
    revokedStaleUrl: 1,
  });
});

test("style controller performs copy-on-write replacement, metadata, cover, preview, visibility, and undo without publishing", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const beforeReferences = await (await fetch(new URL("api/assets/references?id=137", server.url))).json();
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    window.__managerOpenedUrls = [];
    window.open = (url) => { window.__managerOpenedUrls.push(String(url)); return null; };
    const input = document.querySelector('input[name="library-mode"][value="styles"]');
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-replace").click()');
  await browser.waitFor('document.querySelector("#style-slot-replace-dialog")?.open');
  await browser.setFileInput("#style-slot-file", validPhoto);
  await browser.waitFor('document.querySelector("#style-slot-confirm")?.disabled === false');
  await browser.evaluate('document.querySelector("#style-slot-file").dispatchEvent(new Event("change", { bubbles: true }))');
  await browser.waitFor('document.querySelector("#style-slot-confirm")?.disabled === false', 1_000);
  const preview = await browser.evaluate(`(() => ({
    current: document.querySelector("#style-slot-current-preview")?.getAttribute("src"),
    candidate: document.querySelector("#style-slot-new-preview")?.getAttribute("src"),
    explanation: document.querySelector("#style-copy-on-write-note p")?.textContent.replace(/\\s+/g, " ").trim(),
  }))()`);
  assert.match(preview.current, /\/media\/thumb\/137$/);
  assert.match(preview.candidate, /^blob:/);
  assert.equal(preview.explanation, "只替换当前照片位：新图会获得新的 NB 资产编号，其他复用位置不变。");

  await browser.evaluate('document.querySelector("#style-slot-confirm").click()');
  await browser.waitFor('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] [data-asset-code=\\"NB-159\\"]")');
  await browser.waitFor('document.querySelector("#style-maturity-label")?.textContent === "正在完善"');
  const afterReferences = await (await fetch(new URL("api/assets/references?id=137", server.url))).json();
  assert.equal(afterReferences.count, beforeReferences.count - 1);
  assert.ok(afterReferences.slotIds.includes("ST-IN-01-02-P01"));
  assert.ok(!afterReferences.slotIds.includes("ST-IN-01-01-P01"));

  await browser.evaluate(`(() => {
    const slot = document.querySelector('[data-style-slot-id="ST-IN-01-01-P01"]');
    const pose = slot.querySelector(".style-slot-pose");
    pose.value = "正面站姿·已复核";
    slot.querySelector(".style-slot-save").click();
  })()`);
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("姿势标签已保存")');
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P02\\"] .style-slot-cover").click()');
  await browser.waitFor('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P02\\"]")?.classList.contains("is-cover")');
  await browser.evaluate(`(() => {
    const maturity = document.querySelector("#style-maturity");
    maturity.value = "updating";
    maturity.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browser.waitFor('document.querySelector("#style-maturity-label")?.textContent === "正在完善"');
  await browser.evaluate('document.querySelector("#style-layout-save").click()');
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("顺序与封面已保存")');

  await browser.evaluate(`(() => {
    document.querySelector("#style-name").value = "职业形象·后台复核";
    document.querySelector("#style-audience").value = "需要正式头像的男士";
    document.querySelector("#style-description").value = "干净正装与稳定目光";
    document.querySelector("#style-visibility").value = "hidden";
    document.querySelector("#style-copy-editor").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  })()`);
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("风格资料已保存")');
  const saved = await browser.evaluate(`(() => ({
    selectedStyle: document.querySelector('#style-list [aria-selected="true"]')?.dataset.styleId,
    hiddenBadge: document.querySelector('[data-style-id="ST-IN-01-01"]')?.textContent.includes("已隐藏"),
    slotCount: document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length,
    poseLabel: document.querySelector('[data-style-slot-id="ST-IN-01-01-P01"] .style-slot-pose')?.value,
    coverCount: document.querySelectorAll("#style-slot-grid .is-cover").length,
    coverId: document.querySelector("#style-slot-grid .is-cover")?.dataset.styleSlotId,
    publishDisabled: document.querySelector("#publish-button").disabled,
  }))()`);
  assert.deepEqual(saved, {
    selectedStyle: "ST-IN-01-01",
    hiddenBadge: true,
    slotCount: 9,
    poseLabel: "正面站姿·已复核",
    coverCount: 1,
    coverId: "ST-IN-01-01-P02",
    publishDisabled: true,
  });

  await browser.evaluate('document.querySelector("#style-preview-button").click()');
  const opened = await browser.evaluate("window.__managerOpenedUrls");
  assert.deepEqual(opened, ["/preview/?scene=indoor&family=IN-01&style=ST-IN-01-01"]);
  await browser.evaluate('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] .style-slot-undo").click()');
  await browser.waitFor('document.querySelector("[data-style-slot-id=\\"ST-IN-01-01-P01\\"] [data-asset-code=\\"NB-137\\"]")');
  const finalLibrary = await (await fetch(new URL("api/style-library", server.url))).json();
  const finalStyle = finalLibrary.styles.find(({ id }) => id === "ST-IN-01-01");
  assert.equal(finalStyle.visibility, "hidden");
  assert.equal(finalStyle.slots.length, 9);
  assert.equal(finalStyle.slots[0].poseLabel, "正面站姿·已复核");
  assert.equal(finalStyle.slots[1].isCover, true);
});

test("global NB replacement lists all references, recommends one slot, and cancel touches no file or manifest", { skip: !hasChrome, timeout: 60_000 }, async (t) => {
  const server = await startManagerFixture(t);
  const expected = await (await fetch(new URL("api/assets/references?id=137", server.url))).json();
  const before = await Promise.all([
    readFile(server.additionsPath),
    readFile(server.assignmentsPath),
    readFile(server.catalogPath),
    readdir(join(server.photoRoot, "full")),
    readdir(join(server.photoRoot, "thumbs")),
  ]);
  const browser = await startManagerBrowser(t, server.url, { width: 1280 });
  await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
  await browser.evaluate(`(() => {
    window.__managerMutationRequests = [];
    window.__globalSlotOperationIds = [];
    window.__dropGlobalSlotResponse = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if ((init.method || "GET") !== "GET") window.__managerMutationRequests.push(url);
      const isSlotReplace = (init.method || "GET") === "POST" && String(url).includes("/api/style-slots/replace");
      if (isSlotReplace) window.__globalSlotOperationIds.push(new Headers(init.headers).get("x-nanbo-operation-id"));
      const response = await originalFetch(input, init);
      if (isSlotReplace && response.ok && window.__dropGlobalSlotResponse) {
        window.__dropGlobalSlotResponse = false;
        await response.clone().arrayBuffer();
        throw new TypeError("模拟全局单槽响应丢失");
      }
      return response;
    };
    document.querySelector('[data-id="137"]').click();
  })()`);
  await browser.waitFor('document.querySelector("#photo-dialog")?.open');
  await browser.setFileInput("#photo-file", validPhoto);
  await browser.waitFor('document.querySelector("#replace-button")?.disabled === false');
  await browser.evaluate('document.querySelector("#replace-button").click()');
  await browser.waitFor('document.querySelector("#global-reference-dialog")?.open');
  const warning = await browser.evaluate(`(() => ({
    referenceRows: [...document.querySelectorAll("#global-reference-list [data-reference-slot]")].map((row) => ({
      slotId: row.dataset.referenceSlot,
      styleId: row.dataset.referenceStyle,
      text: row.textContent.replace(/\\s+/g, " ").trim(),
    })),
    recommended: document.querySelector("#global-replace-one")?.textContent.replace(/\\s+/g, " ").trim(),
    mutationRequests: [...window.__managerMutationRequests],
  }))()`);
  assert.equal(warning.referenceRows.length, expected.count);
  assert.deepEqual(warning.referenceRows.map(({ slotId }) => slotId), expected.slotIds);
  assert.equal(warning.referenceRows.every(({ slotId, styleId, text }) => text.includes(slotId) && text.includes(styleId)), true);
  assert.equal(warning.recommended, "只替换当前照片位（推荐）");
  assert.deepEqual(warning.mutationRequests, []);

  await browser.evaluate('document.querySelector("#global-replace-all-start").click()');
  await browser.waitFor('document.querySelector("#global-replace-all-confirm")?.hidden === false');
  assert.deepEqual(await browser.evaluate("window.__managerMutationRequests"), []);
  await browser.evaluate('document.querySelector("#global-reference-cancel").click()');
  await browser.waitFor('document.querySelector("#global-reference-dialog")?.open === false');

  const after = await Promise.all([
    readFile(server.additionsPath),
    readFile(server.assignmentsPath),
    readFile(server.catalogPath),
    readdir(join(server.photoRoot, "full")),
    readdir(join(server.photoRoot, "thumbs")),
  ]);
  assert.deepEqual(after, before);
  assert.deepEqual(await browser.evaluate("window.__managerMutationRequests"), []);

  const targetSlotId = expected.slotIds.at(-1);
  const targetStyleId = targetSlotId.replace(/-P0[1-9]$/, "");
  await browser.evaluate('document.querySelector("#replace-button").click()');
  await browser.waitFor('document.querySelector("#global-reference-dialog")?.open');
  await browser.evaluate(`(() => {
    const target = document.querySelector('input[name="global-slot-target"][value="${targetSlotId}"]');
    target.checked = true;
    window.__dropGlobalSlotResponse = true;
    document.querySelector("#global-replace-one").click();
  })()`);
  await browser.waitFor('document.querySelector("#toast")?.textContent.includes("模拟全局单槽响应丢失")', 30_000);
  await browser.evaluate('document.querySelector("#global-replace-one").click()');
  await browser.waitFor(`document.querySelector('input[name="library-mode"][value="styles"]')?.checked
    && document.querySelector("#style-library-view")?.dataset.selectedStyle === "${targetStyleId}"
    && document.querySelector('[data-style-slot-id="${targetSlotId}"] [data-asset-code="NB-159"]')`);
  const afterSingleSlot = await (await fetch(new URL("api/assets/references?id=137", server.url))).json();
  assert.equal(afterSingleSlot.count, expected.count - 1);
  assert.ok(!afterSingleSlot.slotIds.includes(targetSlotId));
  assert.equal((await (await fetch(new URL("api/assets/references?id=159", server.url))).json()).slotIds[0], targetSlotId);
  const operationIds = await browser.evaluate('[...window.__globalSlotOperationIds]');
  assert.equal(operationIds.length, 2);
  assert.match(operationIds[0] || "", /^[0-9a-f-]{36}$/);
  assert.equal(operationIds[1], operationIds[0]);
});

test("style manager fits 320px, 390px, and desktop with reduced-motion feedback", { skip: !hasChrome, timeout: 120_000 }, async (t) => {
  const server = await startManagerFixture(t);
  for (const width of [320, 390, 1280]) {
    const browser = await startManagerBrowser(t, server.url, { width, reducedMotion: width === 390 });
    await browser.waitFor('document.querySelector("#photo-grid")?.getAttribute("aria-busy") === "false"');
    await browser.evaluate(`(() => {
      const input = document.querySelector('input[name="library-mode"][value="styles"]');
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await browser.waitFor('document.querySelectorAll("#style-slot-grid [data-style-slot-id]").length === 9');
    const metrics = await browser.evaluate(`(() => {
      const root = document.querySelector("#style-library-view");
      const visibleTargets = [...root.querySelectorAll("button, select, input:not([type=file]), textarea")]
        .filter((control) => {
          const style = getComputedStyle(control);
          const rect = control.getBoundingClientRect();
          return !control.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 2
            && (!control.closest("dialog") || control.closest("dialog").open);
        });
      const durations = visibleTargets.flatMap((control) => getComputedStyle(control).transitionDuration
        .split(",").map((value) => Number.parseFloat(value) * (value.includes("ms") ? .001 : 1)));
      return {
        rootOverflow: root.scrollWidth - root.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        allTargets44: visibleTargets.every((control) => control.getBoundingClientRect().height >= 44),
        shortTargets: visibleTargets.filter((control) => control.getBoundingClientRect().height < 44)
          .map((control) => control.tagName.toLowerCase() + "#" + control.id + "." + control.className + ":" + control.getBoundingClientRect().height),
        maxTransition: Math.max(0, ...durations),
      };
    })()`);
    assert.ok(metrics.rootOverflow <= 1, `${width}px 风格工作区溢出 ${metrics.rootOverflow}px`);
    assert.ok(metrics.documentOverflow <= 1, `${width}px 页面溢出 ${metrics.documentOverflow}px`);
    assert.equal(metrics.allTargets44, true, `${width}px 存在小于 44px 的可操作控件\n${metrics.shortTargets.join("\n")}`);
    if (width === 390) assert.ok(metrics.maxTransition <= 0.01, `reduced-motion 过渡过长 ${metrics.maxTransition}s`);
  }
});

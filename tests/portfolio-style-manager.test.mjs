import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as photoLib from "../tools/portfolio-photo-lib.mjs";

const styleStoreUrl = new URL("../tools/portfolio-style-store.mjs", import.meta.url);
let sourceFixtureRoot = "";
let validPhoto = "";
let wrongRatioPhoto = "";

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
  wrongRatioPhoto = join(sourceFixtureRoot, "wrong-ratio.jpg");
  await generateJpeg(validPhoto, "900x1200", "0x6b4f3f", "NANBO_PRIVATE_TEST");
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
    store: createPortfolioStyleStore({ rootDir, photoRoot, additionsPath, catalogPath, assignmentsPath }),
    validPhoto,
    wrongRatioPhoto,
  };
}

async function fileBytes(path) {
  return readFile(path);
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

test("layout reorders only one style and commits its cover and maturity together", async (t) => {
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
    maturity: "complete",
  });
  const after = await fixture.store.read();
  const target = after.styles.find((style) => style.id === styleId);

  assert.deepEqual(target.slots.map((slot) => slot.assetId), [...beforeAssets].reverse());
  assert.equal(target.coverPosition, 1);
  assert.equal(target.maturity, "complete");
  assert.ok(!Number.isNaN(Date.parse(target.updatedAt)));
  assert.deepEqual(after.assignments.assignments["ST-IN-01-02"], otherBefore);
  assert.deepEqual(await fileBytes(fixture.catalogPath), catalogBefore);
  assert.ok((await transactionMetas(fixture.rootDir)).some((meta) => meta.operation === "update-layout" && meta.status === "committed"));
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

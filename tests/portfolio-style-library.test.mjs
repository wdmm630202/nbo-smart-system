import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fixtureAssets,
  fixtureAssignments,
  fixtureStyleCatalog,
} from "./helpers/portfolio-style-fixtures.mjs";

let publicContract;

async function loadPublicContract() {
  if (publicContract) return publicContract;
  try {
    const module = await import("../apps/portfolio-v2/style-library.js");
    for (const name of [
      "buildStyleLibrary",
      "normalizeStyleAssignments",
      "normalizeStyleCatalog",
      "styleSlotId",
    ]) {
      assert.equal(typeof module[name], "function", `public contract must export ${name}`);
    }
    publicContract = module;
    return module;
  } catch (error) {
    assert.fail(`style-library public behavior is unavailable: ${error.message}`);
  }
}

async function loadProductionCatalog() {
  try {
    return JSON.parse(await readFile(new URL("../apps/portfolio-v2/style-catalog.json", import.meta.url), "utf8"));
  } catch (error) {
    assert.fail(`production style catalog is unavailable: ${error.message}`);
  }
}

test("style library exposes its public contract", async () => {
  await loadPublicContract();
});

test("production catalog has 66 indoor and 66 outdoor styles in six-by-eleven families", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = normalizeStyleCatalog(await loadProductionCatalog());
  assert.equal(catalog.families.length, 12);
  assert.equal(catalog.styles.length, 132);
  assert.equal(catalog.featuredStyleIds.length, 8);
  for (const scene of ["indoor", "outdoor"]) {
    const families = catalog.families.filter((family) => family.scene === scene);
    assert.equal(families.length, 6);
    assert.equal(catalog.styles.filter((style) => style.scene === scene).length, 66);
    for (const family of families) assert.equal(catalog.styles.filter((style) => style.familyId === family.id).length, 11);
  }
  assert.ok(catalog.styles.every((style) => style.audience.length >= 6 && style.description.length >= 6));
});

test("style slot ids are stable and one based", async () => {
  const { styleSlotId } = await loadPublicContract();
  assert.equal(styleSlotId("ST-IN-01-01", 1), "ST-IN-01-01-P01");
  assert.equal(styleSlotId("ST-OUT-06-11", 9), "ST-OUT-06-11-P09");
  assert.throws(() => styleSlotId("ST-IN-01-01", 0), /1–9/);
});

test("style catalog rejects unknown fields and invalid cardinality", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  assert.throws(
    () => normalizeStyleCatalog({ schemaVersion: 1, families: [], styles: [], extra: true }),
    /不允许字段/,
  );
  assert.throws(
    () => normalizeStyleCatalog({ schemaVersion: 1, families: [], styles: [] }),
    /12 个大类/,
  );
});

test("family records reject unknown fields", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  catalog.families[0].extra = true;
  assert.throws(() => normalizeStyleCatalog(catalog), /不允许字段/);
});

test("style records reject unknown fields", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  catalog.styles[0].extra = true;
  assert.throws(() => normalizeStyleCatalog(catalog), /不允许字段/);
});

test("assignments require nine unique same-scene public assets", async () => {
  const { normalizeStyleAssignments } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  const firstSlots = [1, 1, 2, 3, 4, 5, 6, 7, 8].map((assetId, index) => ({
    assetId,
    poseLabel: `拍摄参考 ${index + 1}`,
    source: "seed",
    updatedAt: null,
  }));
  const duplicated = fixtureAssignments({ firstSlots });
  const assetMap = new Map(fixtureAssets().map((asset) => [asset.id, asset]));
  assert.throws(() => normalizeStyleAssignments(duplicated, catalog, assetMap), /9 个不重复资产/);

  const wrongScene = fixtureAssignments();
  wrongScene.assignments["ST-IN-01-01"].slots[0].assetId = 10;
  assert.throws(() => normalizeStyleAssignments(wrongScene, catalog, assetMap), /场景/);
});

test("assignment records reject unknown fields", async () => {
  const { normalizeStyleAssignments } = await loadPublicContract();
  const assignments = fixtureAssignments();
  assignments.assignments["ST-IN-01-01"].extra = true;
  const assetMap = new Map(fixtureAssets().map((asset) => [asset.id, asset]));
  assert.throws(() => normalizeStyleAssignments(assignments, fixtureStyleCatalog(), assetMap), /不允许字段/);
});

test("slot records reject unknown fields", async () => {
  const { normalizeStyleAssignments } = await loadPublicContract();
  const assignments = fixtureAssignments();
  assignments.assignments["ST-IN-01-01"].slots[0].extra = true;
  const assetMap = new Map(fixtureAssets().map((asset) => [asset.id, asset]));
  assert.throws(() => normalizeStyleAssignments(assignments, fixtureStyleCatalog(), assetMap), /不允许字段/);
});

test("featured styles are eight unique valid style ids", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  catalog.featuredStyleIds[7] = catalog.featuredStyleIds[0];
  assert.throws(() => normalizeStyleCatalog(catalog), /8 个不重复的精选风格/);
});

test("assignments require reviewed slot metadata and upload-only timestamps", async () => {
  const { normalizeStyleAssignments } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  const assetMap = new Map(fixtureAssets().map((asset) => [asset.id, asset]));
  const invalid = fixtureAssignments();
  invalid.assignments["ST-IN-01-01"].slots[0].poseLabel = " ";
  assert.throws(() => normalizeStyleAssignments(invalid, catalog, assetMap), /poseLabel/);

  invalid.assignments["ST-IN-01-01"].slots[0].poseLabel = "拍摄参考 1";
  invalid.assignments["ST-IN-01-01"].slots[0].updatedAt = "2026-09-01T00:00:00.000Z";
  assert.throws(() => normalizeStyleAssignments(invalid, catalog, assetMap), /upload/);
});

test("library builder returns stable slots and complete counts", async () => {
  const { buildStyleLibrary } = await loadPublicContract();
  const library = buildStyleLibrary({
    catalog: fixtureStyleCatalog(),
    assignments: fixtureAssignments(),
    assets: fixtureAssets(),
  });
  assert.equal(library.families.length, 12);
  assert.equal(library.styles.length, 132);
  assert.equal(library.slots.length, 1188);
  assert.deepEqual(library.counts, {
    styles: 132,
    publishedStyles: 132,
    indoor: 66,
    outdoor: 66,
    slots: 1188,
    assets: 18,
  });
  assert.deepEqual(library.slots[0], {
    id: "ST-IN-01-01-P01",
    styleId: "ST-IN-01-01",
    position: 1,
    assetId: 1,
    asset: fixtureAssets()[0],
    poseLabel: "拍摄参考 1",
    source: "seed",
    updatedAt: null,
    isCover: true,
  });
});

test("library builder rejects malformed unreferenced assets", async () => {
  const { buildStyleLibrary } = await loadPublicContract();
  assert.throws(() => buildStyleLibrary({
    catalog: fixtureStyleCatalog(),
    assignments: fixtureAssignments(),
    assets: [
      ...fixtureAssets(),
      { id: 999, scene: "private", theme: "", thumb: "", full: "" },
    ],
  }), /公共资产 999 场景字段格式无效/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
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

const approvedFamilies = [
  ["IN-01", "indoor", "商务气场", "职业形象、企业肖像、霸道总裁、精英西装、绅士正装、雅痞西装、红底西装、西装少年、领带松弛、个人模卡、职业证照"],
  ["IN-02", "indoor", "杂志质感", "杂志肖像、简约杂志、光影肖像、情绪肖像、黑白硬照、雕塑光影、窗影故事、时尚摩登、冷调封面、暖调封面、白底极简"],
  ["IN-03", "indoor", "韩系松弛", "居家韩系、韩系学长、美式少年、清爽少年、白衫禁欲、针织少年、奶油暖男、夏日清新、慵懒居家、苹果主题、校园学长"],
  ["IN-04", "indoor", "运动硬朗", "拳击硬汉、腹肌健身、运动型格、网球运动、战术硬汉、皮衣硬汉、痞帅西装、湿发型男、机能潮男、高街潮男、朋克青年"],
  ["IN-05", "indoor", "港风故事", "复古港风、双人港风、港片男主、国风少年、古风武侠、民国男主、中式雅士、新中公子、长衫先生、美式复古、怀旧胶片"],
  ["IN-06", "indoor", "创意个性", "赛博朋克、创意概念、彩色光影、镜面空间、花艺少年、繁花公子、宠物合拍、生日主题、新春主题、圣诞主题、乐队主唱"],
  ["OUT-01", "outdoor", "都市街拍", "时尚街拍、痞帅街拍、潮流街拍、都市街拍、日常休闲、城市漫步、老街港风、涂鸦街区、街角少年、彩色街拍、咖啡街角"],
  ["OUT-02", "outdoor", "城市夜景", "霓虹夜景、城市夜景、天台夜景、港风夜拍、雨夜电影、情绪隧道、暗系情绪、夜市烟火、车灯电影、酒吧微醺、闪光街拍"],
  ["OUT-03", "outdoor", "森系自然", "森系文艺、海边少年、海洋馆景、草地少年、山野旅人、湖边静坐、溪边少年、麦田暖阳、芦苇秋日、雪景少年、花海少年"],
  ["OUT-04", "outdoor", "机车酷感", "炫酷机车、机车型格、公路机车、车库冷感、工业硬照、厂房型男、水泥工业、隧道冷调、公路旅人、车旁街拍、驾车绅士"],
  ["OUT-05", "outdoor", "校园少年", "热血高校、校园少年、操场青春、篮球少年、网球学长、滑板少年、足球少年、骑行少年、跑步少年、运动纪实、机长制服"],
  ["OUT-06", "outdoor", "旅行电影", "正装外景、国风外景、山野武侠、藏地少年、港澳旅拍、大理旅拍、城市地标、列车旅途、游艇绅士、山水旅拍、秋冬街拍"],
];

const riskyCopyTokens = new Map([
  ["ST-IN-01-07", ["红色背景", "确认"]],
  ["ST-IN-03-10", ["苹果", "道具", "确认"]],
  ["ST-IN-06-03", ["彩色光影", "灯光", "确认"]],
  ["ST-IN-06-04", ["镜面", "反射", "确认"]],
  ["ST-IN-06-05", ["花艺", "花材", "确认"]],
  ["ST-IN-06-06", ["繁花", "花材", "确认"]],
  ["ST-IN-06-08", ["生日", "布景", "确认"]],
  ["ST-IN-06-09", ["新春", "节庆", "确认"]],
  ["ST-IN-06-10", ["圣诞", "节庆", "确认"]],
  ["ST-OUT-02-03", ["天台", "场地", "确认"]],
  ["ST-OUT-02-08", ["夜市", "环境", "确认"]],
  ["ST-OUT-02-09", ["车灯", "车辆", "确认"]],
]);

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

test("production catalog matches every approved family and style identity", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = normalizeStyleCatalog(await loadProductionCatalog());
  const expectedFamilies = approvedFamilies.map(([id, scene, label], index) => ({
    id,
    scene,
    label,
    order: (index % 6) + 1,
  }));
  assert.deepEqual(catalog.families.map(({ id, scene, label, order }) => ({ id, scene, label, order })), expectedFamilies);

  const expectedStyles = approvedFamilies.flatMap(([familyId, scene, , labels]) => labels.split("、").map((label, index) => ({
    id: `ST-${familyId}-${String(index + 1).padStart(2, "0")}`,
    familyId,
    scene,
    label,
    order: index + 1,
  })));
  assert.deepEqual(catalog.styles.map(({ id, familyId, scene, label, order }) => ({ id, familyId, scene, label, order })), expectedStyles);
  assert.deepEqual(catalog.featuredStyleIds, [
    "ST-IN-01-04", "ST-IN-02-01", "ST-IN-03-04", "ST-IN-05-03",
    "ST-OUT-01-04", "ST-OUT-02-04", "ST-OUT-03-02", "ST-OUT-04-02",
  ]);
  assert.ok(catalog.styles.every((style) => style.visibility === "published"));
  const legacyThemeIds = new Set(portfolioCatalog.themes.map((theme) => theme.id));
  assert.ok(catalog.styles.every((style) => style.legacyThemeIds.every((themeId) => legacyThemeIds.has(themeId))));
});

test("resource-dependent production styles state their visual mechanism and pre-shoot boundary", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = normalizeStyleCatalog(await loadProductionCatalog());
  const styleById = new Map(catalog.styles.map((style) => [style.id, style]));
  for (const [styleId, tokens] of riskyCopyTokens) {
    const description = styleById.get(styleId)?.description || "";
    for (const token of tokens) assert.ok(description.includes(token), `${styleId} must include ${token}`);
  }
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

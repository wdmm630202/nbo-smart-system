import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildPortfolioItems, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
import {
  fixtureAssets,
  fixtureAssignments,
  fixtureStyleCatalog,
} from "./helpers/portfolio-style-fixtures.mjs";

let publicContract;
const execFileAsync = promisify(execFile);
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function loadPublicContract() {
  if (publicContract) return publicContract;
  try {
    const publicModule = await import("../apps/portfolio-v2/style-library.js");
    for (const name of [
      "buildStyleLibrary",
      "normalizeStyleAssignments",
      "normalizeStyleCatalog",
      "styleSlotId",
    ]) {
      assert.equal(typeof publicModule[name], "function", `public contract must export ${name}`);
    }
    publicContract = publicModule;
    return publicModule;
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

async function loadSeedModule() {
  try {
    return await import("../tools/seed-portfolio-style-library.mjs");
  } catch (error) {
    assert.fail(`portfolio style seed behavior is unavailable: ${error.message}`);
  }
}

const approvedFamilies = [
  ["IN-01", "indoor", "商务气场", "职业形象、企业肖像、霸道总裁、精英西装、绅士正装、雅痞西装、红底西装、西装少年、领带松弛、个人模卡、职业证照"],
  ["IN-02", "indoor", "杂志质感", "杂志肖像、简约杂志、光影肖像、情绪肖像、黑白硬照、雕塑光影、窗影故事、时尚摩登、冷调封面、暖调封面、白底极简"],
  ["IN-03", "indoor", "韩系松弛", "居家韩系、韩系学长、金色少年、清爽少年、白衫禁欲、针织少年、奶油暖男、夏日清新、慵懒居家、水影特写、校园学长"],
  ["IN-04", "indoor", "运动硬朗", "拳击硬汉、腹肌健身、运动型格、网球运动、战术硬汉、皮衣硬汉、痞帅西装、湿发型男、机能潮男、高街潮男、朋克青年"],
  ["IN-05", "indoor", "港风故事", "复古港风、双人港风、港片男主、国风少年、古风武侠、红幕男主、中式雅士、暗黑公子、复古书房、美式复古、怀旧胶片"],
  ["IN-06", "indoor", "创意个性", "赛博朋克、创意概念、彩色光影、镜面空间、花艺少年、繁花公子、宠物合拍、生日主题、新春主题、冬日节庆、乐队主唱"],
  ["OUT-01", "outdoor", "都市街拍", "时尚街拍、痞帅街拍、潮流街拍、都市街拍、日常休闲、城市漫步、老街港风、绿意街拍、街角少年、彩色街拍、暖阳街角"],
  ["OUT-02", "outdoor", "城市夜景", "金色逆光夜景、城市夜景、雨幕街景、港风夜拍、雨夜电影、情绪隧道、暗系情绪、城市灯火、夜色光斑、机车夜巷、闪光街拍"],
  ["OUT-03", "outdoor", "森系自然", "森系文艺、海边少年、蓝调海岸、草地少年、山野旅人、湖边静坐、林间少年、草地暖阳、荒野秋日、雨幕少年、花树少年"],
  ["OUT-04", "outdoor", "都市硬朗", "炫酷机车、机车型格、公路机车、黑白机车、工业硬照、工业建筑、白墙建筑、站台冷调、正装旅人、街头漫步、围巾绅士"],
  ["OUT-05", "outdoor", "校园少年", "白衫学长、校园少年、操场青春、球衣少年、雨天学长、制服少年、雨伞少年、围巾少年、机车少年、海风少年、逆光少年"],
  ["OUT-06", "outdoor", "旅行电影", "正装外景、国风外景、山野武侠、白墙旅拍、雨城旅拍、建筑旅拍、城市空间、列车旅途、水岸旅人、林地旅拍、秋冬街拍"],
];

const riskyCopyTokens = new Map([
  ["ST-IN-01-07", ["红色背景", "确认"]],
  ["ST-IN-03-10", ["水影", "光线", "确认"]],
  ["ST-IN-06-03", ["彩色光影", "灯光", "确认"]],
  ["ST-IN-06-04", ["镜面", "反射", "确认"]],
  ["ST-IN-06-05", ["花艺", "花材", "确认"]],
  ["ST-IN-06-06", ["繁花", "花材", "确认"]],
  ["ST-IN-06-08", ["生日", "布景", "确认"]],
  ["ST-IN-06-09", ["新春", "节庆", "确认"]],
  ["ST-IN-06-10", ["冬日", "布景", "确认"]],
  ["ST-OUT-02-03", ["雨幕", "安全", "确认"]],
  ["ST-OUT-02-08", ["灯火", "环境", "确认"]],
  ["ST-OUT-02-09", ["光斑", "灯光", "确认"]],
]);

// Hand-reviewed, immutable inventory: each entry names the visual mechanism and its availability boundary.
const resourceEffectContract = new Map([
  ["ST-IN-01-04", ["西装", "确认"]], ["ST-IN-01-05", ["正装", "确认"]], ["ST-IN-01-06", ["西装", "确认"]],
  ["ST-IN-01-07", ["红色背景", "确认"]], ["ST-IN-01-08", ["西装", "确认"]], ["ST-IN-01-09", ["领带", "确认"]],
  ["ST-IN-02-03", ["光比", "确认"]], ["ST-IN-02-05", ["黑白", "确认"]], ["ST-IN-02-06", ["明暗", "确认"]],
  ["ST-IN-02-07", ["窗", "确认"]], ["ST-IN-02-09", ["冷调", "确认"]], ["ST-IN-02-10", ["暖调", "确认"]], ["ST-IN-02-11", ["白色背景", "确认"]],
  ["ST-IN-03-01", ["居家", "确认"]], ["ST-IN-03-05", ["白衫", "确认"]], ["ST-IN-03-06", ["针织", "确认"]],
  ["ST-IN-03-07", ["奶油", "确认"]], ["ST-IN-03-08", ["夏日", "确认"]], ["ST-IN-03-09", ["居家", "确认"]],
  ["ST-IN-03-10", ["水影", "确认"]], ["ST-IN-03-11", ["校园", "确认"]],
  ["ST-IN-04-01", ["拳击", "确认"]], ["ST-IN-04-04", ["网球", "确认"]], ["ST-IN-04-06", ["皮衣", "确认"]],
  ["ST-IN-04-05", ["战术", "到店确认"]],
  ["ST-IN-04-07", ["西装", "确认"]], ["ST-IN-04-08", ["湿发", "确认"]], ["ST-IN-04-09", ["机能", "确认"]],
  ["ST-IN-04-10", ["高街", "确认"]], ["ST-IN-04-11", ["朋克", "确认"]],
  ["ST-IN-05-01", ["复古", "确认"]], ["ST-IN-05-04", ["国风", "确认"]], ["ST-IN-05-05", ["武侠", "确认"]],
  ["ST-IN-05-06", ["红色背景", "确认"]], ["ST-IN-05-07", ["中式", "确认"]], ["ST-IN-05-08", ["暗色背景", "确认"]],
  ["ST-IN-05-09", ["书房", "确认"]], ["ST-IN-05-10", ["美式复古", "确认"]], ["ST-IN-05-11", ["胶片", "确认"]],
  ["ST-IN-06-01", ["赛博", "确认"]], ["ST-IN-06-03", ["彩色光影", "确认"]], ["ST-IN-06-04", ["镜面", "确认"]],
  ["ST-IN-06-05", ["花艺", "确认"]], ["ST-IN-06-06", ["繁花", "确认"]], ["ST-IN-06-07", ["宠物", "确认"]],
  ["ST-IN-06-08", ["生日", "确认"]], ["ST-IN-06-09", ["新春", "确认"]], ["ST-IN-06-10", ["冬日", "确认"]], ["ST-IN-06-11", ["节奏", "确认"]],
  ["ST-OUT-01-07", ["港风", "确认"]], ["ST-OUT-01-08", ["绿意", "确认"]], ["ST-OUT-01-10", ["彩色", "确认"]], ["ST-OUT-01-11", ["暖光", "确认"]],
  ["ST-OUT-02-01", ["金色逆光", "确认"]], ["ST-OUT-02-02", ["城市夜景", "确认"]], ["ST-OUT-02-03", ["雨幕", "确认"]],
  ["ST-OUT-02-04", ["港风", "确认"]], ["ST-OUT-02-05", ["雨后", "确认"]], ["ST-OUT-02-06", ["隧道", "确认"]],
  ["ST-OUT-02-07", ["暗调", "到店确认"]],
  ["ST-OUT-02-08", ["灯火", "确认"]], ["ST-OUT-02-09", ["光斑", "确认"]], ["ST-OUT-02-10", ["机车", "确认"]], ["ST-OUT-02-11", ["闪光灯", "确认"]],
  ["ST-OUT-03-01", ["绿意", "确认"]], ["ST-OUT-03-02", ["风感", "不承诺"]], ["ST-OUT-03-03", ["水岸", "确认"]],
  ["ST-OUT-03-04", ["草地", "确认"]], ["ST-OUT-03-05", ["山野", "确认"]], ["ST-OUT-03-06", ["湖边", "确认"]],
  ["ST-OUT-03-07", ["林间", "以现场为准"]], ["ST-OUT-03-08", ["草地", "确认"]], ["ST-OUT-03-09", ["秋日", "需结合"]],
  ["ST-OUT-03-10", ["天气", "需根据"]], ["ST-OUT-03-11", ["花期", "不作固定保证"]],
  ["ST-OUT-04-01", ["机车", "确认"]], ["ST-OUT-04-02", ["机车", "不承诺"]], ["ST-OUT-04-03", ["机车", "确认"]],
  ["ST-OUT-04-04", ["机车", "确认"]], ["ST-OUT-04-05", ["工业空间", "确认"]], ["ST-OUT-04-06", ["工业建筑", "确认"]],
  ["ST-OUT-04-07", ["白墙", "确认"]], ["ST-OUT-04-08", ["站台", "以现场为准"]], ["ST-OUT-04-09", ["正装", "确认"]],
  ["ST-OUT-04-10", ["街头", "确认"]], ["ST-OUT-04-11", ["围巾", "确认"]],
  ["ST-OUT-05-01", ["白色服装", "确认"]], ["ST-OUT-05-02", ["校园", "确认"]], ["ST-OUT-05-03", ["场地", "确认"]],
  ["ST-OUT-05-04", ["球衣", "确认"]], ["ST-OUT-05-05", ["雨幕", "确认"]], ["ST-OUT-05-06", ["制服", "确认"]],
  ["ST-OUT-05-07", ["雨伞", "确认"]], ["ST-OUT-05-08", ["围巾", "确认"]], ["ST-OUT-05-09", ["机车", "确认"]],
  ["ST-OUT-05-10", ["海风", "确认"]], ["ST-OUT-05-11", ["逆光", "确认"]],
  ["ST-OUT-06-01", ["正装", "确认"]], ["ST-OUT-06-02", ["环境", "确认"]], ["ST-OUT-06-03", ["武侠", "确认"]],
  ["ST-OUT-06-04", ["白墙", "另行确认"]], ["ST-OUT-06-05", ["雨城", "确认"]], ["ST-OUT-06-06", ["建筑", "确认"]],
  ["ST-OUT-06-07", ["城市空间", "确认"]], ["ST-OUT-06-08", ["交通工具", "确认"]], ["ST-OUT-06-09", ["水岸", "确认"]],
  ["ST-OUT-06-10", ["林地", "不作固定承诺"]], ["ST-OUT-06-11", ["秋冬", "需协商"]],
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

test("hand-reviewed production covers match the published visual promise", async () => {
  const catalog = await loadProductionCatalog();
  const assignments = JSON.parse(await readFile(
    new URL("../apps/portfolio-v2/style-slot-assignments.json", import.meta.url),
    "utf8",
  ));
  const reviewedCovers = new Map([
    ["ST-IN-02-05", ["黑白硬照", 12]],
    ["ST-OUT-02-01", ["金色逆光夜景", 85]],
    ["ST-OUT-03-03", ["蓝调海岸", 60]],
    ["ST-OUT-03-07", ["林间少年", 78]],
    ["ST-OUT-03-11", ["花树少年", 54]],
    ["ST-OUT-04-06", ["工业建筑", 55]],
  ]);

  for (const [styleId, [expectedLabel, expectedAssetId]] of reviewedCovers) {
    const style = catalog.styles.find(({ id }) => id === styleId);
    const assignment = assignments.assignments[styleId];
    const cover = assignment.slots[assignment.coverPosition - 1];
    assert.equal(style?.label, expectedLabel, `${styleId} label`);
    assert.equal(cover.assetId, expectedAssetId, `${styleId} cover`);
  }
});

test("every production family publishes eleven distinct covers", async () => {
  const catalog = await loadProductionCatalog();
  const assignments = JSON.parse(await readFile(
    new URL("../apps/portfolio-v2/style-slot-assignments.json", import.meta.url),
    "utf8",
  ));

  for (const family of catalog.families) {
    const covers = catalog.styles
      .filter((style) => style.familyId === family.id)
      .map((style) => {
        const assignment = assignments.assignments[style.id];
        return assignment.slots[assignment.coverPosition - 1].assetId;
      });
    assert.equal(covers.length, 11, `${family.id} must publish eleven covers`);
    assert.equal(new Set(covers).size, 11, `${family.id} covers must be unique: ${covers.join(",")}`);
  }
});

test("seed creates 1188 valid slot references without copying assets", async () => {
  const { buildSeedAssignments } = await loadSeedModule();
  assert.equal(typeof buildSeedAssignments, "function", "seed module must export buildSeedAssignments");
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = normalizeStyleCatalog(await loadProductionCatalog());
  const assets = buildPortfolioItems(portfolioCatalog);
  const seeded = buildSeedAssignments({ catalog, assets });

  assert.equal(Object.keys(seeded.assignments).length, 132);
  assert.equal(Object.values(seeded.assignments).flatMap((entry) => entry.slots).length, 1188);
  for (const style of catalog.styles) {
    const slots = seeded.assignments[style.id].slots;
    const ids = slots.map(({ assetId }) => assetId);
    assert.equal(ids.length, 9);
    assert.equal(new Set(ids).size, 9);
    assert.ok(ids.every((id) => assets.find((asset) => asset.id === id)?.scene === style.scene));
    assert.ok(slots.every(({ source }) => source === "seed"));
  }
  assert.equal(new Set(Object.values(seeded.assignments).flatMap((entry) => entry.slots.map(({ assetId }) => assetId))).size, 158);
});

test("seed keeps 11 family covers distinct in sequence and CLI audits 132 local image files", async () => {
  const { buildSeedAssignments } = await loadSeedModule();
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = normalizeStyleCatalog(await loadProductionCatalog());
  const seeded = buildSeedAssignments({ catalog, assets: buildPortfolioItems(portfolioCatalog) });
  for (const family of catalog.families) {
    const coverAssetIds = catalog.styles
      .filter((style) => style.familyId === family.id)
      .map((style) => seeded.assignments[style.id].slots[0].assetId);
    assert.equal(coverAssetIds.length, 11);
    for (let index = 1; index < coverAssetIds.length; index += 1) {
      assert.notEqual(coverAssetIds[index], coverAssetIds[index - 1], `${family.id} adjacent covers must differ`);
    }
  }

  const productionAssignmentsPath = resolve(repositoryRoot, "apps/portfolio-v2/style-slot-assignments.json");
  const assignmentsBeforeAudit = await readFile(productionAssignmentsPath);
  const { stdout } = await execFileAsync(process.execPath, ["tools/seed-portfolio-style-library.mjs", "--audit-only"], {
    cwd: repositoryRoot,
  });
  assert.match(stdout, /132 styles · 1188 slots · 158 assets/);
  assert.deepEqual(
    await readFile(productionAssignmentsPath),
    assignmentsBeforeAudit,
    "cover audit must not overwrite reviewed production assignments",
  );
  const report = JSON.parse(await readFile(resolve(repositoryRoot, ".local/portfolio-style-seed-report.json"), "utf8"));
  assert.deepEqual([report.styles, report.slots, report.assets], [132, 1188, 158]);
  const audit = await readFile(resolve(repositoryRoot, ".local/portfolio-style-cover-audit.html"), "utf8");
  const imageSources = [...audit.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(imageSources.length, 132);
  await Promise.all(imageSources.map((source) => access(resolve(repositoryRoot, ".local", source))));
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

test("all hand-reviewed resource and effect styles keep their mechanism and availability boundary", async () => {
  const { normalizeStyleCatalog } = await loadPublicContract();
  const catalog = normalizeStyleCatalog(await loadProductionCatalog());
  const styleById = new Map(catalog.styles.map((style) => [style.id, style]));
  for (const [styleId, [mechanism, boundary]] of resourceEffectContract) {
    const description = styleById.get(styleId)?.description || "";
    assert.ok(description.includes(mechanism), `${styleId} must include mechanism ${mechanism}`);
    assert.ok(description.includes(boundary), `${styleId} must include boundary ${boundary}`);
  }
  assert.equal(resourceEffectContract.size, 108);
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

test("explicit public slot identity stays attached to the same asset after assignment reorder", async () => {
  const { buildStyleLibrary } = await loadPublicContract();
  const assignments = fixtureAssignments();
  const styleId = "ST-IN-01-01";
  const layout = assignments.assignments[styleId];
  layout.slotIds = Array.from({ length: 9 }, (_, index) => `${styleId}-P${String(index + 1).padStart(2, "0")}`);
  [layout.slots[0], layout.slots[1]] = [layout.slots[1], layout.slots[0]];
  [layout.slotIds[0], layout.slotIds[1]] = [layout.slotIds[1], layout.slotIds[0]];
  layout.coverPosition = 2;

  const library = buildStyleLibrary({
    catalog: fixtureStyleCatalog(),
    assignments,
    assets: fixtureAssets(),
  });

  assert.deepEqual(
    library.styles.find(({ id }) => id === styleId).slots.slice(0, 2).map(({ id, assetId, position, isCover }) => ({
      id,
      assetId,
      position,
      isCover,
    })),
    [
      { id: `${styleId}-P02`, assetId: 2, position: 1, isCover: false },
      { id: `${styleId}-P01`, assetId: 1, position: 2, isCover: true },
    ],
  );
});

test("public assignment validation rejects duplicate and foreign slot identity", async () => {
  const { normalizeStyleAssignments } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  const assetMap = new Map(fixtureAssets().map((asset) => [asset.id, asset]));
  const assignments = fixtureAssignments();
  const styleId = "ST-IN-01-01";
  const layout = assignments.assignments[styleId];
  layout.slotIds = Array.from({ length: 9 }, (_, index) => `${styleId}-P${String(index + 1).padStart(2, "0")}`);

  layout.slotIds[1] = `${styleId}-P01`;
  assert.throws(() => normalizeStyleAssignments(assignments, catalog, assetMap), /照片位身份.*重复|重复.*照片位身份/);

  layout.slotIds[1] = "ST-IN-01-02-P02";
  assert.throws(() => normalizeStyleAssignments(assignments, catalog, assetMap), /照片位身份.*不属于|不属于.*照片位身份/);
});

test("hidden is the only non-public style visibility and customer counts plus featured omit it", async () => {
  const { buildStyleLibrary, normalizeStyleCatalog } = await loadPublicContract();
  const catalog = fixtureStyleCatalog();
  catalog.styles.find(({ id }) => id === "ST-IN-01-01").visibility = "hidden";
  const library = buildStyleLibrary({
    catalog,
    assignments: fixtureAssignments(),
    assets: fixtureAssets(),
  });

  assert.equal(library.styles.find(({ id }) => id === "ST-IN-01-01").visibility, "hidden");
  assert.equal(library.counts.styles, 131);
  assert.equal(library.counts.publishedStyles, 131);
  assert.equal(library.counts.indoor, 65);
  assert.equal(library.counts.outdoor, 66);
  assert.equal(library.featuredStyleIds.includes("ST-IN-01-01"), false);

  const legacy = fixtureStyleCatalog();
  legacy.styles[0].visibility = "archived";
  assert.throws(() => normalizeStyleCatalog(legacy), /ST-IN-01-01.*可见性/);
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

test("style documents fall back without removing the 158-photo legacy gallery", async () => {
  const { loadPortfolioDocument } = await import("../apps/portfolio-v2/portfolio-runtime.js");
  const warnings = [];
  const fallback = { schemaVersion: 1, families: [], styles: [] };
  const result = await loadPortfolioDocument({
    fetchImpl: async () => { throw new Error("offline"); },
    url: "./style-catalog.json",
    fallback,
    label: "风格目录",
    warn: (...args) => warnings.push(args),
  });
  assert.equal(result, fallback);
  assert.equal(buildPortfolioItems(portfolioCatalog).length, 158);
  assert.equal(warnings.length, 1);
});

test("invalid style documents disable only the style library", async () => {
  const { buildCustomerStyleLibrary } = await import("../apps/portfolio-v2/portfolio-runtime.js");
  const warnings = [];
  const legacyItems = buildPortfolioItems(portfolioCatalog);
  const library = buildCustomerStyleLibrary({
    styleCatalog: { schemaVersion: 1, families: [], styles: [] },
    assignments: { schemaVersion: 1, assignments: {} },
    assets: legacyItems,
    fallback: null,
    warn: (...args) => warnings.push(args),
  });
  assert.equal(library, null);
  assert.equal(legacyItems.length, 158);
  assert.equal(warnings.length, 1);
});

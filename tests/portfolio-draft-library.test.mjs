import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPortfolioItems,
  buildPortfolioThemes,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import { createDraftStore } from "../tools/portfolio-draft-store.mjs";

test("空增量保持 158 张、23 个主题和原顺序", async () => {
  const additions = JSON.parse(await readFile(new URL("../apps/portfolio-v2/catalog-additions.json", import.meta.url), "utf8"));
  const items = buildPortfolioItems(portfolioCatalog, additions);
  assert.equal(items.length, 158);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).length, 23);
  assert.deepEqual(items.map(({ id }) => id), buildPortfolioItems(portfolioCatalog).map(({ id }) => id));
});

test("公开增量只接受唯一、连续范围外编号", () => {
  assert.throws(() => normalizePortfolioAdditions({ schemaVersion: 1, themes: [], photos: [
    { id: 158, scene: "indoor", theme: "magazine", category: "business", visibility: "published" },
  ] }), /NB-158/);
});

test("已公开新增照片被追加，隐藏照片和无封面主题不显示", () => {
  const additions = {
    schemaVersion: 1,
    themes: [
      { id: "new-light", scene: "indoor", label: "新光影", description: "新主题", coverPhotoId: 159 },
      { id: "empty-theme", scene: "outdoor", label: "空主题", description: "不显示", coverPhotoId: 160 },
    ],
    photos: [
      { id: 159, scene: "indoor", theme: "new-light", category: "mood", title: "新光影", styleTitle: "情绪", visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 160, scene: "outdoor", theme: "empty-theme", category: "relaxed", title: "空主题", styleTitle: "松弛", visibility: "archived", publishedAt: "2026-08-31T00:00:00.000Z" },
    ],
  };
  assert.equal(buildPortfolioItems(portfolioCatalog, additions).at(-1).id, 159);
  assert.equal(buildPortfolioItems(portfolioCatalog, additions).length, 159);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "new-light"), true);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "empty-theme"), false);
});

test("公开增量拒绝草稿和未知可见性", () => {
  for (const visibility of ["draft", "private"]) {
    assert.throws(() => normalizePortfolioAdditions({ schemaVersion: 1, themes: [], photos: [
      { id: 159, scene: "indoor", theme: "new-light", category: "mood", visibility },
    ] }), /可见性/);
  }
});

test("新增主题的封面必须是本主题的已公开照片", () => {
  const additions = {
    schemaVersion: 1,
    themes: [{ id: "new-light", scene: "indoor", label: "新光影", description: "新主题", coverPhotoId: 159 }],
    photos: [
      { id: 159, scene: "indoor", theme: "other-light", category: "mood", visibility: "published" },
      { id: 160, scene: "indoor", theme: "new-light", category: "mood", visibility: "published" },
    ],
  };
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "new-light"), false);
});

test("公开增量拒绝空、非 slug 和重复主题编号", () => {
  for (const themes of [
    [{ id: "", coverPhotoId: 159 }],
    [{ id: "New Light", coverPhotoId: 159 }],
    [{ id: "magazine", coverPhotoId: 159 }],
    [{ id: "new-light", coverPhotoId: 159 }, { id: "new-light", coverPhotoId: 160 }],
  ]) {
    assert.throws(() => normalizePortfolioAdditions({ schemaVersion: 1, themes, photos: [] }), /主题编号/);
  }
});

test("草稿从 NB-159 开始且不会复用归档编号", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });

  assert.equal(await store.allocateId([]), 159);
  await store.addPhoto({
    id: 159,
    uuid: "photo-a",
    originalName: "a.jpg",
    customerName: "客户",
    phone: "电话",
    wechat: "微信",
  });
  await store.transitionPhoto(159, "archived");

  assert.equal(await store.allocateId([]), 160);
  assert.doesNotMatch(await readFile(join(directory, "manifest.json"), "utf8"), /客户|电话|微信/);
});

test("未归类或未确认授权的草稿不能进入 ready", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });

  await store.addPhoto({ id: 159, uuid: "photo-a", originalName: "a.jpg" });

  await assert.rejects(() => store.transitionPhoto(159, "ready"), /场景、主题、风格和公开授权/);
});

test("空草稿库可读取且新主题只保存定义字段", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });

  assert.deepEqual(await store.read(), { schemaVersion: 1, photos: [], themes: [] });
  await store.addTheme({
    id: "new-light",
    label: "新光影",
    scene: "indoor",
    description: "新主题",
    customerName: "客户",
  });

  const [theme] = (await store.read()).themes;
  assert.deepEqual(Object.keys(theme).sort(), ["createdAt", "description", "id", "label", "scene", "updatedAt"]);
});

test("草稿状态只允许定义过的转换", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });

  await store.addPhoto({
    id: 159,
    uuid: "photo-a",
    originalName: "a.jpg",
    scene: "indoor",
    theme: "magazine",
    category: "business",
    approvedForPublicUse: true,
  });
  await assert.rejects(() => store.transitionPhoto(159, "published"), /draft.*published/);
  await store.transitionPhoto(159, "ready");

  assert.equal((await store.read()).photos[0].status, "ready");
});

test("并发分配两张草稿时保留 NB-159 和 NB-160", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });

  const [firstId, secondId] = await Promise.all([store.allocateId([]), store.allocateId([])]);
  await Promise.all([
    store.addPhoto({ id: firstId, uuid: "photo-a", originalName: "a.jpg" }),
    store.addPhoto({ id: secondId, uuid: "photo-b", originalName: "b.jpg" }),
  ]);

  assert.deepEqual((await store.read()).photos.map(({ id }) => id), [159, 160]);
});

test("元数据更新允许首页推荐但不允许借通用补丁写入发布内部字段", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  await store.addPhoto({
    id: 159,
    uuid: "photo-a",
    originalName: "a.jpg",
    scene: "indoor",
    theme: "magazine",
    category: "business",
    approvedForPublicUse: true,
  });

  await store.updatePhoto(159, { featured: true });
  await assert.rejects(() => store.updatePhoto(159, { stagedAt: "2026-08-31T00:00:00.000Z" }), /stagedAt/);
  await assert.rejects(() => store.updatePhoto(159, { publishedCommit: "abc123" }), /publishedCommit/);

  const [photo] = (await store.read()).photos;
  assert.equal(photo.featured, true);
  assert.equal("stagedAt" in photo, false);
  assert.equal("publishedCommit" in photo, false);
});

test("专用发布标记保留待公开状态并在推送后记录提交", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  await store.addPhoto({
    id: 159,
    uuid: "photo-a",
    originalName: "a.jpg",
    scene: "indoor",
    theme: "magazine",
    category: "business",
    approvedForPublicUse: true,
  });
  await store.transitionPhoto(159, "ready");

  await store.markStaged(159, "2026-08-31T00:00:00.000Z");
  assert.equal((await store.read()).photos[0].status, "ready");
  await store.markPublished([159], "abc123");

  const [photo] = (await store.read()).photos;
  assert.equal(photo.status, "published");
  assert.equal(photo.stagedAt, "2026-08-31T00:00:00.000Z");
  assert.equal(photo.publishedCommit, "abc123");
});

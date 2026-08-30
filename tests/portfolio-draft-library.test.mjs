import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPortfolioItems,
  buildPortfolioThemes,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";

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

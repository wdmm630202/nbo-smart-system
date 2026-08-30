import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildPortfolioItems,
  buildPortfolioThemes,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import { createDraftStore } from "../tools/portfolio-draft-store.mjs";
import {
  ingestDraftPhoto,
  loadPublicAdditions,
  recoverIncompletePublicationTransactions,
  setPublishedPhotoVisibility,
  stageDraftForPublication,
} from "../tools/portfolio-draft-photo-lib.mjs";

const execFileAsync = promisify(execFile);

async function createTestPhoto(directory, name = "source.jpg") {
  const path = join(directory, name);
  await execFileAsync("/Users/nanbosheyingimacpro/.local/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=#334455:s=900x1200",
    "-frames:v", "1", path,
  ]);
  return path;
}

async function createPublicationSandbox(t) {
  const rootDir = await mkdtemp(join(tmpdir(), "nanbo-publication-"));
  const draftRoot = join(rootDir, "drafts");
  const publicPhotoRoot = join(rootDir, "public");
  const publicationTransactionRoot = join(rootDir, "publication-transactions");
  const additionsPath = join(rootDir, "catalog-additions.json");
  const store = createDraftStore({ rootDir: join(rootDir, "manifest"), legacyMaxId: 158 });
  await mkdir(publicPhotoRoot, { recursive: true });
  await writeFile(additionsPath, `${JSON.stringify({ schemaVersion: 1, themes: [], photos: [] }, null, 2)}\n`);
  const source = await createTestPhoto(rootDir);
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  return {
    additionsPath,
    draftRoot,
    publicPhotoRoot,
    store,
    source,
    publicationTransactionRoot,
    options: { store, draftRoot, additionsPath, publicPhotoRoot, publicationTransactionRoot },
    publicAssetPaths(id) {
      const base = `photo-${String(id).padStart(3, "0")}`;
      return {
        full: join(publicPhotoRoot, "full", `${base}.jpg`),
        thumb: join(publicPhotoRoot, "thumbs", `${base}.webp`),
      };
    },
    async ingestAndReady(overrides = {}) {
      const draft = await ingestDraftPhoto({
        inputPath: source,
        originalName: overrides.originalName || "客户李先生_WeChat123.jpg",
        contentType: "image/jpeg",
        store,
        rootDir: draftRoot,
        publicIds: [],
      });
      await store.updatePhoto(draft.id, {
        scene: overrides.scene || "indoor",
        theme: overrides.theme || "magazine",
        category: overrides.category || "mood",
        approvedForPublicUse: true,
        featured: overrides.featured === true,
      });
      return store.transitionPhoto(draft.id, "ready");
    },
  };
}

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

test("上传合格图片只生成本地草稿，不创建 photo-159 公开文件", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-images-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: join(directory, "manifest"), legacyMaxId: 158 });
  const source = await createTestPhoto(directory);

  const record = await ingestDraftPhoto({
    inputPath: source,
    originalName: "客户王先生_13800138000.jpg",
    contentType: "image/jpeg",
    store,
    rootDir: join(directory, "draft-assets"),
    publicIds: [],
  });

  assert.equal(record.id, 159);
  assert.equal(record.status, "draft");
  assert.match(record.uuid, /^[0-9a-f]{24}$/);
  assert.equal((await stat(join(directory, "draft-assets/assets/full", `${record.uuid}.jpg`))).isFile(), true);
  assert.equal((await stat(join(directory, "draft-assets/assets/thumbs", `${record.uuid}.webp`))).isFile(), true);
  await assert.rejects(() => stat(join(directory, "public/full/photo-159.jpg")), /ENOENT/);

  const manifest = await readFile(join(directory, "manifest/manifest.json"), "utf8");
  assert.doesNotMatch(manifest, /王先生|13800138000|source\.jpg|draft-assets/);
  assert.equal(JSON.parse(manifest).photos[0].originalName, "NB-159.jpg");
  assert.equal(record.selectedName, "客户王先生_13800138000.jpg");
});

test("草稿上传同时要求允许的扩展名和 MIME", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-format-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await createTestPhoto(directory);

  for (const [index, [originalName, contentType]] of [["source.gif", "image/gif"], ["source.jpg", "application/octet-stream"]].entries()) {
    const store = createDraftStore({ rootDir: join(directory, `manifest-${index}`), legacyMaxId: 158 });
    await assert.rejects(() => ingestDraftPhoto({
      inputPath: source,
      originalName,
      contentType,
      store,
      rootDir: join(directory, `drafts-${index}`),
      publicIds: [],
    }), /只支持 JPG、PNG 或 WebP/);
  }
});

test("伪装成 JPG 扩展名和 MIME 的 GIF 不能进入草稿库", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-disguised-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const disguisedGif = await createTestPhoto(directory, "actual.gif");
  const store = createDraftStore({ rootDir: join(directory, "manifest"), legacyMaxId: 158 });

  await assert.rejects(() => ingestDraftPhoto({
    inputPath: disguisedGif,
    originalName: "fake.jpg",
    contentType: "image/jpeg",
    store,
    rootDir: join(directory, "drafts"),
    publicIds: [],
  }), /实际格式.*JPG/);
});

test("瞬时返回的选择文件名只保留 basename", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-basename-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await createTestPhoto(directory);
  const store = createDraftStore({ rootDir: join(directory, "manifest"), legacyMaxId: 158 });

  const record = await ingestDraftPhoto({
    inputPath: source,
    originalName: "/Users/customer/private/客户王先生_13800138000.jpg",
    contentType: "image/jpeg",
    store,
    rootDir: join(directory, "drafts"),
    publicIds: [],
  });

  assert.equal(record.selectedName, "客户王先生_13800138000.jpg");
  assert.doesNotMatch(JSON.stringify(record), /\/Users\/customer\/private/);
});

test("草稿上传拒绝超过 50 MB 的单张图片", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-size-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await createTestPhoto(directory, "oversized.jpg");
  await appendFile(source, Buffer.alloc(50 * 1024 * 1024));
  const store = createDraftStore({ rootDir: join(directory, "manifest"), legacyMaxId: 158 });

  await assert.rejects(() => ingestDraftPhoto({
    inputPath: source,
    originalName: "oversized.jpg",
    contentType: "image/jpeg",
    store,
    rootDir: join(directory, "drafts"),
    publicIds: [],
  }), /50 MB/);
});

test("ready 草稿成套进入公开增量，隐藏与恢复保留 NB-159", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  const draft = await sandbox.ingestAndReady({ featured: true });

  await stageDraftForPublication(draft.id, sandbox.options);
  let additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.equal(additions.photos[0].id, 159);
  assert.equal(additions.photos[0].visibility, "published");
  assert.equal(additions.photos[0].featured, true);
  assert.deepEqual(Object.keys(additions.photos[0]).sort(), [
    "category", "featured", "id", "publishedAt", "scene", "styleTitle", "theme", "title", "visibility",
  ]);
  assert.equal((await stat(sandbox.publicAssetPaths(159).full)).isFile(), true);
  assert.equal((await stat(sandbox.publicAssetPaths(159).thumb)).isFile(), true);
  assert.equal((await sandbox.store.read()).photos[0].status, "ready");
  assert.equal(typeof (await sandbox.store.read()).photos[0].stagedAt, "string");
  assert.doesNotMatch(JSON.stringify(additions), /客户李先生|WeChat123|uuid|originalName|approvedForPublicUse|stagedAt|draftRoot|Path/);

  await setPublishedPhotoVisibility(159, "archived", sandbox.options);
  additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.equal(additions.photos[0].visibility, "archived");
  await setPublishedPhotoVisibility(159, "published", sandbox.options);
  additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.equal(additions.photos[0].id, 159);
  assert.equal(additions.photos[0].visibility, "published");
});

test("新主题的第一张已公开照片自动成为有效封面", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  await sandbox.store.addTheme({
    id: "new-light",
    label: "新光影",
    scene: "outdoor",
    description: "新主题",
  });
  const draft = await sandbox.ingestAndReady({ scene: "outdoor", theme: "new-light", category: "relaxed" });

  await stageDraftForPublication(draft.id, sandbox.options);

  const additions = await loadPublicAdditions(sandbox.additionsPath);
  assert.deepEqual(additions.themes, [{
    id: "new-light",
    scene: "outdoor",
    label: "新光影",
    description: "新主题",
    coverPhotoId: 159,
  }]);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "new-light"), true);
});

test("待公开记账失败时回滚公开图片和增量清单", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  const draft = await sandbox.ingestAndReady();
  const failingStore = {
    ...sandbox.store,
    async markStaged() {
      throw new Error("模拟记账失败");
    },
  };

  await assert.rejects(
    () => stageDraftForPublication(draft.id, { ...sandbox.options, store: failingStore }),
    /模拟记账失败/,
  );

  assert.deepEqual(await loadPublicAdditions(sandbox.additionsPath), { schemaVersion: 1, themes: [], photos: [] });
  await assert.rejects(() => stat(sandbox.publicAssetPaths(159).full), /ENOENT/);
  await assert.rejects(() => stat(sandbox.publicAssetPaths(159).thumb), /ENOENT/);
});

test("中断的公开事务可恢复原清单和资产，且下次待公开可继续", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  const draft = await sandbox.ingestAndReady();
  const originalAdditions = await readFile(sandbox.additionsPath, "utf8");
  const transactionDir = join(sandbox.publicationTransactionRoot, "photo-159-interrupted");
  await mkdir(transactionDir, { recursive: true });
  await writeFile(join(transactionDir, "before-additions.json"), originalAdditions);
  await writeFile(join(transactionDir, "transaction.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "stage",
    id: 159,
    status: "committing",
  }, null, 2)}\n`);
  await mkdir(join(sandbox.publicPhotoRoot, "full"), { recursive: true });
  await copyFile(
    join(sandbox.draftRoot, "assets/full", `${draft.uuid}.jpg`),
    sandbox.publicAssetPaths(159).full,
  );
  await writeFile(sandbox.additionsPath, `${JSON.stringify({
    schemaVersion: 1,
    themes: [],
    photos: [{
      id: 159,
      scene: "indoor",
      theme: "magazine",
      category: "mood",
      title: "杂志肖像",
      styleTitle: "情绪",
      featured: false,
      visibility: "published",
      publishedAt: "2026-08-31T00:00:00.000Z",
    }],
  }, null, 2)}\n`);

  const recovered = await recoverIncompletePublicationTransactions(sandbox.options);

  assert.deepEqual(recovered, ["NB-159"]);
  assert.equal(await readFile(sandbox.additionsPath, "utf8"), originalAdditions);
  await assert.rejects(() => stat(sandbox.publicAssetPaths(159).full), /ENOENT/);
  await assert.rejects(() => stat(sandbox.publicAssetPaths(159).thumb), /ENOENT/);

  await stageDraftForPublication(159, sandbox.options);
  assert.equal((await loadPublicAdditions(sandbox.additionsPath)).photos[0].id, 159);
  assert.equal((await stat(sandbox.publicAssetPaths(159).full)).isFile(), true);
  assert.equal((await stat(sandbox.publicAssetPaths(159).thumb)).isFile(), true);
});

test("已提交事务的日志清理失败不会把成功待公开误报为失败", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  const draft = await sandbox.ingestAndReady();
  const cleanupFailStore = {
    ...sandbox.store,
    async markStaged(...args) {
      const result = await sandbox.store.markStaged(...args);
      await chmod(sandbox.publicationTransactionRoot, 0o555);
      return result;
    },
  };

  try {
    const publicPhoto = await stageDraftForPublication(draft.id, { ...sandbox.options, store: cleanupFailStore });
    assert.equal(publicPhoto.id, 159);
    assert.equal((await loadPublicAdditions(sandbox.additionsPath)).photos[0].id, 159);
    assert.equal((await stat(sandbox.publicAssetPaths(159).full)).isFile(), true);
    assert.equal((await stat(sandbox.publicAssetPaths(159).thumb)).isFile(), true);
  } finally {
    await chmod(sandbox.publicationTransactionRoot, 0o755);
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

test("待公开草稿不能通过更新取消公开授权", async (t) => {
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

  await assert.rejects(() => store.updatePhoto(159, { approvedForPublicUse: false }), /场景、主题、风格和公开授权/);

  const [photo] = (await store.read()).photos;
  assert.equal(photo.status, "ready");
  assert.equal(photo.approvedForPublicUse, true);
});

test("发布标记会重新验证待公开草稿的授权", async (t) => {
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
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.photos[0].approvedForPublicUse = false;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(() => store.markPublished([159], "abc123"), /场景、主题、风格和公开授权/);
});

test("归档草稿不能通过通用状态转换直接发布", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });
  await store.addPhoto({ id: 159, uuid: "photo-a", originalName: "a.jpg" });
  await store.transitionPhoto(159, "archived");

  await assert.rejects(() => store.transitionPhoto(159, "published"), /archived.*published/);

  assert.equal((await store.read()).photos[0].status, "archived");
});

test("已发布后归档的客片可通过专用发布标记按原编号恢复", async (t) => {
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
  await store.markPublished([159], "first-commit");
  await store.transitionPhoto(159, "archived");

  await store.markPublished([159], "restore-commit");

  const [photo] = (await store.read()).photos;
  assert.equal(photo.id, 159);
  assert.equal(photo.status, "published");
  assert.equal(photo.publishedCommit, "restore-commit");
});

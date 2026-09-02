import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  backupRoot,
  buildPortfolioVersion,
  createPortfolioPhotoStore,
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

function assertPublicPhotoMutationRecord(value, privateRoots = []) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /"backupDir"\s*:/);
  assert.doesNotMatch(serialized, /(?:\/(?:Users|private|var|tmp)\/|[A-Za-z]:\\\\|\\\\\\\\)/);
  for (const privateRoot of privateRoots) {
    assert.equal(serialized.includes(privateRoot), false, `公开换图记录泄露了本机路径 ${privateRoot}`);
  }
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

async function createStylePublicationFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-style-publication-"));
  const styleCatalogPath = join(directory, "style-catalog.json");
  const styleAssignmentsPath = join(directory, "style-slot-assignments.json");
  const styleTransactionRoot = join(directory, ".local/portfolio-style-transactions");
  const [catalog, assignments] = await Promise.all([
    readFile(join(root, "apps/portfolio-v2/style-catalog.json"), "utf8").then(JSON.parse),
    readFile(join(root, "apps/portfolio-v2/style-slot-assignments.json"), "utf8").then(JSON.parse),
  ]);
  await mkdir(styleTransactionRoot, { recursive: true });
  await Promise.all([
    writeFile(styleCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(styleAssignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    catalog,
    assignments,
    directory,
    styleCatalogPath,
    styleAssignmentsPath,
    styleTransactionRoot,
    async save() {
      await Promise.all([
        writeFile(styleCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
        writeFile(styleAssignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`),
      ]);
    },
    options() {
      return { styleCatalogPath, styleAssignmentsPath, styleTransactionRoot };
    },
  };
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

function uploadedStyleAdditions(count) {
  return {
    schemaVersion: 1,
    themes: [],
    photos: Array.from({ length: count }, (_, index) => ({
      id: 159 + index,
      scene: "indoor",
      theme: "magazine",
      category: "business",
      title: `上传客片 ${index + 1}`,
      styleTitle: "杂志肖像",
      featured: false,
      visibility: "published",
      publishedAt: `2026-09-02T00:${String(index).padStart(2, "0")}:00.000Z`,
    })),
  };
}

async function createProvenUploadStyleFixture(t, { count, maturity, confirmed = false }) {
  const styleFixture = await createStylePublicationFixture(t);
  const photoFixture = await createAdditionsLibraryFixture(t, uploadedStyleAdditions(count));
  const styleId = "ST-IN-01-01";
  const layout = styleFixture.assignments.assignments[styleId];
  const assetIds = Array.from({ length: count }, (_, index) => 159 + index);
  const now = "2026-09-02T01:00:00.000Z";
  for (let index = 0; index < count; index += 1) {
    layout.slots[index] = {
      ...layout.slots[index],
      assetId: assetIds[index],
      source: "upload",
      updatedAt: now,
    };
  }
  layout.maturity = maturity;
  layout.updatedAt = now;
  await styleFixture.save();

  const originDirectory = join(styleFixture.styleTransactionRoot, "upload-origin");
  await mkdir(originDirectory, { recursive: true });
  await writeFile(join(originDirectory, "meta.json"), `${JSON.stringify(count === 1 ? {
    status: "committed",
    operation: "replace-slot",
    slotId: `${styleId}-P01`,
    assetId: assetIds[0],
  } : {
    status: "committed",
    operation: "replace-style-batch",
    styleId,
    assetIds,
  })}\n`);
  if (confirmed) {
    const confirmationDirectory = join(styleFixture.styleTransactionRoot, "public-confirmation");
    await mkdir(confirmationDirectory, { recursive: true });
    await writeFile(join(confirmationDirectory, "meta.json"), `${JSON.stringify({
      status: "committed",
      operation: "update-layout",
      maturity: "complete",
      styleId,
      assetIds,
    })}\n`);
  }
  return {
    styleId,
    options: {
      ...styleFixture.options(),
      ...photoFixture,
    },
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

function runNodeScript(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
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

test("public validation includes the complete 132-style and 1188-slot manifests", async () => {
  const result = await validatePortfolioLibrary();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.styleCount, 132);
  assert.equal(result.styleSlotCount, 1188);
  assert.equal(result.uniqueStyleAssetCount, 158);
});

test("portfolio validation CLI and aggregate suite expose the complete style contract", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const aggregate = packageJson.scripts["portfolio:test"];
  assert.match(aggregate, /--test-concurrency=1/);
  for (const filename of [
    "tests/portfolio-style-library.test.mjs",
    "tests/portfolio-style-explorer.test.mjs",
    "tests/portfolio-style-manager.test.mjs",
  ]) assert.match(aggregate, new RegExp(filename.replaceAll(".", "\\.")));

  const result = await runNodeScript("tools/validate-portfolio-photos.mjs");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /158 unique assets · 132 styles · 1188 slots/);
});

test("style publication rejects missing, unsafe, unknown, duplicate, and forged assignment state with stable IDs", async (t) => {
  const cases = [
    {
      name: "missing style assignment",
      mutate({ assignments }) { delete assignments.assignments["ST-OUT-06-11"]; },
      pattern: /ST-OUT-06-11/,
    },
    {
      name: "unknown asset",
      mutate({ assignments }) { assignments.assignments["ST-IN-01-01"].slots[2].assetId = 9999; },
      pattern: /ST-IN-01-01-P03.*NB-9999|ST-IN-01-01-P03.*9999/,
    },
    {
      name: "duplicate asset in one album",
      mutate({ assignments }) {
        assignments.assignments["ST-IN-01-01"].slots[1].assetId = assignments.assignments["ST-IN-01-01"].slots[0].assetId;
      },
      pattern: /ST-IN-01-01-P02.*重复/,
    },
    {
      name: "invalid cover",
      mutate({ assignments }) { assignments.assignments["ST-IN-01-01"].coverPosition = 10; },
      pattern: /ST-IN-01-01.*封面/,
    },
    {
      name: "private slot field",
      mutate({ assignments }) { assignments.assignments["ST-IN-01-01"].slots[0]._slotId = "/Users/private/photo.jpg"; },
      pattern: /ST-IN-01-01-P01.*_slotId/,
    },
    {
      name: "missing public slot identity",
      mutate({ assignments }) { delete assignments.assignments["ST-IN-01-01"].slotIds; },
      pattern: /ST-IN-01-01.*照片位身份.*缺少/,
    },
    {
      name: "duplicate public slot identity",
      mutate({ assignments }) {
        assignments.assignments["ST-IN-01-01"].slotIds[1] = assignments.assignments["ST-IN-01-01"].slotIds[0];
      },
      pattern: /ST-IN-01-01.*照片位身份.*重复/,
    },
    {
      name: "foreign public slot identity",
      mutate({ assignments }) { assignments.assignments["ST-IN-01-01"].slotIds[1] = "ST-IN-01-02-P02"; },
      pattern: /ST-IN-01-01.*照片位身份.*不属于/,
    },
    {
      name: "private catalog field",
      mutate({ catalog }) { catalog.slotIdentities = { local: true }; },
      pattern: /slotIdentities/,
    },
    {
      name: "upload without timestamp",
      mutate({ assignments }) { assignments.assignments["ST-IN-01-01"].slots[0].source = "upload"; },
      pattern: /ST-IN-01-01-P01.*upload.*时间/,
    },
    {
      name: "forged maturity",
      mutate({ assignments }) { assignments.assignments["ST-IN-01-01"].maturity = "updating"; },
      pattern: /ST-IN-01-01.*成熟度/,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async (subtest) => {
      const fixture = await createStylePublicationFixture(subtest);
      entry.mutate(fixture);
      await fixture.save();
      const result = await validatePortfolioLibrary(fixture.options());
      assert.equal(result.ok, false, entry.name);
      assert.match(result.errors.join("\n"), entry.pattern, entry.name);
    });
  }
});

test("complete maturity requires same-style upload history and explicit confirmation proof", async (t) => {
  const fixture = await createStylePublicationFixture(t);
  const styleId = "ST-IN-01-01";
  const layout = fixture.assignments.assignments[styleId];
  const now = "2026-09-02T00:00:00.000Z";
  layout.slots.forEach((slot) => {
    slot.source = "upload";
    slot.updatedAt = now;
  });
  layout.updatedAt = now;
  layout.maturity = "complete";
  await fixture.save();

  const withoutProof = await validatePortfolioLibrary(fixture.options());
  assert.equal(withoutProof.ok, false);
  assert.match(withoutProof.errors.join("\n"), /ST-IN-01-01.*事务|事务.*ST-IN-01-01/);
});

test("every upload slot requires a published addition and same-style transaction proof while updating", async (t) => {
  const fixture = await createStylePublicationFixture(t);
  const styleId = "ST-IN-01-01";
  const layout = fixture.assignments.assignments[styleId];
  layout.slots[0] = {
    ...layout.slots[0],
    source: "upload",
    updatedAt: "2026-09-02T01:00:00.000Z",
  };
  layout.maturity = "updating";
  await fixture.save();

  const result = await validatePortfolioLibrary(fixture.options());
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /ST-IN-01-01-P01.*公开增量.*事务|ST-IN-01-01-P01.*事务.*公开增量/);
});

test("stored maturity matches zero, partial, unconfirmed-nine, and confirmed-nine upload proof", async (t) => {
  const partial = await createProvenUploadStyleFixture(t, { count: 1, maturity: "updating" });
  const partialResult = await validatePortfolioLibrary(partial.options);
  assert.equal(partialResult.ok, true, partialResult.errors.join("\n"));

  const unconfirmedNine = await createProvenUploadStyleFixture(t, { count: 9, maturity: "updating" });
  const unconfirmedResult = await validatePortfolioLibrary(unconfirmedNine.options);
  assert.equal(unconfirmedResult.ok, true, unconfirmedResult.errors.join("\n"));

  const confirmedButUpdating = await createProvenUploadStyleFixture(t, {
    count: 9,
    maturity: "updating",
    confirmed: true,
  });
  const forgedResult = await validatePortfolioLibrary(confirmedButUpdating.options);
  assert.equal(forgedResult.ok, false);
  assert.match(forgedResult.errors.join("\n"), /ST-IN-01-01.*成熟度必须为 complete/);

  const complete = await createProvenUploadStyleFixture(t, { count: 9, maturity: "complete", confirmed: true });
  const completeResult = await validatePortfolioLibrary(complete.options);
  assert.equal(completeResult.ok, true, completeResult.errors.join("\n"));
});

test("public style manifests reject local absolute paths but keep relative public references", async (t) => {
  const rejected = [
    "/tmp/customer-secret.jpg",
    "/var/folders/qn/customer-secret.jpg",
    "C:\\Users\\customer\\secret.jpg",
    "\\\\server\\share\\secret.jpg",
    "//server/share/secret.jpg",
    "file:///tmp/customer-secret.jpg",
  ];
  for (const value of rejected) {
    await t.test(`rejects ${value}`, async (subtest) => {
      const fixture = await createStylePublicationFixture(subtest);
      fixture.assignments.assignments["ST-IN-01-01"].slots[0].poseLabel = value;
      await fixture.save();
      const result = await validatePortfolioLibrary(fixture.options());
      assert.equal(result.ok, false, value);
      assert.match(result.errors.join("\n"), /ST-IN-01-01-P01.*本机.*路径|ST-IN-01-01-P01.*绝对路径/, value);
    });
  }

  for (const value of ["参考图/侧脸", "../portfolio/assets/photos/photo-001.jpg", "assets/photos/photo-001.jpg"]) {
    await t.test(`allows ${value}`, async (subtest) => {
      const fixture = await createStylePublicationFixture(subtest);
      fixture.assignments.assignments["ST-IN-01-01"].slots[0].poseLabel = value;
      await fixture.save();
      const result = await validatePortfolioLibrary(fixture.options());
      assert.equal(result.ok, true, result.errors.join("\n"));
    });
  }
});

test("static exporter independently blocks a POSIX absolute path in an added public manifest", async () => {
  const probePath = join(root, "apps/portfolio-v2/review-private-probe.json");
  try {
    await writeFile(probePath, `${JSON.stringify({ customerReference: "/tmp/customer-secret.jpg" })}\n`);
    const result = await runNodeScript("tools/export-github-pages.mjs");
    assert.notEqual(result.code, 0, "exporter accepted a public local absolute path");
    assert.match(`${result.stdout}\n${result.stderr}`, /本机.*路径|绝对路径|私有/);
  } finally {
    await rm(probePath, { force: true });
    const restored = await runNodeScript("tools/export-github-pages.mjs");
    assert.equal(restored.code, 0, restored.stderr);
  }
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

test("交互模型变化必须生成新的发布版本", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-interaction-version-"));
  const interactionModelPath = join(directory, "interaction-model.js");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(interactionModelPath, "export const gesture = 1;\n");
  const before = await buildPortfolioVersion({ interactionModelPath });
  await writeFile(interactionModelPath, "export const gesture = 2;\n");
  const after = await buildPortfolioVersion({ interactionModelPath });
  assert.notEqual(after, before, "只修改滑动交互模型时也必须刷新缓存版本");
});

test("all six style runtime inputs participate in the portfolio version hash", async (t) => {
  const files = [
    "style-catalog.json",
    "style-slot-assignments.json",
    "style-library.js",
    "style-explorer-model.js",
    "style-preferences.js",
    "style-explorer.js",
  ];
  for (const filename of files) {
    await t.test(filename, async (subtest) => {
      const directory = await mkdtemp(join(tmpdir(), "nanbo-style-version-"));
      subtest.after(() => rm(directory, { recursive: true, force: true }));
      const styleVersionPaths = {};
      for (const current of files) {
        const target = join(directory, current);
        await copyFile(join(root, "apps/portfolio-v2", current), target);
        styleVersionPaths[current] = target;
      }
      const before = await buildPortfolioVersion({ styleVersionPaths });
      await writeFile(styleVersionPaths[filename], Buffer.concat([
        await readFile(styleVersionPaths[filename]),
        Buffer.from("\n"),
      ]));
      const after = await buildPortfolioVersion({ styleVersionPaths });
      assert.notEqual(after, before, `${filename} 变化没有刷新版本`);
    });
  }
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

test("static portfolio export keeps style runtime byte parity and excludes private manager state", async () => {
  const { version } = JSON.parse(await readFile(join(root, "docs/projects/portfolio-v2/build.json"), "utf8"));
  const publicFiles = [
    "style-catalog.json",
    "style-slot-assignments.json",
    "style-library.js",
    "style-explorer-model.js",
    "style-preferences.js",
    "style-explorer.js",
  ];
  for (const filename of publicFiles) {
    const [source, published] = await Promise.all([
      readFile(join(root, "apps/portfolio-v2", filename), "utf8"),
      readFile(join(root, "docs/projects/portfolio-v2", filename), "utf8"),
    ]);
    assert.equal(
      published,
      source.replaceAll("__NBO_BUILD_VERSION__", version),
      `${filename} 静态副本不是仅注入最终版本的源文件`,
    );
  }

  const shortHtml = await readFile(join(root, "docs/p/index.html"), "utf8");
  assert.match(shortHtml, /<base href="\.\.\/projects\/portfolio-v2\/" \/>/);
  for (const filename of publicFiles) {
    assert.equal(new URL(filename, "https://example.test/nbo-smart-system/projects/portfolio-v2/").pathname,
      `/nbo-smart-system/projects/portfolio-v2/${filename}`);
  }

  const publishedNames = await readdir(join(root, "docs/projects/portfolio-v2"));
  assert.equal(publishedNames.some((name) => name === ".local" || /manager|transaction|batch|audit/i.test(name)), false);
  const publicText = (await Promise.all(publishedNames
    .filter((name) => /\.(?:html|js|json|css)$/i.test(name))
    .map((name) => readFile(join(root, "docs/projects/portfolio-v2", name), "utf8")))).join("\n");
  assert.doesNotMatch(publicText, /\/Users\/|portfolio-style-transactions|portfolio-style-batches|slotIdentities/);
  assert.doesNotMatch(publicText, /__NBO_BUILD_VERSION__/);

  const [portfolioRuntime, styleExplorer] = await Promise.all([
    readFile(join(root, "docs/projects/portfolio-v2/portfolio-runtime.js"), "utf8"),
    readFile(join(root, "docs/projects/portfolio-v2/style-explorer.js"), "utf8"),
  ]);
  assert.match(portfolioRuntime, new RegExp(`style-library\\.js\\?v=${version}`));
  assert.match(styleExplorer, new RegExp(`style-explorer-model\\.js\\?v=${version}`));
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
  let createdBackup = "";
  let corruptBackup = "";
  const historyDirectory = join(backupRoot, "photo-158");
  const beforeBackups = await readdir(historyDirectory).catch(() => []);
  await copyFile(targets.full, safetyPaths.full);
  await copyFile(targets.thumb, safetyPaths.thumb);

  try {
    await replacePhoto(id, candidate, "portfolio-workflow-test.jpg");
    const replacedHashes = await hashes(targets);
    assert.notEqual(replacedHashes.full, originalHashes.full);
    assert.notEqual(replacedHashes.thumb, originalHashes.thumb);

    createdBackup = (await readdir(historyDirectory)).find((name) => !beforeBackups.includes(name) && !name.startsWith(".pending-")) || "";
    assert.ok(createdBackup, "换图应创建一个本机备份");
    corruptBackup = join(historyDirectory, "zzzz-corrupt-test");
    await mkdir(corruptBackup, { recursive: true });
    await writeFile(join(corruptBackup, "meta.json"), "{损坏的记录\n");

    await undoLatestPhotoReplacement(id);
    assert.deepEqual(await hashes(targets), originalHashes);
  } finally {
    // 即使断言失败，也把用户原图按字节恢复。
    await copyFile(safetyPaths.full, targets.full);
    await copyFile(safetyPaths.thumb, targets.thumb);
    if (createdBackup) await rm(join(historyDirectory, createdBackup), { recursive: true, force: true });
    if (corruptBackup) await rm(corruptBackup, { recursive: true, force: true });
    await rm(safetyDir, { recursive: true, force: true });
  }
});

test("global operation journals keep public replay records free of backup paths", { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-photo-public-replay-"));
  const photoRoot = join(directory, "photos");
  const localStateRoot = join(directory, ".local");
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(assetPaths(158).full, join(photoRoot, "full/photo-158.jpg")),
    copyFile(assetPaths(158).thumb, join(photoRoot, "thumbs/photo-158.webp")),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const replaceOperationId = "62345678-1234-4234-8234-1234567890ab";
  const undoOperationId = "72345678-1234-4234-8234-1234567890ab";
  const store = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  const replace = await store.replacePhoto({
    id: 158,
    inputPath: assetPaths(157).full,
    originalName: "public-replay.jpg",
    operationId: replaceOperationId,
  });
  const replaceReplay = await createPortfolioPhotoStore({ photoRoot, localStateRoot }).replacePhoto({
    id: 158,
    inputPath: assetPaths(157).full,
    originalName: "public-replay.jpg",
    operationId: replaceOperationId,
  });
  const historyDirectory = join(localStateRoot, "portfolio-photo-backups/photo-158");
  const [historyName] = await readdir(historyDirectory);
  const afterReplace = JSON.parse(await readFile(join(historyDirectory, historyName, "meta.json"), "utf8"));
  assert.deepEqual(replaceReplay, replace);
  assertPublicPhotoMutationRecord(replace, [directory, photoRoot, localStateRoot]);
  assertPublicPhotoMutationRecord(afterReplace, [directory, photoRoot, localStateRoot]);

  const undo = await store.undoLatestPhotoReplacement({ id: 158, operationId: undoOperationId });
  const undoReplay = await createPortfolioPhotoStore({ photoRoot, localStateRoot }).undoLatestPhotoReplacement({ id: 158, operationId: undoOperationId });
  const afterUndo = JSON.parse(await readFile(join(historyDirectory, historyName, "meta.json"), "utf8"));
  assert.deepEqual(undoReplay, undo);
  assertPublicPhotoMutationRecord(undo, [directory, photoRoot, localStateRoot]);
  assertPublicPhotoMutationRecord(afterUndo, [directory, photoRoot, localStateRoot]);
});

test("global photo replacement durably replays one committed operation", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-photo-idempotency-"));
  const photoRoot = join(directory, "photos");
  const localStateRoot = join(directory, ".local");
  const id = 158;
  const source = assetPaths(id);
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(source.full, join(photoRoot, "full/photo-158.jpg")),
    copyFile(source.thumb, join(photoRoot, "thumbs/photo-158.webp")),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  const operationId = "88888888-8888-4888-8888-888888888888";

  const first = await store.replacePhoto({
    id,
    inputPath: assetPaths(157).full,
    originalName: "global-replace.jpg",
    operationId,
  });
  const replay = await createPortfolioPhotoStore({ photoRoot, localStateRoot }).replacePhoto({
    id,
    inputPath: assetPaths(157).full,
    originalName: "global-replace.jpg",
    operationId,
  });

  assert.deepEqual(replay, first);
  assert.equal((await readdir(join(localStateRoot, "portfolio-photo-backups/photo-158"))).length, 1);
  await assert.rejects(
    () => store.replacePhoto({ id, inputPath: assetPaths(157).full, originalName: "different.jpg", operationId }),
    /操作编号|重试内容|不一致/,
  );
});

test("global photo undo durably replays one committed transition", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-photo-undo-idempotency-"));
  const photoRoot = join(directory, "photos");
  const localStateRoot = join(directory, ".local");
  const id = 158;
  const source = assetPaths(id);
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(source.full, join(photoRoot, "full/photo-158.jpg")),
    copyFile(source.thumb, join(photoRoot, "thumbs/photo-158.webp")),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = await hashes({
    full: join(photoRoot, "full/photo-158.jpg"),
    thumb: join(photoRoot, "thumbs/photo-158.webp"),
  });
  const store = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  await store.replacePhoto({
    id,
    inputPath: assetPaths(157).full,
    originalName: "before-undo.jpg",
    operationId: "99999999-9999-4999-8999-999999999999",
  });
  const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const first = await store.undoLatestPhotoReplacement({ id, operationId });
  const replay = await createPortfolioPhotoStore({ photoRoot, localStateRoot }).undoLatestPhotoReplacement({ id, operationId });

  assert.deepEqual(replay, first);
  assert.deepEqual(await hashes({
    full: join(photoRoot, "full/photo-158.jpg"),
    thumb: join(photoRoot, "thumbs/photo-158.webp"),
  }), original);
  assert.equal((await readdir(join(localStateRoot, "portfolio-photo-backups/photo-158"))).length, 1);
  await assert.rejects(
    () => store.undoLatestPhotoReplacement({ id: 157, operationId }),
    /操作编号|重试内容|不一致/,
  );
});

test("global replace survives a crash after asset and history commit without a second history", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-photo-replace-finalize-crash-"));
  const photoRoot = join(directory, "photos");
  const localStateRoot = join(directory, ".local");
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(assetPaths(158).full, join(photoRoot, "full/photo-158.jpg")),
    copyFile(assetPaths(158).thumb, join(photoRoot, "thumbs/photo-158.webp")),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const operationId = "12345678-1234-4234-8234-1234567890ab";
  const crashingStore = createPortfolioPhotoStore({
    photoRoot,
    localStateRoot,
    faults: {
      afterAssetHistoryCommit({ operation }) {
        if (operation === "replace") throw new Error("injected replace finalization crash");
      },
    },
  });

  await assert.rejects(
    () => crashingStore.replacePhoto({
      id: 158,
      inputPath: assetPaths(157).full,
      originalName: "replace-finalize-crash.jpg",
      operationId,
    }),
    /injected replace finalization crash/,
  );

  const transactionDirectory = join(localStateRoot, "portfolio-photo-transactions");
  assert.equal((await readdir(transactionDirectory)).length, 1);
  const historyDirectory = join(localStateRoot, "portfolio-photo-backups/photo-158");
  const historyNames = await readdir(historyDirectory);
  assert.equal(historyNames.length, 1);
  const committedMeta = JSON.parse(await readFile(join(historyDirectory, historyNames[0], "meta.json"), "utf8"));
  assert.equal(committedMeta.status, "available");
  assert.ok(committedMeta.replaceOperation?.result);
  assert.match(committedMeta.replaceOperation?.resultStateFingerprint || "", /^[0-9a-f]{64}$/);

  const restartedStore = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  await restartedStore.recoverIncompletePhotoTransactions();
  const replay = await restartedStore.replacePhoto({
    id: 158,
    inputPath: assetPaths(157).full,
    originalName: "replace-finalize-crash.jpg",
    operationId,
  });
  assert.deepEqual(replay, committedMeta.replaceOperation.result);
  assert.equal((await readdir(historyDirectory)).length, 1);
  assert.equal((await readdir(transactionDirectory)).length, 0);
});

test("global undo survives a crash after asset and history commit without a second transition", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-photo-undo-finalize-crash-"));
  const photoRoot = join(directory, "photos");
  const localStateRoot = join(directory, ".local");
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(assetPaths(158).full, join(photoRoot, "full/photo-158.jpg")),
    copyFile(assetPaths(158).thumb, join(photoRoot, "thumbs/photo-158.webp")),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const initialStore = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  await initialStore.replacePhoto({
    id: 158,
    inputPath: assetPaths(157).full,
    originalName: "before-undo-finalize-crash.jpg",
    operationId: "22345678-1234-4234-8234-1234567890ab",
  });
  const operationId = "32345678-1234-4234-8234-1234567890ab";
  const crashingStore = createPortfolioPhotoStore({
    photoRoot,
    localStateRoot,
    faults: {
      afterAssetHistoryCommit({ operation }) {
        if (operation === "undo") throw new Error("injected undo finalization crash");
      },
    },
  });

  await assert.rejects(
    () => crashingStore.undoLatestPhotoReplacement({ id: 158, operationId }),
    /injected undo finalization crash/,
  );

  const transactionDirectory = join(localStateRoot, "portfolio-photo-transactions");
  assert.equal((await readdir(transactionDirectory)).length, 1);
  const historyDirectory = join(localStateRoot, "portfolio-photo-backups/photo-158");
  const [historyName] = await readdir(historyDirectory);
  const committedMeta = JSON.parse(await readFile(join(historyDirectory, historyName, "meta.json"), "utf8"));
  assert.equal(committedMeta.status, "restored");
  assert.ok(committedMeta.undoOperation?.result);
  assert.match(committedMeta.undoOperation?.resultStateFingerprint || "", /^[0-9a-f]{64}$/);

  const restartedStore = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  await restartedStore.recoverIncompletePhotoTransactions();
  const replay = await restartedStore.undoLatestPhotoReplacement({ id: 158, operationId });
  assert.deepEqual(replay, committedMeta.undoOperation.result);
  assert.equal((await readdir(historyDirectory)).length, 1);
  assert.equal((await readdir(transactionDirectory)).length, 0);
});

test("fully rolled-back global replace and undo operations can retry with the same ids", { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-photo-rolled-back-retry-"));
  const photoRoot = join(directory, "photos");
  const localStateRoot = join(directory, ".local");
  const targets = {
    full: join(photoRoot, "full/photo-158.jpg"),
    thumb: join(photoRoot, "thumbs/photo-158.webp"),
  };
  await Promise.all([
    mkdir(join(photoRoot, "full"), { recursive: true }),
    mkdir(join(photoRoot, "thumbs"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(assetPaths(158).full, targets.full),
    copyFile(assetPaths(158).thumb, targets.thumb),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = await hashes(targets);
  const replaceOperationId = "42345678-1234-4234-8234-1234567890ab";
  const crashingReplaceStore = createPortfolioPhotoStore({
    photoRoot,
    localStateRoot,
    faults: {
      beforeAssetInstall({ operation }) {
        if (operation === "replace") throw new Error("injected rolled-back replace");
      },
    },
  });
  const replaceRequest = {
    id: 158,
    inputPath: assetPaths(157).full,
    originalName: "rolled-back-replace.jpg",
    operationId: replaceOperationId,
  };

  await assert.rejects(() => crashingReplaceStore.replacePhoto(replaceRequest), /injected rolled-back replace/);
  assert.deepEqual(await hashes(targets), original);
  const restartedStore = createPortfolioPhotoStore({ photoRoot, localStateRoot });
  await restartedStore.recoverIncompletePhotoTransactions();
  await restartedStore.replacePhoto(replaceRequest);
  assert.notDeepEqual(await hashes(targets), original);

  const undoOperationId = "52345678-1234-4234-8234-1234567890ab";
  const crashingUndoStore = createPortfolioPhotoStore({
    photoRoot,
    localStateRoot,
    faults: {
      beforeAssetInstall({ operation }) {
        if (operation === "undo") throw new Error("injected rolled-back undo");
      },
    },
  });
  await assert.rejects(
    () => crashingUndoStore.undoLatestPhotoReplacement({ id: 158, operationId: undoOperationId }),
    /injected rolled-back undo/,
  );
  assert.notDeepEqual(await hashes(targets), original);
  await createPortfolioPhotoStore({ photoRoot, localStateRoot }).undoLatestPhotoReplacement({ id: 158, operationId: undoOperationId });
  assert.deepEqual(await hashes(targets), original);
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

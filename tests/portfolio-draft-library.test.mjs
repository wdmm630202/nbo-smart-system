import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildPortfolioItems,
  buildPortfolioThemes,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import { createDraftStore } from "../tools/portfolio-draft-store.mjs";
import { resolveBinary, root } from "../tools/portfolio-photo-lib.mjs";
import {
  ingestDraftPhoto,
  loadPublicAdditions,
  recoverIncompletePublicationTransactions,
  setPublishedPhotoVisibility,
  stageDraftForPublication,
} from "../tools/portfolio-draft-photo-lib.mjs";

const execFileAsync = promisify(execFile);

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

async function startIsolatedManager(t, { additions, prepare } = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), "nanbo-manager-api-"));
  const draftDirectory = join(sandbox, "drafts");
  const additionsPath = join(sandbox, "catalog-additions.json");
  const publicPhotoRoot = join(sandbox, "public");
  const port = 0;
  const initialAdditions = additions || { schemaVersion: 1, themes: [], photos: [] };
  await mkdir(publicPhotoRoot, { recursive: true });
  await writeFile(additionsPath, `${JSON.stringify(initialAdditions, null, 2)}\n`);
  const store = createDraftStore({ rootDir: draftDirectory, legacyMaxId: 158 });
  await store.addPhoto({
    id: 159,
    uuid: "0123456789abcdef01234567",
    originalName: "NB-159.jpg",
    status: "draft",
    approvedForPublicUse: false,
  });
  if (prepare) await prepare({ additionsPath, draftDirectory, publicPhotoRoot, sandbox, store });

  const child = spawn(process.execPath, [join(root, "tools/portfolio-manager-server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      NANBO_PORTFOLIO_PORT: String(port),
      NANBO_PORTFOLIO_DRAFT_ROOT: draftDirectory,
      NANBO_PORTFOLIO_ADDITIONS_PATH: additionsPath,
      NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT: publicPhotoRoot,
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
  const output = await waitForOutput(child, /南铂客片管理台：/);
  const selectedPort = output.match(/南铂客片管理台：http:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
  if (!selectedPort || selectedPort === "0") throw new Error(`管理台没有报告系统分配端口：${output}`);
  const url = `http://127.0.0.1:${selectedPort}/`;
  const token = (await (await fetch(`${url}api/session`)).json()).token;
  return {
    additionsPath,
    draftDirectory,
    publicPhotoRoot,
    sandbox,
    store,
    url,
    token,
    postJson(path, body, headers = {}) {
      return fetch(new URL(path, url), {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-nanbo-token": token, ...headers },
      });
    },
  };
}

async function writeFixture(path, content = "fixture\n") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function gitAt(cwd, args) {
  return execFileAsync("git", args, { cwd });
}

async function createSyntheticPublishManager(t, {
  failFirstPush = false,
  sourceChange = "metadata",
  unexpectedExportOnce = false,
} = {}) {
  const archivedFirstSync = sourceChange === "archived-new";
  const restoringMetadata = sourceChange === "restore";
  const sandbox = await mkdtemp(join(tmpdir(), "nanbo-publish-api-"));
  const repository = join(sandbox, "repository");
  const remote = join(sandbox, "remote.git");
  const draftDirectory = join(repository, ".local/portfolio-drafts");
  const additionsPath = join(repository, "apps/portfolio-v2/catalog-additions.json");
  const publicPhotoRoot = join(repository, "apps/portfolio/assets/photos");
  const port = 0;
  let child;
  t.after(async () => {
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(sandbox, { recursive: true, force: true });
  });

  for (const path of [
    "tools/portfolio-manager-server.mjs",
    "tools/portfolio-photo-lib.mjs",
    "tools/portfolio-draft-store.mjs",
    "tools/portfolio-draft-photo-lib.mjs",
    "tools/export-github-pages.mjs",
    "apps/portfolio-v2/catalog.js",
    "apps/portfolio-v2/interaction-model.js",
    "apps/portfolio-v2/portfolio-runtime.js",
  ]) {
    await writeFixture(join(repository, path), await readFile(join(root, path)));
  }
  await writeFixture(join(repository, "tools/export-github-pages.mjs"), [
    'import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";',
    'import { dirname, join } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'const root = dirname(dirname(fileURLToPath(import.meta.url)));',
    'const marker = Buffer.concat([',
    '  await readFile(join(root, "apps/portfolio/assets/photos/full/photo-158.jpg")),',
    '  await readFile(join(root, "apps/portfolio-v2/catalog-additions.json")),',
    ']);',
    'for (const path of ["docs/projects/portfolio-v2/index.html", "docs/projects/portfolio-v2/app.js", "docs/projects/portfolio-v2/build.json", "docs/p/index.html", "docs/p/build.json", "docs/i/index.html"]) {',
    '  const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, marker);',
    '}',
    'const additionsTarget = join(root, "docs/projects/portfolio-v2/catalog-additions.json");',
    'await mkdir(dirname(additionsTarget), { recursive: true });',
    'await copyFile(join(root, "apps/portfolio-v2/catalog-additions.json"), additionsTarget);',
    'const additions = JSON.parse(await readFile(join(root, "apps/portfolio-v2/catalog-additions.json"), "utf8"));',
    'for (const id of [158, ...additions.photos.map((photo) => Number(photo.id))]) {',
    '  const base = `photo-${String(id).padStart(3, "0")}`;',
    '  for (const part of [`full/${base}.jpg`, `thumbs/${base}.webp`]) {',
    '    const source = join(root, "apps/portfolio/assets/photos", part);',
    '    try { await access(source); } catch (error) { if (error.code === "ENOENT") continue; throw error; }',
    '    const target = join(root, "docs/projects/portfolio/assets/photos", part);',
    '    await mkdir(dirname(target), { recursive: true });',
    '    await copyFile(source, target);',
    '  }',
    '}',
    'const unexpectedSentinel = join(root, ".local/emit-unexpected-export");',
    'try {',
    '  await access(unexpectedSentinel);',
    '  await rm(unexpectedSentinel);',
    '  const unexpected = join(root, "docs/unexpected-export.txt");',
    '  await mkdir(dirname(unexpected), { recursive: true });',
    '  await writeFile(unexpected, "unexpected export\\n");',
    '} catch (error) {',
    '  if (error.code !== "ENOENT") throw error;',
    '}',
    '',
  ].join("\n"));
  await writeFixture(join(repository, ".gitignore"), ".local/\n");
  await writeFixture(join(repository, "app/page.tsx"), "const projects: Project[] = [\n];\n\nconst filters = [];\n");
  await writeFixture(join(repository, "app/globals.css"), "body{}\n");
  await writeFixture(join(repository, "app/project-visuals.mjs"), "export function getProjectInterface() { return { label: '', markup: '' }; }\n");
  for (const name of ["icon.png", "og.png", "stash-dashboard-preview.jpg", "system-preview-after.jpg", "system-preview-before.jpg"]) {
    await writeFixture(join(repository, "public", name));
  }
  for (const path of [
    "apps/reviews/index.html",
    "apps/reviews/language-db.js",
    "apps/reviews/app.js",
    "apps/reviews/nfc/index.html",
    "apps/reviews/nfc/app.js",
    "apps/reviews/nfc/setup.html",
    "apps/reviews/nfc/nfc-qr.png",
    "apps/reviews/nfc/douyin-review-code.png",
    "apps/reviews/nfc/assets/review-example-portrait.webp",
    "apps/reviews/nfc/assets/review-example-bts.webp",
    "apps/reviews/nfc/assets/review-example-selection.webp",
    "apps/reviews/nfc/assets/review-photo-guide-triptych.png",
    "apps/photo-recreation/index.html",
    "apps/photo-video-sorter/index.html",
    "apps/nanbo-select/index.html",
    "apps/xhs-cover/index.html",
    "apps/portfolio/index.html",
    "apps/portfolio-insights/index.html",
  ]) {
    await writeFixture(join(repository, path));
  }
  await mkdir(join(repository, "docs/projects/reviews"), { recursive: true });
  const portfolioV2Files = [
    "index.html",
    "styles.css",
    "app.js",
    "analytics.js",
    "wechat-share.js",
    "wechat-contact-qr.png",
    "privacy.html",
    "share-card.jpg",
    "MP_verify_ZCU9ptvNi6e2Zgi3.txt",
  ];
  for (const name of portfolioV2Files) {
    const content = name === "index.html"
      ? "<!doctype html><html><head></head><body>__NBO_BUILD_VERSION__</body></html>\n"
      : (name === "app.js" ? "export const version = '__NBO_BUILD_VERSION__';\n" : "fixture\n");
    await writeFixture(join(repository, "apps/portfolio-v2", name), content);
  }
  for (let id = 1; id <= portfolioCatalog.photoCount; id += 1) {
    const filename = `photo-${String(id).padStart(3, "0")}`;
    await writeFixture(join(publicPhotoRoot, "full", `${filename}.jpg`), `full-${id}\n`);
    await writeFixture(join(publicPhotoRoot, "thumbs", `${filename}.webp`), `thumb-${id}\n`);
  }
  for (const id of portfolioCatalog.heroAssetIds) {
    const filename = `photo-${String(id).padStart(3, "0")}.webp`;
    await writeFixture(join(publicPhotoRoot, "featured", filename), `featured-${id}\n`);
  }
  const additionPhoto = {
    id: 159,
    scene: "indoor",
    theme: "magazine",
    category: "mood",
    title: "杂志肖像",
    styleTitle: "情绪",
    featured: false,
    visibility: "published",
    publishedAt: "2026-08-31T00:00:00.000Z",
  };
  const additions = {
    schemaVersion: 1,
    themes: [],
    photos: archivedFirstSync ? [] : [{
      ...additionPhoto,
      visibility: restoringMetadata ? "archived" : "published",
    }],
  };
  await writeFixture(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
  if (!archivedFirstSync) {
    await writeFixture(join(publicPhotoRoot, "full/photo-159.jpg"), "full-159\n");
    await writeFixture(join(publicPhotoRoot, "thumbs/photo-159.webp"), "thumb-159\n");
  }
  await execFileAsync(process.execPath, [join(repository, "tools/export-github-pages.mjs")], { cwd: repository });

  await gitAt(repository, ["init", "-b", "main"]);
  await gitAt(repository, ["config", "user.name", "Nanbo Test"]);
  await gitAt(repository, ["config", "user.email", "nanbo-test@example.invalid"]);
  await gitAt(repository, ["add", "."]);
  await gitAt(repository, ["commit", "-m", "synthetic baseline"]);
  await gitAt(sandbox, ["init", "--bare", remote]);
  await gitAt(repository, ["remote", "add", "origin", remote]);
  await gitAt(repository, ["push", "-u", "origin", "main"]);
  await gitAt(sandbox, [`--git-dir=${remote}`, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const store = createDraftStore({ rootDir: draftDirectory, legacyMaxId: 158 });
  await store.addPhoto({
    id: 159,
    uuid: "0123456789abcdef01234567",
    originalName: "NB-159.jpg",
    scene: "indoor",
    theme: "magazine",
    category: "mood",
    approvedForPublicUse: true,
  });
  await store.transitionPhoto(159, "ready");
  await store.markStaged(159, "2026-08-31T01:00:00.000Z");

  if (sourceChange === "metadata") {
    additions.photos[0].publishedAt = "2026-08-31T02:00:00.000Z";
    await writeFixture(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
  } else if (sourceChange === "hide") {
    additions.photos[0].visibility = "archived";
    await writeFixture(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
    await store.transitionPhoto(159, "archived");
  } else if (restoringMetadata) {
    const { stdout: baselineCommit } = await gitAt(repository, ["rev-parse", "--short", "HEAD"]);
    await store.markPublished([159], baselineCommit.trim());
    await store.transitionPhoto(159, "archived");
    additions.photos[0].visibility = "published";
    await writeFixture(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
  } else if (sourceChange === "photos") {
    await writeFixture(join(publicPhotoRoot, "full/photo-158.jpg"), "changed-full-158\n");
    await writeFixture(join(publicPhotoRoot, "thumbs/photo-158.webp"), "changed-thumb-158\n");
  } else if (archivedFirstSync) {
    additions.photos.push({ ...additionPhoto, visibility: "archived" });
    await writeFixture(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
    await writeFixture(join(publicPhotoRoot, "full/photo-159.jpg"), "full-159\n");
    await writeFixture(join(publicPhotoRoot, "thumbs/photo-159.webp"), "thumb-159\n");
    await store.transitionPhoto(159, "archived");
  }

  if (failFirstPush) {
    const hooks = join(remote, "hooks");
    const sentinel = join(hooks, "fail-once");
    const hook = join(hooks, "pre-receive");
    await writeFixture(sentinel, "1\n");
    await writeFixture(hook, `#!/bin/sh\nif [ -f "${sentinel}" ]; then\n  rm -f "${sentinel}"\n  echo simulated push failure >&2\n  exit 1\nfi\nexit 0\n`);
    await chmod(hook, 0o755);
  }
  if (unexpectedExportOnce) {
    await writeFixture(join(repository, ".local/emit-unexpected-export"), "1\n");
  }

  child = spawn(process.execPath, [join(repository, "tools/portfolio-manager-server.mjs")], {
    cwd: repository,
    env: {
      ...process.env,
      NANBO_PORTFOLIO_PORT: String(port),
      NANBO_PORTFOLIO_DRAFT_ROOT: draftDirectory,
      NANBO_PORTFOLIO_ADDITIONS_PATH: additionsPath,
      NANBO_PORTFOLIO_PUBLIC_PHOTO_ROOT: publicPhotoRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = await waitForOutput(child, /南铂客片管理台：/);
  const selectedPort = output.match(/南铂客片管理台：http:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
  if (!selectedPort || selectedPort === "0") throw new Error(`管理台没有报告系统分配端口：${output}`);
  const url = `http://127.0.0.1:${selectedPort}/`;
  const token = (await (await fetch(`${url}api/session`)).json()).token;
  return {
    additionsPath,
    draftDirectory,
    publicPhotoRoot,
    remote,
    repository,
    sandbox,
    store,
    url,
    token,
    publish() {
      return fetch(new URL("api/publish", url), { method: "POST", headers: { "x-nanbo-token": token } });
    },
    async status() {
      return (await fetch(new URL("api/status", url))).json();
    },
  };
}

async function createTestPhoto(directory, name = "source.jpg") {
  const path = join(directory, name);
  await execFileAsync(await resolveBinary("ffmpeg"), [
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

test("管理台提供新增、状态筛选、授权、新主题和批量结果区域", async () => {
  const html = await readFile(new URL("../tools/portfolio-manager/index.html", import.meta.url), "utf8");
  for (const id of [
    "add-photo-button",
    "library-mode",
    "draft-status-filter",
    "draft-upload",
    "draft-metadata",
    "public-consent",
    "homepage-featured",
    "new-theme-button",
    "new-theme-form",
    "upload-results",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /已确认可公开使用/);
  assert.match(html, /草稿/);
  assert.match(html, /待公开/);
  assert.match(html, /已公开/);
  assert.match(html, /已归档/);
});

async function loadDraftUiState() {
  try {
    return await import("../tools/portfolio-manager/draft-ui-state.js");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  }
}

test("批量上传按选择顺序逐张结算且保留部分成功", async () => {
  const { uploadDraftFilesSequentially } = await loadDraftUiState();
  assert.equal(typeof uploadDraftFilesSequentially, "function");
  const calls = [];
  const progress = [];
  const files = [{ name: "one.jpg" }, { name: "broken.jpg" }, { name: "three.jpg" }];
  const results = await uploadDraftFilesSequentially(files, async (file) => {
    calls.push(file.name);
    if (file.name === "broken.jpg") throw new Error("图片尺寸无效");
    return { id: file.name === "one.jpg" ? 159 : 160 };
  }, (next) => progress.push(next));

  assert.deepEqual(calls, ["one.jpg", "broken.jpg", "three.jpg"]);
  assert.deepEqual(results, [
    { file: "one.jpg", status: "success", code: "NB-159" },
    { file: "broken.jpg", status: "error", error: "图片尺寸无效" },
    { file: "three.jpg", status: "success", code: "NB-160" },
  ]);
  assert.deepEqual(progress.map((snapshot) => snapshot.map(({ status }) => status)), [
    ["pending", "pending", "pending"],
    ["success", "pending", "pending"],
    ["success", "error", "pending"],
    ["success", "error", "success"],
  ]);
});

test("准备公开只由草稿分类和独立授权开启", async () => {
  const { canPrepareDraft } = await loadDraftUiState();
  assert.equal(typeof canPrepareDraft, "function");
  const complete = {
    scene: "indoor",
    theme: "magazine",
    category: "mood",
    approvedForPublicUse: true,
    featured: false,
  };
  assert.equal(canPrepareDraft({ status: "draft" }, complete, false), true);
  assert.equal(canPrepareDraft({ status: "draft" }, { ...complete, approvedForPublicUse: false }, false), false);
  assert.equal(canPrepareDraft({ status: "ready" }, complete, false), false);
  assert.equal(canPrepareDraft({ status: "draft" }, complete, true), false);
});

test("已加入本地预览的草稿不提供普通恢复或重复暂存", async () => {
  const { draftEditorState, restoreActionForDraft, stageActionForDraft, archiveActionForDraft } = await loadDraftUiState();
  for (const value of [draftEditorState, restoreActionForDraft, stageActionForDraft, archiveActionForDraft]) {
    assert.equal(typeof value, "function");
  }
  const ready = { id: 159, status: "ready" };
  const staged = { id: 160, status: "ready", stagedAt: "2026-08-31T01:00:00.000Z" };

  assert.deepEqual(draftEditorState(ready), {
    editable: false,
    showSave: false,
    showReady: false,
    showArchive: true,
    showRestore: true,
    restoreLabel: "返回草稿编辑",
    showStage: true,
    archiveLabel: "归档草稿",
    statusLabel: "待公开",
    statusNote: "已完成分类与授权，可加入本地网站预览。",
  });
  assert.equal(draftEditorState(staged).showRestore, false);
  assert.equal(draftEditorState(staged).showStage, false);
  assert.equal(draftEditorState(staged).statusLabel, "已加入本地预览");
  assert.match(draftEditorState(staged).statusNote, /不会自动同步/);
  assert.deepEqual(restoreActionForDraft(ready), { path: "/api/drafts/restore", body: null });
  assert.equal(restoreActionForDraft(staged), null);
  assert.deepEqual(stageActionForDraft(ready), { path: "/api/drafts/stage", body: null });
  assert.equal(stageActionForDraft(staged), null);
  assert.deepEqual(archiveActionForDraft(staged), {
    path: "/api/public/visibility",
    body: { visibility: "archived" },
    successMessage: "已从本地网站预览隐藏；本次隐藏只保存在本机，同步成功后网站才会更新。",
  });
});

test("草稿状态筛选会同时清除不在结果中的编辑器选中项", async () => {
  const { filterDrafts, reconcileSelectedDraftId } = await loadDraftUiState();
  assert.equal(typeof filterDrafts, "function");
  assert.equal(typeof reconcileSelectedDraftId, "function");
  const drafts = [{ id: 159, status: "draft" }, { id: 160, status: "ready" }];
  assert.deepEqual(filterDrafts(drafts, "ready"), [{ id: 160, status: "ready" }]);
  assert.equal(reconcileSelectedDraftId(159, drafts, "ready"), 0);
  assert.equal(reconcileSelectedDraftId(160, drafts, "ready"), 160);
  assert.equal(reconcileSelectedDraftId(160, drafts, "all"), 160);
});

test("关闭新主题表单后焦点回到触发按钮", async () => {
  const { setExpandedPanel } = await loadDraftUiState();
  assert.equal(typeof setExpandedPanel, "function");
  const panel = { hidden: false };
  const feedback = { textContent: "之前的提示" };
  const attributes = {};
  let triggerFocusCount = 0;
  let firstFieldFocusCount = 0;
  const trigger = {
    setAttribute(name, value) { attributes[name] = value; },
    focus() { triggerFocusCount += 1; },
  };
  const firstField = { focus() { firstFieldFocusCount += 1; } };

  setExpandedPanel({ panel, trigger, feedback, firstField }, true);
  assert.equal(panel.hidden, false);
  assert.equal(attributes["aria-expanded"], "true");
  assert.equal(firstFieldFocusCount, 1);
  assert.equal(triggerFocusCount, 0);

  setExpandedPanel({ panel, trigger, feedback, firstField }, false);
  assert.equal(panel.hidden, true);
  assert.equal(attributes["aria-expanded"], "false");
  assert.equal(feedback.textContent, "");
  assert.equal(triggerFocusCount, 1);
});

test("同步控件使用服务端待发布状态而不是仅看换图编号", async () => {
  const { publicationControlState } = await loadDraftUiState();
  assert.equal(typeof publicationControlState, "function");
  const view = publicationControlState({
    branch: "main",
    dirtySlots: [],
    pendingPublicationIds: [],
    hasPendingPublication: true,
    unrelatedFiles: [],
  });
  assert.equal(view.buttonDisabled, false);
  assert.equal(view.hasPendingPublication, true);
  assert.equal(view.title, "有待同步状态变更");
  assert.match(view.description, /隐藏或恢复.*本机.*同步成功/);
});

test("无编号的元数据同步使用无数量状态文案", async () => {
  const { publicationControlState } = await loadDraftUiState();
  const view = publicationControlState({
    branch: "main",
    dirtySlots: [],
    pendingPublicationIds: [],
    hasPendingPublication: true,
    unrelatedFiles: [],
  });
  assert.equal(view.pendingCount, 0);
  assert.equal(view.title, "有待同步状态变更");
  assert.equal(view.pendingSummary, "有待同步状态变更");
});

test("草稿修改接口拒绝缺少令牌和跨站请求", { timeout: 30_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const noToken = await fetch(`${server.url}api/drafts/update?id=159`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });
  assert.equal(noToken.status, 403);

  const crossSite = await fetch(`${server.url}api/drafts/update?id=159`, {
    method: "POST",
    body: "{}",
    headers: {
      "content-type": "application/json",
      "x-nanbo-token": server.token,
      origin: "https://example.com",
    },
  });
  assert.equal(crossSite.status, 403);
  const fetchMetadataCrossSite = await fetch(`${server.url}api/drafts/update?id=159`, {
    method: "POST",
    body: "{}",
    headers: {
      "content-type": "application/json",
      "x-nanbo-token": server.token,
      "sec-fetch-site": "cross-site",
    },
  });
  assert.equal(fetchMetadataCrossSite.status, 403);
});

test("未授权草稿不能进入待公开", { timeout: 30_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const response = await server.postJson("api/drafts/ready?id=159", {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /公开授权/);

  const withoutBody = await fetch(`${server.url}api/drafts/ready?id=159`, {
    method: "POST",
    headers: { "x-nanbo-token": server.token },
  });
  assert.equal(withoutBody.status, 400);
  assert.match((await withoutBody.json()).error, /公开授权/);
});

test("管理台使用隔离目录合并草稿和公开增量", { timeout: 30_000 }, async (t) => {
  const defaultAdditionsBefore = await readFile(join(root, "apps/portfolio-v2/catalog-additions.json"), "utf8");
  const additions = {
    schemaVersion: 1,
    themes: [],
    photos: [{
      id: 160,
      scene: "indoor",
      theme: "magazine",
      category: "mood",
      title: "杂志肖像",
      styleTitle: "情绪",
      featured: false,
      visibility: "published",
      publishedAt: "2026-08-31T00:00:00.000Z",
    }],
  };
  const server = await startIsolatedManager(t, {
    additions,
    async prepare({ publicPhotoRoot }) {
      await mkdir(join(publicPhotoRoot, "full"), { recursive: true });
      await mkdir(join(publicPhotoRoot, "thumbs"), { recursive: true });
      await writeFile(join(publicPhotoRoot, "full/photo-160.jpg"), "registered-full");
      await writeFile(join(publicPhotoRoot, "thumbs/photo-160.webp"), "registered-thumb");
    },
  });

  const payload = await (await fetch(`${server.url}api/catalog`)).json();
  assert.equal(payload.items.at(-1).id, 160);
  assert.equal(payload.items.length, 159);
  assert.equal(payload.drafts[0].id, 159);
  assert.deepEqual(payload.counts, { public: 159, draft: 1, ready: 0, published: 0, archived: 0 });
  assert.equal(payload.themes.find(({ id }) => id === "magazine").count, 19);

  const registered = await fetch(`${server.url}media/full/160`);
  assert.equal(registered.status, 200);
  assert.equal(await registered.text(), "registered-full");
  assert.equal((await fetch(`${server.url}media/full/161`)).status, 404);
  assert.equal(await readFile(join(root, "apps/portfolio-v2/catalog-additions.json"), "utf8"), defaultAdditionsBefore);
});

test("草稿媒体同时校验会话、UUID 和资产目录", { timeout: 30_000 }, async (t) => {
  const uuid = "0123456789abcdef01234567";
  const escapedUuid = "abcdef0123456789abcdef01";
  const server = await startIsolatedManager(t, {
    async prepare({ draftDirectory, sandbox }) {
      await mkdir(join(draftDirectory, "assets/full"), { recursive: true });
      await mkdir(join(draftDirectory, "assets/thumbs"), { recursive: true });
      await writeFile(join(draftDirectory, `assets/full/${uuid}.jpg`), "draft-full");
      await writeFile(join(draftDirectory, `assets/thumbs/${uuid}.webp`), "draft-thumb");
      await writeFile(join(sandbox, "outside.jpg"), "must-not-leak");
      await symlink(join(sandbox, "outside.jpg"), join(draftDirectory, `assets/full/${escapedUuid}.jpg`));
    },
  });

  assert.equal((await fetch(`${server.url}media/draft/full/${uuid}`)).status, 403);
  assert.equal((await fetch(`${server.url}media/draft/full/not-a-uuid?token=${server.token}`)).status, 400);
  const response = await fetch(`${server.url}media/draft/full/${uuid}?token=${server.token}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "draft-full");
  assert.equal((await fetch(`${server.url}media/draft/full/${escapedUuid}?token=${server.token}`)).status, 404);
});

test("启动时使用隔离路径恢复未完成的公开事务", { timeout: 30_000 }, async (t) => {
  let transactionDir;
  const before = `${JSON.stringify({ schemaVersion: 1, themes: [], photos: [] }, null, 2)}\n`;
  const server = await startIsolatedManager(t, {
    async prepare({ additionsPath, draftDirectory, publicPhotoRoot }) {
      transactionDir = join(draftDirectory, "publication-transactions/photo-160-interrupted");
      await mkdir(transactionDir, { recursive: true });
      await writeFile(join(transactionDir, "before-additions.json"), before);
      await writeFile(join(transactionDir, "transaction.json"), `${JSON.stringify({
        schemaVersion: 1,
        operation: "stage",
        id: 160,
        status: "manifest-installed",
      }, null, 2)}\n`);
      await writeFile(additionsPath, `${JSON.stringify({
        schemaVersion: 1,
        themes: [],
        photos: [{ id: 160, scene: "indoor", theme: "magazine", category: "mood", visibility: "published" }],
      }, null, 2)}\n`);
      await mkdir(join(publicPhotoRoot, "full"), { recursive: true });
      await mkdir(join(publicPhotoRoot, "thumbs"), { recursive: true });
      await writeFile(join(publicPhotoRoot, "full/photo-160.jpg"), "partial-full");
      await writeFile(join(publicPhotoRoot, "thumbs/photo-160.webp"), "partial-thumb");
    },
  });

  assert.equal(await readFile(server.additionsPath, "utf8"), before);
  await assert.rejects(() => stat(join(server.publicPhotoRoot, "full/photo-160.jpg")), /ENOENT/);
  await assert.rejects(() => stat(join(server.publicPhotoRoot, "thumbs/photo-160.webp")), /ENOENT/);
  await assert.rejects(() => stat(transactionDir), /ENOENT/);
});

test("草稿 API 校验主题并且归档恢复不删除资产", { timeout: 30_000 }, async (t) => {
  const uuid = "0123456789abcdef01234567";
  const server = await startIsolatedManager(t, {
    async prepare({ draftDirectory }) {
      await mkdir(join(draftDirectory, "assets/full"), { recursive: true });
      await writeFile(join(draftDirectory, `assets/full/${uuid}.jpg`), "keep-me");
    },
  });

  const theme = await server.postJson("api/draft-themes", {
    id: "new-light",
    label: "新光影",
    scene: "indoor",
    description: "干净光影",
  });
  assert.equal(theme.status, 200);
  assert.equal((await server.postJson("api/draft-themes", {
    id: "another-light",
    label: "新光影",
    scene: "indoor",
    description: "另一主题",
  })).status, 400);
  assert.equal((await server.postJson("api/draft-themes", {
    id: "Bad Theme",
    label: "错误主题",
    scene: "space",
    description: "错误主题描述",
  })).status, 400);

  const update = await server.postJson("api/drafts/update?id=159", {
    scene: "indoor",
    theme: "new-light",
    category: "mood",
    approvedForPublicUse: true,
  });
  const updatePayload = await update.clone().json();
  assert.equal(update.status, 200, updatePayload.error);
  assert.equal((await server.postJson("api/drafts/ready?id=159", {})).status, 200);
  assert.equal((await server.postJson("api/drafts/archive?id=159", {})).status, 200);
  assert.equal((await server.postJson("api/drafts/restore?id=159", {})).status, 200);
  assert.equal(await readFile(join(server.draftDirectory, `assets/full/${uuid}.jpg`), "utf8"), "keep-me");

  const malformed = await fetch(new URL("api/drafts/update?id=159", server.url), {
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json", "x-nanbo-token": server.token },
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /有效 JSON/);
});

test("上传接口逐张返回成功或失败且成功草稿保留", { timeout: 60_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const source = await createTestPhoto(server.sandbox, "api-upload.jpg");
  const upload = (body) => fetch(new URL("api/drafts/upload", server.url), {
    method: "POST",
    body,
    headers: {
      "content-type": "image/jpeg",
      "x-file-name": encodeURIComponent("李先生_13800138000.jpg"),
      "x-nanbo-token": server.token,
    },
  });

  const accepted = await upload(await readFile(source));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).result.id, 160);
  const rejected = await upload(Buffer.from("not an image"));
  assert.equal(rejected.status, 400);
  const state = await createDraftStore({ rootDir: server.draftDirectory, legacyMaxId: 158 }).read();
  assert.deepEqual(state.photos.map(({ id }) => id), [159, 160]);
  assert.doesNotMatch(JSON.stringify(state), /李先生|13800138000/);
});

test("草稿更新只接受有效分类且不开放发布状态", { timeout: 30_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const invalidClassification = await server.postJson("api/drafts/update?id=159", {
    scene: "space",
    theme: "unknown-theme",
    category: "unknown-category",
    approvedForPublicUse: true,
  });
  assert.equal(invalidClassification.status, 400);

  const genericPublish = await server.postJson("api/drafts/update?id=159", { status: "published" });
  assert.equal(genericPublish.status, 400);
  const [draft] = (await createDraftStore({ rootDir: server.draftDirectory, legacyMaxId: 158 }).read()).photos;
  assert.equal(draft.status, "draft");
});

test("待公开安装与隐藏恢复保留编号和本地草稿", { timeout: 60_000 }, async (t) => {
  const server = await startIsolatedManager(t);
  const source = await createTestPhoto(server.sandbox, "stage-upload.jpg");
  const upload = await fetch(new URL("api/drafts/upload", server.url), {
    method: "POST",
    body: await readFile(source),
    headers: {
      "content-type": "image/jpeg",
      "x-file-name": "stage-upload.jpg",
      "x-nanbo-token": server.token,
    },
  });
  assert.equal(upload.status, 200);
  const id = (await upload.json()).result.id;
  assert.equal(id, 160);
  assert.equal((await server.postJson(`api/drafts/update?id=${id}`, {
    scene: "indoor",
    theme: "magazine",
    category: "mood",
    approvedForPublicUse: true,
  })).status, 200);
  assert.equal((await server.postJson(`api/drafts/ready?id=${id}`, {})).status, 200);

  const staged = await server.postJson(`api/drafts/stage?id=${id}`, {});
  assert.equal(staged.status, 200);
  let additions = JSON.parse(await readFile(server.additionsPath, "utf8"));
  assert.equal(additions.photos[0].id, 160);
  assert.equal(additions.photos[0].visibility, "published");
  let state = await createDraftStore({ rootDir: server.draftDirectory, legacyMaxId: 158 }).read();
  assert.equal(state.photos.find((photo) => photo.id === id).status, "ready");
  assert.equal(typeof state.photos.find((photo) => photo.id === id).stagedAt, "string");

  const hidden = await server.postJson(`api/public/visibility?id=${id}`, { visibility: "archived" });
  assert.equal(hidden.status, 200);
  additions = JSON.parse(await readFile(server.additionsPath, "utf8"));
  assert.equal(additions.photos[0].visibility, "archived");
  state = await createDraftStore({ rootDir: server.draftDirectory, legacyMaxId: 158 }).read();
  assert.equal(state.photos.find((photo) => photo.id === id).status, "archived");

  const restored = await server.postJson(`api/public/visibility?id=${id}`, { visibility: "published" });
  assert.equal(restored.status, 200);
  additions = JSON.parse(await readFile(server.additionsPath, "utf8"));
  assert.equal(additions.photos[0].id, 160);
  assert.equal(additions.photos[0].visibility, "published");
  state = await createDraftStore({ rootDir: server.draftDirectory, legacyMaxId: 158 }).read();
  assert.equal(state.photos.find((photo) => photo.id === id).status, "ready");
});

test("发布增量元数据同时暂存源清单和 Pages 副本", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { sourceChange: "metadata" });

  const response = await server.publish();
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.published, true);
  const { stdout: remoteFiles } = await gitAt(server.sandbox, [
    `--git-dir=${server.remote}`,
    "ls-tree",
    "-r",
    "--name-only",
    "main",
  ]);
  assert.match(remoteFiles, /^apps\/portfolio-v2\/catalog-additions\.json$/m);
  assert.match(remoteFiles, /^docs\/projects\/portfolio-v2\/catalog-additions\.json$/m);
  assert.match(remoteFiles, /^docs\/i\/index\.html$/m);
  const [{ stdout: sourceManifest }, { stdout: pagesManifest }] = await Promise.all([
    gitAt(server.sandbox, [`--git-dir=${server.remote}`, "show", "main:apps/portfolio-v2/catalog-additions.json"]),
    gitAt(server.sandbox, [`--git-dir=${server.remote}`, "show", "main:docs/projects/portfolio-v2/catalog-additions.json"]),
  ]);
  assert.equal(pagesManifest, sourceManifest);
  assert.equal((await server.store.read()).photos[0].status, "published");
  assert.equal((await gitAt(server.repository, ["status", "--porcelain=v1"])).stdout, "");
});

test("仅隐藏或恢复元数据时服务端仍开启同步", { timeout: 120_000 }, async (t) => {
  const { publicationControlState } = await loadDraftUiState();
  for (const sourceChange of ["hide", "restore"]) {
    await t.test(sourceChange, { timeout: 60_000 }, async (scenario) => {
      const server = await createSyntheticPublishManager(scenario, { sourceChange });
      const before = await server.status();
      assert.deepEqual(before.dirtySlots, []);
      assert.equal(before.hasPendingPublication, true);
      assert.equal(publicationControlState(before).buttonDisabled, false);

      const response = await server.publish();
      const payload = await response.json();
      assert.equal(response.status, 200, payload.error);
      assert.equal(payload.published, true);
      assert.equal((await server.status()).hasPendingPublication, false);
      assert.equal((await server.store.read()).photos[0].status, sourceChange === "hide" ? "archived" : "published");
    });
  }
});

test("推送后进程退出可在干净仓库把 staged ready 安全对账到当前 HEAD", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { sourceChange: "none" });
  const [{ stdout: localBefore }, { stdout: remoteBefore }] = await Promise.all([
    gitAt(server.repository, ["rev-parse", "HEAD"]),
    gitAt(server.sandbox, [`--git-dir=${server.remote}`, "rev-parse", "main"]),
  ]);
  const status = await server.status();
  assert.deepEqual(status.dirtySlots, []);
  assert.equal(status.hasPendingPublication, true);

  const response = await server.publish();
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.noChanges, true);
  assert.deepEqual(payload.reconciledDraftIds, [159]);
  assert.equal(payload.status.hasPendingPublication, false);
  const [draft] = (await server.store.read()).photos;
  assert.equal(draft.status, "published");
  assert.equal(draft.publishedCommit, localBefore.slice(0, 7));
  const [{ stdout: localAfter }, { stdout: remoteAfter }] = await Promise.all([
    gitAt(server.repository, ["rev-parse", "HEAD"]),
    gitAt(server.sandbox, [`--git-dir=${server.remote}`, "rev-parse", "main"]),
  ]);
  assert.equal(localAfter, localBefore);
  assert.equal(remoteAfter, remoteBefore);
});

test("干净 HEAD 下已恢复的归档草稿会进入待对账并恢复为已公开", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { sourceChange: "none" });
  const [{ stdout: localBefore }, { stdout: remoteBefore }] = await Promise.all([
    gitAt(server.repository, ["rev-parse", "HEAD"]),
    gitAt(server.sandbox, [`--git-dir=${server.remote}`, "rev-parse", "main"]),
  ]);
  await server.store.markPublished([159], localBefore.slice(0, 7));
  await server.store.transitionPhoto(159, "archived");
  await server.store.addPhoto({ id: 160, uuid: "archived-unrelated", originalName: "NB-160.jpg" });
  await server.store.transitionPhoto(160, "archived");

  const before = await server.status();
  assert.equal(before.hasPendingPublication, true);
  assert.deepEqual(before.pendingPublicationIds, [159]);

  const response = await server.publish();
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.noChanges, true);
  assert.deepEqual(payload.reconciledDraftIds, [159]);
  assert.equal(payload.status.hasPendingPublication, false);
  const drafts = (await server.store.read()).photos;
  assert.equal(drafts.find((photo) => photo.id === 159).status, "published");
  assert.equal(drafts.find((photo) => photo.id === 160).status, "archived");
  const [{ stdout: localAfter }, { stdout: remoteAfter }] = await Promise.all([
    gitAt(server.repository, ["rev-parse", "HEAD"]),
    gitAt(server.sandbox, [`--git-dir=${server.remote}`, "rev-parse", "main"]),
  ]);
  assert.equal(localAfter, localBefore);
  assert.equal(remoteAfter, remoteBefore);
});

test("首次同步前已隐藏的成套客片可推送失败后原样重试", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { failFirstPush: true, sourceChange: "archived-new" });
  assert.equal((await server.status()).hasPendingPublication, true);

  const failed = await server.publish();
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /simulated push failure/);
  assert.equal((await server.store.read()).photos[0].status, "archived");
  const { stdout: afterFailure } = await gitAt(server.repository, ["status", "--porcelain=v1"]);
  assert.deepEqual(afterFailure.split("\n").filter(Boolean).map((line) => line.slice(3)).sort(), [
    "apps/portfolio-v2/catalog-additions.json",
    "apps/portfolio/assets/photos/full/photo-159.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-159.webp",
  ]);

  const retried = await server.publish();
  const payload = await retried.json();
  assert.equal(retried.status, 200, payload.error);
  assert.equal(payload.published, true);
  assert.equal((await server.store.read()).photos[0].status, "archived");
  const { stdout: remoteManifest } = await gitAt(server.sandbox, [
    `--git-dir=${server.remote}`,
    "show",
    "main:apps/portfolio-v2/catalog-additions.json",
  ]);
  assert.equal(JSON.parse(remoteManifest).photos[0].visibility, "archived");
  assert.equal((await gitAt(server.repository, ["status", "--porcelain=v1"])).stdout, "");
});

test("增量元数据推送失败恢复 Pages 副本且可安全重试", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { failFirstPush: true, sourceChange: "metadata" });

  const failed = await server.publish();
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /simulated push failure/);
  assert.equal((await server.store.read()).photos[0].status, "ready");
  const { stdout: afterFailure } = await gitAt(server.repository, ["status", "--porcelain=v1"]);
  assert.deepEqual(afterFailure.split("\n").filter(Boolean).map((line) => line.slice(3)), [
    "apps/portfolio-v2/catalog-additions.json",
  ]);

  const retried = await server.publish();
  const payload = await retried.json();
  assert.equal(retried.status, 200, payload.error);
  assert.equal(payload.published, true);
  assert.equal((await server.store.read()).photos[0].status, "published");
  assert.equal((await gitAt(server.repository, ["status", "--porcelain=v1"])).stdout, "");
});

test("提交前导出越界会恢复已知生成物且保留未知文件", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { sourceChange: "metadata", unexpectedExportOnce: true });

  const failed = await server.publish();
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /超出客片范围.*unexpected-export/);
  const { stdout: afterFailure } = await gitAt(server.repository, ["status", "--porcelain=v1"]);
  assert.deepEqual(afterFailure.split("\n").filter(Boolean).map((line) => line.slice(3)).sort(), [
    "apps/portfolio-v2/catalog-additions.json",
    "docs/unexpected-export.txt",
  ]);

  await rm(join(server.repository, "docs/unexpected-export.txt"));
  const retried = await server.publish();
  const payload = await retried.json();
  assert.equal(retried.status, 200, payload.error);
  assert.equal(payload.published, true);
  assert.equal((await gitAt(server.repository, ["status", "--porcelain=v1"])).stdout, "");
});

test("推送失败只保留源照片和 ready 草稿且下次可成功", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { failFirstPush: true, sourceChange: "photos" });

  const failed = await server.publish();
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /simulated push failure/);
  assert.equal((await server.store.read()).photos[0].status, "ready");
  const { stdout: afterFailure } = await gitAt(server.repository, ["status", "--porcelain=v1"]);
  assert.deepEqual(afterFailure.split("\n").filter(Boolean).map((line) => line.slice(3)).sort(), [
    "apps/portfolio/assets/photos/full/photo-158.jpg",
    "apps/portfolio/assets/photos/thumbs/photo-158.webp",
  ]);

  const retried = await server.publish();
  const payload = await retried.json();
  assert.equal(retried.status, 200, payload.error);
  assert.equal(payload.published, true);
  assert.equal((await server.store.read()).photos[0].status, "published");
  assert.equal((await gitAt(server.repository, ["status", "--porcelain=v1"])).stdout, "");
});

test("发布修复不绕过分支、无关文件、未登记照片和远端领先检查", { timeout: 60_000 }, async (t) => {
  const server = await createSyntheticPublishManager(t, { sourceChange: "metadata" });

  await gitAt(server.repository, ["checkout", "-b", "feature-test"]);
  let response = await server.publish();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /当前分支.*feature-test/);
  await gitAt(server.repository, ["checkout", "main"]);

  await writeFixture(join(server.repository, "unrelated.txt"), "do not stage\n");
  response = await server.publish();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /其他未提交文件/);
  await rm(join(server.repository, "unrelated.txt"));

  await writeFixture(join(server.repository, "docs/i/not-allowed.html"), "do not stage\n");
  response = await server.publish();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /其他未提交文件/);
  await rm(join(server.repository, "docs/i/not-allowed.html"));

  await writeFixture(join(server.publicPhotoRoot, "full/photo-999.jpg"), "arbitrary\n");
  await writeFixture(join(server.publicPhotoRoot, "thumbs/photo-999.webp"), "arbitrary\n");
  response = await server.publish();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /其他未提交文件|未登记|未记录/);
  await rm(join(server.publicPhotoRoot, "full/photo-999.jpg"));
  await rm(join(server.publicPhotoRoot, "thumbs/photo-999.webp"));

  const peer = join(server.sandbox, "peer");
  await gitAt(server.sandbox, ["clone", server.remote, peer]);
  await gitAt(peer, ["config", "user.name", "Nanbo Peer"]);
  await gitAt(peer, ["config", "user.email", "nanbo-peer@example.invalid"]);
  await writeFixture(join(peer, "remote-change.txt"), "remote change\n");
  await gitAt(peer, ["add", "remote-change.txt"]);
  await gitAt(peer, ["commit", "-m", "remote change"]);
  await gitAt(peer, ["push", "origin", "main"]);
  response = await server.publish();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /线上仓库有更新/);
});

test("空增量保持 158 张、23 个主题和原顺序", async () => {
  const additions = JSON.parse(await readFile(new URL("../apps/portfolio-v2/catalog-additions.json", import.meta.url), "utf8"));
  const items = buildPortfolioItems(portfolioCatalog, additions);
  assert.equal(items.length, 158);
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).length, 23);
  assert.deepEqual(items.map(({ id }) => id), buildPortfolioItems(portfolioCatalog).map(({ id }) => id));
});

test("客户页加载版本化增量清单且导出副本一致", async () => {
  const [app, index, sourceAdditions, publishedAdditions, packageJson] = await Promise.all([
    readFile(new URL("../apps/portfolio-v2/app.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/portfolio-v2/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/portfolio-v2/catalog-additions.json", import.meta.url)),
    readFile(new URL("../docs/projects/portfolio-v2/catalog-additions.json", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(app, /catalog-additions\.json\?v=/);
  assert.match(app, /buildPortfolioThemes\(/);
  assert.match(app, /emptyPortfolioAdditions/);
  assert.match(index, /id="header-photo-count"/);
  assert.match(index, /id="quick-theme-count"/);
  assert.match(index, /id="quick-photo-count"/);
  assert.deepEqual(publishedAdditions, sourceAdditions);
  assert.match(JSON.parse(packageJson).scripts["portfolio:test"], /tests\/portfolio-draft-library\.test\.mjs/);
  assert.match(JSON.parse(packageJson).scripts["portfolio:test"], /--test-concurrency=1/);
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
      { id: 159, scene: "indoor", theme: "new-light", category: "mood", title: "新光影", styleTitle: "情绪", featured: false, visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 160, scene: "outdoor", theme: "empty-theme", category: "relaxed", title: "空主题", styleTitle: "松弛", featured: false, visibility: "archived", publishedAt: "2026-08-31T00:00:00.000Z" },
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
      { id: 159, scene: "indoor", theme: "other-light", category: "mood", title: "其他光影", styleTitle: "情绪", featured: false, visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 160, scene: "indoor", theme: "new-light", category: "mood", title: "新光影", styleTitle: "情绪", featured: false, visibility: "published", publishedAt: "2026-08-31T00:01:00.000Z" },
    ],
  };
  assert.equal(buildPortfolioThemes(portfolioCatalog, additions).some(({ id }) => id === "new-light"), false);
});

test("公开增量拒绝空、非 slug 和重复主题编号", () => {
  const theme = { scene: "indoor", label: "新光影", description: "新主题", coverPhotoId: 159 };
  for (const themes of [
    [{ ...theme, id: "" }],
    [{ ...theme, id: "New Light" }],
    [{ ...theme, id: "magazine" }],
    [{ ...theme, id: "new-light" }, { ...theme, id: "new-light", coverPhotoId: 160 }],
  ]) {
    assert.throws(() => normalizePortfolioAdditions({ schemaVersion: 1, themes, photos: [] }), /主题编号/);
  }
});

test("公开增量严格拒绝顶层、主题和照片的未知字段", () => {
  const validTheme = {
    id: "new-light",
    scene: "indoor",
    label: "新光影",
    description: "新主题",
    coverPhotoId: 159,
  };
  const validPhoto = {
    id: 159,
    scene: "indoor",
    theme: "new-light",
    category: "mood",
    title: "新光影",
    styleTitle: "情绪",
    featured: false,
    visibility: "published",
    publishedAt: "2026-08-31T00:00:00.000Z",
  };

  assert.throws(() => normalizePortfolioAdditions({
    schemaVersion: 1,
    themes: [validTheme],
    photos: [validPhoto],
    unknown: "not-public",
  }), /顶层.*unknown/);

  for (const key of ["originalName", "path", "phone", "unknown"]) {
    assert.throws(() => normalizePortfolioAdditions({
      schemaVersion: 1,
      themes: [{ ...validTheme, [key]: "not-public" }],
      photos: [validPhoto],
    }), new RegExp(`主题.*${key}`));
    assert.throws(() => normalizePortfolioAdditions({
      schemaVersion: 1,
      themes: [validTheme],
      photos: [{ ...validPhoto, [key]: "not-public" }],
    }), new RegExp(`客片.*${key}`));
  }
});

test("公开增量严格校验字段类型且只返回公开字段", () => {
  const theme = {
    id: "new-light",
    scene: "indoor",
    label: "新光影",
    description: "新主题",
    coverPhotoId: 159,
  };
  const published = {
    id: 159,
    scene: "indoor",
    theme: "new-light",
    category: "mood",
    title: "新光影",
    styleTitle: "情绪",
    featured: true,
    visibility: "published",
    publishedAt: "2026-08-31T00:00:00.000Z",
  };
  const archived = {
    ...published,
    id: 160,
    featured: false,
    visibility: "archived",
  };

  assert.deepEqual(normalizePortfolioAdditions({ schemaVersion: 1, themes: [], photos: [] }), {
    schemaVersion: 1,
    themes: [],
    photos: [],
  });
  const normalized = normalizePortfolioAdditions({ schemaVersion: 1, themes: [theme], photos: [published, archived] });
  assert.deepEqual(Object.keys(normalized.themes[0]).sort(), ["coverPhotoId", "description", "id", "label", "scene"]);
  assert.deepEqual(Object.keys(normalized.photos[0]).sort(), [
    "category", "featured", "id", "publishedAt", "scene", "styleTitle", "theme", "title", "visibility",
  ]);
  assert.deepEqual(normalized.photos.map(({ visibility }) => visibility), ["published", "archived"]);

  for (const invalid of [
    { ...published, id: "159" },
    { ...published, featured: "true" },
    { ...published, title: 123 },
    { ...published, publishedAt: null },
  ]) {
    assert.throws(() => normalizePortfolioAdditions({ schemaVersion: 1, themes: [theme], photos: [invalid] }), /字段|格式/);
  }
  assert.throws(() => normalizePortfolioAdditions({
    schemaVersion: 1,
    themes: [{ ...theme, coverPhotoId: "159" }],
    photos: [published],
  }), /封面|字段|格式/);
});

test("首页推荐新增客片排在历史图库前且归档推荐不显示", () => {
  const additions = {
    schemaVersion: 1,
    themes: [],
    photos: [
      { id: 162, scene: "indoor", theme: "magazine", category: "mood", title: "杂志肖像", styleTitle: "情绪", featured: false, visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 160, scene: "indoor", theme: "magazine", category: "mood", title: "杂志肖像", styleTitle: "情绪", featured: true, visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 161, scene: "indoor", theme: "magazine", category: "mood", title: "杂志肖像", styleTitle: "情绪", featured: true, visibility: "archived", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 159, scene: "indoor", theme: "magazine", category: "mood", title: "杂志肖像", styleTitle: "情绪", featured: false, visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
      { id: 163, scene: "indoor", theme: "magazine", category: "mood", title: "杂志肖像", styleTitle: "情绪", featured: true, visibility: "published", publishedAt: "2026-08-31T00:00:00.000Z" },
    ],
  };
  const expectedLegacyOrder = [
    ...portfolioCatalog.featuredIds,
    ...Array.from({ length: portfolioCatalog.pairCount }, (_, index) => index * 2 + 1)
      .filter((id) => !portfolioCatalog.featuredIds.includes(id)),
    ...Array.from({ length: portfolioCatalog.pairCount }, (_, index) => index * 2 + 2),
  ];

  const ids = buildPortfolioItems(portfolioCatalog, additions).map(({ id }) => id);
  assert.deepEqual(ids.slice(0, 2), [160, 163]);
  assert.deepEqual(ids.slice(2, 160), expectedLegacyOrder);
  assert.deepEqual(ids.slice(160), [159, 162]);
  assert.equal(ids.includes(161), false);
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

test("markStaged 后中断的公开事务清除同一暂存值并恢复可操作界面", { timeout: 60_000 }, async (t) => {
  const sandbox = await createPublicationSandbox(t);
  const draft = await sandbox.ingestAndReady();
  const stagedAt = "2026-08-31T03:00:00.000Z";
  await sandbox.store.markStaged(draft.id, stagedAt);
  const originalAdditions = await readFile(sandbox.additionsPath, "utf8");
  const transactionDir = join(sandbox.publicationTransactionRoot, "photo-159-interrupted");
  await mkdir(transactionDir, { recursive: true });
  await writeFile(join(transactionDir, "before-additions.json"), originalAdditions);
  await writeFile(join(transactionDir, "transaction.json"), `${JSON.stringify({
    schemaVersion: 1,
    operation: "stage",
    id: 159,
    status: "manifest-installed",
    createdAt: stagedAt,
    stagedAt,
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
  const recoveredDraft = (await sandbox.store.read()).photos[0];
  assert.equal("stagedAt" in recoveredDraft, false);
  const { draftEditorState } = await loadDraftUiState();
  assert.equal(draftEditorState(recoveredDraft).showStage, true);
  assert.equal(draftEditorState(recoveredDraft).showRestore, true);

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

test("编号租约只能由持有者释放且持久化后不能释放", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-drafts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createDraftStore({ rootDir: directory, legacyMaxId: 158 });

  const first = await store.reserveId([]);
  assert.equal(first.id, 159);
  assert.equal(await store.releaseIdReservation(first), true);
  const second = await store.reserveId([]);
  assert.equal(second.id, 159);
  assert.notEqual(second.token, first.token);
  assert.equal(await store.releaseIdReservation(first), false);
  assert.equal((await store.reserveId([])).id, 160);

  await store.addPhoto({ id: second.id, uuid: "photo-a", originalName: "a.jpg" });
  assert.equal(await store.releaseIdReservation(second), false);
  assert.deepEqual((await store.read()).photos.map(({ id }) => id), [159]);
});

test("草稿生成失败释放编号租约且下一次成功仍使用 NB-159", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanbo-draft-reservation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await createTestPhoto(directory);
  const store = createDraftStore({ rootDir: join(directory, "manifest"), legacyMaxId: 158 });
  const blockedRoot = join(directory, "not-a-directory");
  await writeFile(blockedRoot, "blocks derivative directory creation\n");

  await assert.rejects(() => ingestDraftPhoto({
    inputPath: source,
    originalName: "first.jpg",
    contentType: "image/jpeg",
    store,
    rootDir: blockedRoot,
    publicIds: [],
  }), /ENOTDIR|not a directory/i);

  const record = await ingestDraftPhoto({
    inputPath: source,
    originalName: "second.jpg",
    contentType: "image/jpeg",
    store,
    rootDir: join(directory, "drafts"),
    publicIds: [],
  });
  assert.equal(record.id, 159);
  assert.deepEqual((await store.read()).photos.map(({ id }) => id), [159]);
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

test("清除暂存只接受完全相同的时间戳且不能清除更新值", async (t) => {
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

  await store.clearStaged(159, "2026-08-31T00:00:00.000Z");
  assert.equal("stagedAt" in (await store.read()).photos[0], false);
  await store.markStaged(159, "2026-08-31T00:01:00.000Z");
  await store.clearStaged(159, "2026-08-31T00:00:00.000Z");
  assert.equal((await store.read()).photos[0].stagedAt, "2026-08-31T00:01:00.000Z");
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

test("ready 草稿也不能通过通用状态转换直接发布", async (t) => {
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

  await assert.rejects(() => store.transitionPhoto(159, "published"), /ready.*published/);
  assert.equal((await store.read()).photos[0].status, "ready");
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

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import { buildPortfolioItems, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
import {
  assetPaths,
  buildPortfolioVersion,
  onlinePortfolioUrl,
  recoverIncompletePhotoTransactions,
  replacePhoto,
  root,
  run,
  slotCode,
  undoLatestPhotoReplacement,
  validateChangedPhotoBundles,
  validatePortfolioLibrary,
  writeUploadToTemporaryFile,
} from "./portfolio-photo-lib.mjs";

const host = "127.0.0.1";
const requestedPort = Number(process.env.NANBO_PORTFOLIO_PORT || 4174);
const managerRoot = join(root, "tools/portfolio-manager");
const previewRoot = join(root, "apps/portfolio-v2");
const sharedPortfolioRoot = join(root, "apps/portfolio");
const sessionToken = randomBytes(24).toString("hex");
const uploadLimit = 50 * 1024 * 1024;
let activeMutation = "";
let serverReady = false;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedPhotoExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const publishPrefixes = [
  "apps/portfolio/assets/photos/",
  "docs/projects/portfolio/assets/photos/",
  "docs/projects/portfolio-v2/",
];
const allowedHosts = new Set([`${host}:${requestedPort}`, `localhost:${requestedPort}`]);

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function errorJson(response, error, status = 400) {
  json(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
}

function beginMutation(label) {
  if (activeMutation) throw new Error(`正在${activeMutation}，请等当前操作完成`);
  activeMutation = label;
}

function finishMutation() {
  activeMutation = "";
}

function safePath(base, requestedPath) {
  const decoded = decodeURIComponent(requestedPath);
  const target = resolve(base, `.${normalize(`/${decoded}`)}`);
  const basePath = resolve(base);
  if (target !== basePath && !target.startsWith(`${basePath}${sep}`)) throw new Error("文件路径无效");
  return target;
}

function isPathInside(base, path) {
  const basePath = resolve(base);
  const target = resolve(path);
  return target === basePath || target.startsWith(`${basePath}${sep}`);
}

async function sendFile(response, path, cache = "no-cache") {
  try {
    const allowedBase = [managerRoot, previewRoot, sharedPortfolioRoot].find((base) => isPathInside(base, path));
    if (!allowedBase) throw new Error("文件路径无效");
    const info = await stat(path);
    if (!info.isFile()) throw new Error("不是文件");
    const [realBase, realTarget] = await Promise.all([realpath(allowedBase), realpath(path)]);
    if (!isPathInside(realBase, realTarget)) throw new Error("文件路径无效");
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("文件不存在");
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > uploadLimit) throw new Error("图片超过 50 MB，请先导出精修 JPG");
    chunks.push(chunk);
  }
  if (!size) throw new Error("请先选择要替换的图片");
  return Buffer.concat(chunks);
}

async function git(args, options = {}) {
  return run("git", args, { cwd: root, ...options });
}

function parseStatusLine(line) {
  const path = line.slice(3).trim().split(" -> ").at(-1);
  return { state: line.slice(0, 2), path };
}

async function repositoryStatus() {
  const [{ stdout: porcelain }, { stdout: head }, { stdout: branch }] = await Promise.all([
    git(["status", "--porcelain=v1", "--untracked-files=all"], { preserveWhitespace: true }),
    git(["rev-parse", "--short", "HEAD"]),
    git(["branch", "--show-current"]),
  ]);
  const files = porcelain ? porcelain.split("\n").filter(Boolean).map(parseStatusLine) : [];
  const changedFiles = files.map((item) => item.path);
  const sourcePhotoChanges = changedFiles.filter((path) => path.startsWith("apps/portfolio/assets/photos/"));
  const dirtySlots = [...new Set(sourcePhotoChanges.flatMap((path) => {
    const match = path.match(/photo-(\d{3})\.(?:jpg|webp)$/i);
    return match ? [Number(match[1])] : [];
  }))].sort((a, b) => a - b);
  const unrelatedFiles = changedFiles.filter((path) => !publishPrefixes.some((prefix) => path.startsWith(prefix)));
  return {
    head,
    branch,
    dirtySlots,
    changedFiles,
    unrelatedFiles,
    buildVersion: await buildPortfolioVersion(),
  };
}

async function catalogPayload() {
  const version = await buildPortfolioVersion();
  const items = buildPortfolioItems().map((item) => ({
    ...item,
    isHeroAsset: portfolioCatalog.heroAssetIds.includes(item.id),
    thumbUrl: `/media/thumb/${item.id}?v=${version}`,
    fullUrl: `/media/full/${item.id}?v=${version}`,
  }));
  return {
    items,
    scenes: portfolioCatalog.scenes,
    themes: portfolioCatalog.themes.map(({ series, ...theme }) => ({ ...theme, count: series.length * 2 })),
    photoCount: portfolioCatalog.photoCount,
    onlineUrl: `${onlinePortfolioUrl}?v=${version}`,
    version,
  };
}

function requireSession(request) {
  const origin = String(request.headers.origin || "");
  const fetchSite = String(request.headers["sec-fetch-site"] || "");
  const allowedOrigins = new Set([`http://${host}:${requestedPort}`, `http://localhost:${requestedPort}`]);
  if ((origin && !allowedOrigins.has(origin)) || fetchSite === "cross-site") {
    const error = new Error("为保护本地客片，已拒绝其他网页发起的操作");
    error.status = 403;
    throw error;
  }
  if (request.headers["x-nanbo-token"] !== sessionToken) {
    const error = new Error("管理台会话已过期，请刷新页面后重试");
    error.status = 403;
    throw error;
  }
}

async function replacePhotoRequest(request, response, url) {
  requireSession(request);
  beginMutation("替换客片");
  try {
    await recoverIncompletePhotoTransactions();
    const id = Number(url.searchParams.get("id"));
    const originalName = decodeURIComponent(String(request.headers["x-file-name"] || "未命名图片"));
    const extension = extname(originalName).toLowerCase();
    const contentType = String(request.headers["content-type"] || "").split(";")[0];
    if (!allowedPhotoTypes.has(contentType) && !allowedPhotoExtensions.has(extension)) {
      throw new Error("只支持 JPG、PNG 或 WebP 图片");
    }
    const buffer = await readBody(request);
    const temporary = await writeUploadToTemporaryFile(buffer, allowedPhotoExtensions.has(extension) ? extension : ".jpg");
    try {
      const result = await replacePhoto(id, temporary.path, originalName);
      json(response, 200, { ok: true, result, status: await repositoryStatus() });
    } finally {
      await rm(temporary.directory, { recursive: true, force: true });
    }
  } finally {
    finishMutation();
  }
}

async function undoPhotoRequest(request, response, url) {
  requireSession(request);
  beginMutation("恢复客片");
  try {
    await recoverIncompletePhotoTransactions();
    const result = await undoLatestPhotoReplacement(Number(url.searchParams.get("id")));
    json(response, 200, { ok: true, result, status: await repositoryStatus() });
  } finally {
    finishMutation();
  }
}

async function sourcePhotoFilesFromGit() {
  const { stdout } = await git(
    ["status", "--porcelain=v1", "--untracked-files=all", "--", "apps/portfolio/assets/photos"],
    { preserveWhitespace: true },
  );
  if (!stdout) return [];
  return stdout.split("\n").filter(Boolean).map(parseStatusLine).map((item) => item.path);
}

async function publishPhotos(request, response) {
  requireSession(request);
  beginMutation("同步网站");
  try {
    await recoverIncompletePhotoTransactions();
    const validation = await validatePortfolioLibrary();
    if (!validation.ok) throw new Error(`发布前校验未通过：${validation.errors.join("；")}`);

    const statusBefore = await repositoryStatus();
    if (statusBefore.branch !== "main") throw new Error(`当前分支是 ${statusBefore.branch || "未知"}，请让 Codex 切回 main 再同步`);
    if (statusBefore.unrelatedFiles.length) {
      throw new Error(`发现其他未提交文件，已停止同步：${statusBefore.unrelatedFiles.slice(0, 5).join("、")}`);
    }
    const { stdout: stagedBefore } = await git(["diff", "--cached", "--name-only"]);
    if (stagedBefore) throw new Error("仓库里已有人工暂存的文件，为避免混在一起，请先让 Codex 处理");

    await git(["fetch", "--quiet", "origin", "main"]);
    const { stdout: divergence } = await git(["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
    const [ahead, behind] = divergence.split(/\s+/).map(Number);
    if (behind > 0) throw new Error("线上仓库有更新的内容，请先让 Codex 合并，系统没有强行覆盖");
    if (ahead > 0) throw new Error("本机有还未推送的代码提交，请先让 Codex 确认后再发布照片");

    const sourceFiles = await sourcePhotoFilesFromGit();
    if (!sourceFiles.length) {
      json(response, 200, { ok: true, noChanges: true, message: "本地没有待同步的新照片", status: statusBefore });
      return;
    }
    const allowedSourceFiles = new Set();
    for (let id = 1; id <= portfolioCatalog.photoCount; id += 1) {
      const filename = `photo-${String(id).padStart(3, "0")}`;
      allowedSourceFiles.add(`apps/portfolio/assets/photos/full/${filename}.jpg`);
      allowedSourceFiles.add(`apps/portfolio/assets/photos/thumbs/${filename}.webp`);
      if (portfolioCatalog.heroAssetIds.includes(id)) allowedSourceFiles.add(`apps/portfolio/assets/photos/featured/${filename}.webp`);
    }
    const invalidSourceFile = sourceFiles.find((path) => !allowedSourceFiles.has(path));
    if (invalidSourceFile) throw new Error(`未登记的照片文件不会发布：${invalidSourceFile}`);
    const bundleValidation = validateChangedPhotoBundles(sourceFiles);
    if (!bundleValidation.ok) {
      throw new Error(`同一编号的图片不完整，已停止发布：${bundleValidation.errors.join("；")}`);
    }
    const nonSourceChanges = statusBefore.changedFiles.filter((path) => !sourceFiles.includes(path));
    if (nonSourceChanges.length) throw new Error(`发布前存在非源图片改动：${nonSourceChanges.slice(0, 5).join("、")}`);

    await run(process.execPath, [join(root, "tools/export-github-pages.mjs")], { cwd: root });
    const version = await buildPortfolioVersion();
    const stagePaths = new Set([
      ...sourceFiles,
      "docs/projects/portfolio-v2/index.html",
      "docs/projects/portfolio-v2/app.js",
      "docs/projects/portfolio-v2/build.json",
    ]);
    for (const sourcePath of sourceFiles) {
      const suffix = relative("apps/portfolio", sourcePath);
      stagePaths.add(join("docs/projects/portfolio", suffix));
    }
    const statusAfterExport = await repositoryStatus();
    const unexpectedExport = statusAfterExport.changedFiles.filter((path) => !stagePaths.has(path));
    if (unexpectedExport.length) {
      throw new Error(`导出产生了超出客片范围的改动，已停止提交：${unexpectedExport.slice(0, 5).join("、")}`);
    }
    await git(["add", "--", ...stagePaths]);
    const { code: hasNoStagedDiff } = await git(["diff", "--cached", "--quiet"], { allowFailure: true });
    if (hasNoStagedDiff === 0) {
      json(response, 200, { ok: true, noChanges: true, message: "生成结果与线上完全一致", status: await repositoryStatus() });
      return;
    }

    const slots = bundleValidation.slots;
    const summary = slots.length <= 6 ? slots.map(slotCode).join("、") : `${slots.length} 张客片`;
    await git(["commit", "-m", `更新南铂客片 ${summary}`]);
    await git(["push", "origin", "main"]);
    const { stdout: commit } = await git(["rev-parse", "--short", "HEAD"]);
    json(response, 200, {
      ok: true,
      published: true,
      commit,
      version,
      slots,
      onlineUrl: `${onlinePortfolioUrl}?v=${version}`,
      message: "GitHub 已接收，正在更新网站",
      status: await repositoryStatus(),
    });
  } finally {
    finishMutation();
  }
}

async function deployStatus(response, url) {
  const version = url.searchParams.get("version") || "";
  if (!version) throw new Error("缺少待验证的版本号");
  try {
    const checkUrl = `${onlinePortfolioUrl}build.json?check=${Date.now()}`;
    const onlineResponse = await fetch(checkUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!onlineResponse.ok) throw new Error(`HTTP ${onlineResponse.status}`);
    const online = await onlineResponse.json();
    json(response, 200, {
      ok: true,
      ready: online.version === version,
      expectedVersion: version,
      onlineVersion: online.version || "",
      onlineUrl: `${onlinePortfolioUrl}?v=${version}`,
    });
  } catch (error) {
    json(response, 200, { ok: true, ready: false, expectedVersion: version, onlineVersion: "", waitingReason: error.message });
  }
}

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${host}:${requestedPort}`);
  try {
    if (!allowedHosts.has(String(request.headers.host || ""))) {
      const error = new Error("已拒绝非本机地址访问");
      error.status = 403;
      throw error;
    }
    if (!serverReady) {
      const error = new Error("正在检查上次换图状态，请稍后刷新");
      error.status = 503;
      throw error;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      json(response, 200, { ok: true, token: sessionToken });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/catalog") {
      json(response, 200, { ok: true, ...(await catalogPayload()) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      json(response, 200, { ok: true, ...(await repositoryStatus()) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/replace") {
      await replacePhotoRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/undo") {
      await undoPhotoRequest(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/publish") {
      await publishPhotos(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/deploy-status") {
      await deployStatus(response, url);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const match = url.pathname.match(/^\/media\/(thumb|full)\/(\d{1,3})$/);
      if (!match) throw new Error("客片路径无效");
      const paths = assetPaths(Number(match[2]));
      await sendFile(response, match[1] === "thumb" ? paths.thumb : paths.full, "no-cache");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/preview")) {
      const requested = url.pathname.replace(/^\/preview\/?/, "") || "index.html";
      await sendFile(response, safePath(previewRoot, requested), "no-cache");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/portfolio/")) {
      const requested = url.pathname.replace(/^\/portfolio\/?/, "");
      await sendFile(response, safePath(sharedPortfolioRoot, requested), "no-cache");
      return;
    }
    if (request.method === "GET") {
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      await sendFile(response, safePath(managerRoot, requested), "no-store");
      return;
    }
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("不支持这个操作");
  } catch (error) {
    errorJson(response, error, error.status || 400);
  }
}

const server = createServer(route);
server.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    const url = `http://${host}:${requestedPort}/`;
    try {
      const existing = await fetch(`${url}api/catalog`, { signal: AbortSignal.timeout(2500) });
      const payload = await existing.json();
      if (!payload.ok || payload.photoCount !== portfolioCatalog.photoCount) throw new Error("不是南铂客片管理台");
      console.log(`南铂客片管理台已在运行：${url}`);
      if (process.argv.includes("--open")) spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" }).unref();
      process.exit(0);
    } catch {
      console.error(`本机端口 ${requestedPort} 已被其他程序使用，请把这句话复制给 Codex 处理。`);
      process.exit(1);
    }
  }
  throw error;
});
server.listen(requestedPort, host, async () => {
  const url = `http://${host}:${requestedPort}/`;
  try {
    // 只有成功绑定端口的单一进程才允许检查事务目录。第二次双击会先走
    // EADDRINUSE，不会把第一个进程的正在换图误当成崩溃恢复。
    const recoveredTransactions = await recoverIncompletePhotoTransactions();
    if (recoveredTransactions.length) {
      console.log(`已自动恢复中断的换图：${recoveredTransactions.join("、")}`);
    }
    serverReady = true;
    console.log(`南铂客片管理台：${url}`);
    console.log("保持这个窗口开启；结束时可直接关闭窗口。");
    if (process.argv.includes("--open")) spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch (error) {
    console.error(`客片安全检查未完成：${error.message}`);
    server.close(() => process.exit(1));
  }
});

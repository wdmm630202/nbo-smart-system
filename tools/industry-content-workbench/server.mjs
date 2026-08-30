import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";

import {
  STAGE_IDS,
  STAGE_LABELS,
  WORKBENCH_HOST,
  WORKBENCH_PORT,
  WORKBENCH_ROOT,
  WORKBENCH_VERSION,
} from "./constants.mjs";
import { indexMedia, verifyMediaFingerprint } from "./media-library.mjs";
import { createProjectStore } from "./project-store.mjs";
import { selectLocalPath } from "./select-path.mjs";

const PATCHABLE_FIELDS = new Set([
  "title",
  "platform",
  "targetDurationSeconds",
  "currentStage",
  "stages",
  "approvals",
  "evidence",
  "claims",
  "nanboClaimIds",
  "script",
  "voice",
  "storyboard",
  "mediaAssets",
  "outputs",
  "qa",
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/industry-content-workbench");
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new HttpError(413, "请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "JSON 格式无效");
  }
}

function patchProject(project, patch) {
  const next = { ...project };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!PATCHABLE_FIELDS.has(key)) throw new HttpError(400, `不可修改字段：${key}`);
    next[key] = value;
  }
  return next;
}

function openLocalBrowser(origin) {
  execFile("open", [origin], () => {});
}

export async function createWorkbenchServer({
  host = WORKBENCH_HOST,
  port = WORKBENCH_PORT,
  rootDir = WORKBENCH_ROOT,
  openBrowser = false,
  dependencies = {},
} = {}) {
  if (host !== "127.0.0.1") throw new Error("工作台只允许绑定 127.0.0.1");
  const projectStore = dependencies.projectStore || createProjectStore({ rootDir });
  const choosePath = dependencies.selectLocalPath || selectLocalPath;
  const buildIndex = dependencies.indexMedia || indexMedia;
  const verifyFingerprint = dependencies.verifyMediaFingerprint || verifyMediaFingerprint;
  const token = randomBytes(32).toString("hex");
  let origin;
  let allowedHosts;

  function requireAllowedHost(request) {
    if (!allowedHosts.has(String(request.headers.host || ""))) throw new HttpError(403, "已拒绝非本地请求");
  }

  function requireMutation(request) {
    requireAllowedHost(request);
    if (String(request.headers["sec-fetch-site"] || "") === "cross-site") throw new HttpError(403, "已拒绝跨站操作");
    const requestOrigin = String(request.headers.origin || "");
    if (requestOrigin && requestOrigin !== origin) throw new HttpError(403, "已拒绝不同源操作");
    if (request.headers["x-nanbo-token"] !== token) throw new HttpError(403, "工作台会话已过期");
  }

  const server = createServer(async (request, response) => {
    try {
      requireAllowedHost(request);
      const url = new URL(request.url || "/", origin);
      const pathname = decodeURIComponent(url.pathname);

      if (request.method === "GET" && STATIC_FILES.has(pathname)) {
        const filename = STATIC_FILES.get(pathname);
        const path = resolve(APP_DIR, filename);
        await access(path);
        const headers = {
          "cache-control": "no-store",
          "content-type": CONTENT_TYPES[extname(path)] || "application/octet-stream",
          "x-content-type-options": "nosniff",
        };
        if (filename === "index.html") {
          headers["content-security-policy"] = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
        }
        response.writeHead(200, headers);
        createReadStream(path).pipe(response);
        return;
      }

      if (request.method === "GET" && pathname === "/healthz") {
        return json(response, 200, {
          ready: true,
          version: WORKBENCH_VERSION,
          host,
          dependencies: { ledger: "ready", mediaIndex: "ready", pathSelector: "ready" },
        });
      }

      if (request.method === "GET" && pathname === "/api/bootstrap") {
        return json(response, 200, {
          token,
          version: WORKBENCH_VERSION,
          stages: STAGE_IDS.map((id) => ({ id, label: STAGE_LABELS[id] })),
          projects: await projectStore.listProjects(),
        });
      }

      if (request.method === "GET" && pathname === "/api/projects") {
        return json(response, 200, await projectStore.listProjects());
      }

      if (request.method === "POST" && pathname === "/api/projects") {
        requireMutation(request);
        return json(response, 201, await projectStore.createProject(await readJson(request)));
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{2,63})$/);
      if (projectMatch && request.method === "GET") {
        return json(response, 200, await projectStore.readProject(projectMatch[1]));
      }
      if (projectMatch && request.method === "PATCH") {
        requireMutation(request);
        const patch = await readJson(request);
        return json(response, 200, await projectStore.updateProject(projectMatch[1], (project) => patchProject(project, patch)));
      }

      if (request.method === "POST" && pathname === "/api/select-path") {
        requireMutation(request);
        const { kind } = await readJson(request);
        const selectedPath = await choosePath({ kind });
        return json(response, 200, {
          selectedPath,
          assets: selectedPath ? await buildIndex([selectedPath]) : [],
        });
      }

      const mediaMatch = pathname.match(/^\/media\/([a-z0-9][a-z0-9-]{2,63})\/([a-zA-Z0-9-]{3,80})$/);
      if (request.method === "GET" && mediaMatch) {
        const project = await projectStore.readProject(mediaMatch[1]);
        const asset = project.mediaAssets.find(({ assetId }) => assetId === mediaMatch[2]);
        if (!asset) throw new HttpError(404, "素材不存在");
        const verification = await verifyFingerprint(asset);
        if (!verification.ok) throw new HttpError(409, "素材已发生变化，请重新索引");
        await access(asset.path);
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": CONTENT_TYPES[extname(asset.path).toLowerCase()] || "application/octet-stream",
          "x-content-type-options": "nosniff",
        });
        createReadStream(asset.path).pipe(response);
        return;
      }

      throw new HttpError(404, "页面不存在");
    } catch (error) {
      const status = error instanceof HttpError
        ? error.status
        : /ENOENT/.test(String(error?.code || error?.message || ""))
          ? 404
          : 500;
      json(response, status, { error: status === 500 ? "工作台处理失败" : error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  origin = `http://${host}:${actualPort}`;
  allowedHosts = new Set([`${host}:${actualPort}`, `localhost:${actualPort}`]);

  if (openBrowser === true) openLocalBrowser(origin);
  else if (typeof openBrowser === "function") await openBrowser(origin);

  return {
    origin,
    token,
    rootDir,
    server,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workbench = await createWorkbenchServer({ openBrowser: process.argv.includes("--open") });
  console.log(`南铂行业内容工作台已启动：${workbench.origin}`);
}

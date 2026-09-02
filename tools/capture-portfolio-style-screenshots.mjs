import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputRoot = new URL("../docs/", import.meta.url);

function contentType(pathname) {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function startPreview() {
  const sourceHtml = await readFile(new URL("../apps/portfolio-v2/index.html", import.meta.url), "utf8");
  const page = sourceHtml
    .replace(/<script src="https:\/\/res\.wx\.qq\.com[^>]+><\/script>/, "")
    .replace(/<script type="module" src="wechat-share\.js[^>]+><\/script>/, "");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/portfolio-v2/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page);
        return;
      }
      const asset = await readFile(new URL(`../apps${url.pathname}`, import.meta.url));
      response.writeHead(200, { "Content-Type": contentType(url.pathname) });
      response.end(asset);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}/portfolio-v2/index.html?v=screenshot-acceptance`,
  };
}

async function captureSelector(url, width, height, outputName) {
  const profileDir = await mkdtemp(join(tmpdir(), "nbo-style-capture-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ]);
  let stderr = "";
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Chrome DevTools 启动超时: ${stderr}`)), 8_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome 提前退出（${code}）：${stderr}`));
    });
  });
  const socket = new WebSocket(debuggerUrl);
  const pending = new Map();
  let nextMessageId = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
    else resolve(message.result);
  });
  const command = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++nextMessageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  try {
    const { targetId } = await command("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
      screenWidth: width,
      screenHeight: height,
    }, sessionId);
    await command("Page.navigate", { url }, sessionId);
    const readyExpression = `
      (async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (document.querySelectorAll("#style-card-grid .portrait-style-card").length === 11) break;
          await wait(50);
        }
        await (document.fonts?.ready || Promise.resolve());
        await Promise.race([
          Promise.all([...document.querySelectorAll("#style-card-grid img")]
            .map((image) => image.decode?.().catch(() => {}))),
          wait(1000),
        ]);
        const heading = document.querySelector(".style-explorer-heading");
        const header = document.querySelector(".mini-header");
        const previousScrollBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";
        heading?.scrollIntoView({ block: "start" });
        document.documentElement.style.scrollBehavior = previousScrollBehavior;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const headingRect = heading?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        return {
          headerBottom: headerRect?.bottom || 0,
          headingTop: headingRect?.top || 0,
          headingBottom: headingRect?.bottom || 0,
          viewport: window.innerWidth + "x" + window.innerHeight,
        };
      })()
    `;
    const ready = await command("Runtime.evaluate", {
      expression: readyExpression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    const geometry = ready.result?.value;
    if (!geometry || geometry.viewport !== `${width}x${height}`
      || geometry.headingTop < geometry.headerBottom + 16
      || geometry.headingBottom > height) {
      throw new Error(`截图标题位置无效：${JSON.stringify(geometry)}`);
    }
    const screenshot = await command("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }, sessionId);
    await writeFile(new URL(outputName, outputRoot), Buffer.from(screenshot.data, "base64"));
    return geometry;
  } finally {
    socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    await rm(profileDir, { recursive: true, force: true });
  }
}

const preview = await startPreview();
try {
  const results = await Promise.all([
    captureSelector(preview.url, 390, 844, "portfolio-132-style-mobile.png"),
    captureSelector(preview.url, 1440, 1200, "portfolio-132-style-desktop.png"),
  ]);
  console.log(JSON.stringify(results));
} finally {
  await preview.close();
}

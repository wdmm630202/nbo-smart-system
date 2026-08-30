import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fingerprintFile } from "../tools/industry-content-workbench/media-library.mjs";
import { createWorkbenchServer } from "../tools/industry-content-workbench/server.mjs";

async function startTestServer(overrides = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "nbo-content-server-"));
  const workbench = await createWorkbenchServer({
    host: "127.0.0.1",
    port: 0,
    rootDir,
    openBrowser: false,
    dependencies: {
      selectLocalPath: async () => null,
      indexMedia: async () => [],
      ...overrides,
    },
  });
  return {
    ...workbench,
    rootDir,
    async cleanup() {
      await workbench.close();
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

function mutationHeaders(origin, token, extra = {}) {
  return {
    "content-type": "application/json",
    "x-nanbo-token": token,
    origin,
    ...extra,
  };
}

test("服务只绑定回环地址且健康检查不泄露会话令牌", async () => {
  const server = await startTestServer();
  try {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${server.origin}/healthz`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ready, true);
    assert.equal(JSON.stringify(body).includes(server.token), false);
  } finally {
    await server.cleanup();
  }
});

test("本地修改必须同源且携带会话令牌", async () => {
  const server = await startTestServer();
  try {
    const rejected = await fetch(`${server.origin}/api/projects`, { method: "POST", body: "{}" });
    assert.equal(rejected.status, 403);

    const accepted = await fetch(`${server.origin}/api/projects`, {
      method: "POST",
      headers: mutationHeaders(server.origin, server.token),
      body: JSON.stringify({ projectId: "episode-server", title: "测试项目", platform: "xiaohongshu" }),
    });
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).projectId, "episode-server");

    const crossSite = await fetch(`${server.origin}/api/projects`, {
      method: "POST",
      headers: mutationHeaders(server.origin, server.token, { "sec-fetch-site": "cross-site" }),
      body: JSON.stringify({ title: "不应创建", platform: "xiaohongshu" }),
    });
    assert.equal(crossSite.status, 403);
  } finally {
    await server.cleanup();
  }
});

test("bootstrap 与项目 API 可恢复同一份项目账本", async () => {
  const server = await startTestServer();
  try {
    const bootstrap = await (await fetch(`${server.origin}/api/bootstrap`)).json();
    assert.equal(bootstrap.token, server.token);
    assert.equal(bootstrap.projects.length, 0);
    assert.equal(bootstrap.stages.length, 6);

    await fetch(`${server.origin}/api/projects`, {
      method: "POST",
      headers: mutationHeaders(server.origin, server.token),
      body: JSON.stringify({ projectId: "episode-resume", title: "底片透明", platform: "both" }),
    });
    const updated = await fetch(`${server.origin}/api/projects/episode-resume`, {
      method: "PATCH",
      headers: mutationHeaders(server.origin, server.token),
      body: JSON.stringify({ currentStage: "script", script: { narration: "测试旁白", captions: [] } }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).script.narration, "测试旁白");
    const recovered = await (await fetch(`${server.origin}/api/projects/episode-resume`)).json();
    assert.equal(recovered.currentStage, "script");
  } finally {
    await server.cleanup();
  }
});

test("路径选择只在带令牌请求后执行并立即建立只读索引", async () => {
  let selections = 0;
  const server = await startTestServer({
    selectLocalPath: async ({ kind }) => {
      selections += 1;
      assert.equal(kind, "folder");
      return "/tmp/南铂素材";
    },
    indexMedia: async (paths) => [{ assetId: "asset-1", name: "测试.mp4", path: paths[0], sha256: "abc", media: { type: "video" } }],
  });
  try {
    const denied = await fetch(`${server.origin}/api/select-path`, { method: "POST", body: JSON.stringify({ kind: "folder" }) });
    assert.equal(denied.status, 403);
    assert.equal(selections, 0);

    const accepted = await fetch(`${server.origin}/api/select-path`, {
      method: "POST",
      headers: mutationHeaders(server.origin, server.token),
      body: JSON.stringify({ kind: "folder" }),
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).assets[0].assetId, "asset-1");
    assert.equal(selections, 1);
  } finally {
    await server.cleanup();
  }
});

test("媒体端点只服务账本内且指纹未变化的文件", async () => {
  const server = await startTestServer();
  const mediaPath = join(server.rootDir, "preview.mp4");
  try {
    await writeFile(mediaPath, "safe-preview");
    const sha256 = await fingerprintFile(mediaPath);
    await fetch(`${server.origin}/api/projects`, {
      method: "POST",
      headers: mutationHeaders(server.origin, server.token),
      body: JSON.stringify({ projectId: "episode-media", title: "媒体预览", platform: "douyin" }),
    });
    await fetch(`${server.origin}/api/projects/episode-media`, {
      method: "PATCH",
      headers: mutationHeaders(server.origin, server.token),
      body: JSON.stringify({ mediaAssets: [{ assetId: "preview-1", path: mediaPath, sha256, media: { type: "video" } }] }),
    });

    const served = await fetch(`${server.origin}/media/episode-media/preview-1`);
    assert.equal(served.status, 200);
    assert.equal(await served.text(), "safe-preview");
    assert.equal((await fetch(`${server.origin}/media/episode-media/../../etc/passwd`)).status, 404);

    await writeFile(mediaPath, "tampered");
    assert.equal((await fetch(`${server.origin}/media/episode-media/preview-1`)).status, 409);
  } finally {
    await server.cleanup();
  }
});

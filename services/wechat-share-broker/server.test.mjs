import assert from "node:assert/strict";
import test from "node:test";

import { createBrokerServer } from "./server.js";

const SHARED_SECRET = "test-secret-that-is-at-least-thirty-two-bytes";

async function withServer(options, run) {
  const server = createBrokerServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await run(origin);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function defaultOptions(overrides = {}) {
  return {
    env: {
      WECHAT_APP_ID: "wx-test-appid",
      BROKER_SHARED_SECRET: SHARED_SECRET,
    },
    ticketProvider: { getTicket: async () => "ticket-123" },
    now: () => 1_788_020_000_000,
    nonceStr: () => "nonce-456",
    ...overrides,
  };
}

test("GET /healthz 无需鉴权且不请求 ticket", async () => {
  let ticketCalls = 0;
  await withServer(
    defaultOptions({
      ticketProvider: {
        getTicket: async () => {
          ticketCalls += 1;
          throw new Error("unexpected ticket request");
        },
      },
    }),
    async (origin) => {
      const response = await fetch(`${origin}/healthz`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(ticketCalls, 0);
    },
  );
});

test("签名端点拒绝缺失或错误 Bearer 密钥", async () => {
  await withServer(defaultOptions(), async (origin) => {
    for (const authorization of [null, "Bearer wrong-secret-that-is-also-long-enough"]) {
      const headers = { "Content-Type": "application/json" };
      if (authorization) headers.Authorization = authorization;
      const response = await fetch(`${origin}/v1/signature`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: "https://p.nanbostudio.com/" }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
  });
});

test("签名端点限制方法、路径、媒体类型和请求体大小", async () => {
  await withServer(defaultOptions(), async (origin) => {
    const methodResponse = await fetch(`${origin}/v1/signature`);
    assert.equal(methodResponse.status, 405);
    assert.equal(methodResponse.headers.get("allow"), "POST");

    assert.equal((await fetch(`${origin}/missing`)).status, 404);

    const mediaResponse = await fetch(`${origin}/v1/signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SHARED_SECRET}` },
      body: JSON.stringify({ url: "https://p.nanbostudio.com/" }),
    });
    assert.equal(mediaResponse.status, 415);

    const oversizedResponse = await fetch(`${origin}/v1/signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: `https://p.nanbostudio.com/?q=${"x".repeat(9000)}` }),
    });
    assert.equal(oversizedResponse.status, 413);
  });
});

test("签名端点只返回 JS-SDK 需要的五个字段", async () => {
  await withServer(defaultOptions(), async (origin) => {
    const response = await fetch(`${origin}/v1/signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://p.nanbostudio.com/?from=wechat#works" }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.deepEqual(await response.json(), {
      appId: "wx-test-appid",
      timestamp: 1788020000,
      nonceStr: "nonce-456",
      signature: "cddf18a899c39e0cace18a92b2e88a7a53ae5246",
      url: "https://p.nanbostudio.com/?from=wechat",
    });
  });
});

test("非法 URL 和上游错误只返回稳定错误码", async () => {
  await withServer(defaultOptions(), async (origin) => {
    const invalidResponse = await fetch(`${origin}/v1/signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), { error: "invalid_wechat_url" });
  });

  await withServer(
    defaultOptions({
      ticketProvider: { getTicket: async () => Promise.reject(new Error("sensitive")) },
    }),
    async (origin) => {
      const response = await fetch(`${origin}/v1/signature`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SHARED_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://p.nanbostudio.com/" }),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "wechat_openapi_unavailable" });
    },
  );
});

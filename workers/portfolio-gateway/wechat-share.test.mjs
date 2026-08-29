import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  fetchBrokerSignature,
  handleWechatSignature,
  normalizeWechatPageUrl,
} from "./wechat-share.js";

function fakeEnv() {
  return {
    WECHAT_BROKER_URL: "https://nanbo-wx-share.example/",
    WECHAT_BROKER_SECRET: "test-broker-secret",
  };
}

const validBrokerPayload = {
  appId: "wx-test-appid",
  timestamp: 1788020000,
  nonceStr: "nonce-456",
  signature: "cddf18a899c39e0cace18a92b2e88a7a53ae5246",
  url: "https://p.nanbostudio.com/?from=wechat",
};

test("Worker 配置不再绑定 AppSecret 和微信凭据 KV", async () => {
  const wrangler = await readFile(new URL("wrangler.jsonc", import.meta.url), "utf8");
  assert.doesNotMatch(wrangler, /WECHAT_APP_SECRET|WECHAT_CACHE|WECHAT_APP_ID/);
  assert.match(wrangler, /WECHAT_BROKER_SECRET/);
});

test("微信签名只接受南铂 HTTPS 页面并移除哈希", () => {
  assert.equal(
    normalizeWechatPageUrl("https://p.nanbostudio.com/?from=wechat#works"),
    "https://p.nanbostudio.com/?from=wechat",
  );

  for (const value of [
    "http://p.nanbostudio.com/",
    "https://example.com/",
    "https://name:pass@p.nanbostudio.com/",
    "https://p.nanbostudio.com:444/",
    "not-a-url",
  ]) {
    assert.throws(
      () => normalizeWechatPageUrl(value),
      (error) => error.code === "invalid_wechat_url" && error.status === 400,
    );
  }
});

test("Cloudflare 只向云托管发送 URL 和 Bearer 鉴权", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json(validBrokerPayload);
  };

  const payload = await fetchBrokerSignature(
    fakeEnv(),
    "https://p.nanbostudio.com/?from=wechat",
    fetchImpl,
  );

  assert.deepEqual(payload, validBrokerPayload);
  assert.equal(requests[0].url, "https://nanbo-wx-share.example/v1/signature");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-broker-secret");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    url: "https://p.nanbostudio.com/?from=wechat",
  });
  assert.doesNotMatch(requests[0].options.body, /appsecret|access_token|ticket/i);
});

test("云托管错误和非法响应只映射为稳定错误码", async () => {
  await assert.rejects(
    () =>
      fetchBrokerSignature(
        fakeEnv(),
        "https://p.nanbostudio.com/",
        async () => Response.json({ error: "sensitive upstream detail" }, { status: 401 }),
      ),
    (error) =>
      error.code === "wechat_broker_unavailable" &&
      error.status === 503 &&
      !error.message.includes("sensitive upstream detail"),
  );

  await assert.rejects(
    () =>
      fetchBrokerSignature(
        fakeEnv(),
        "https://p.nanbostudio.com/",
        async () => Response.json({ ...validBrokerPayload, ticket: "must-not-pass" }),
      ),
    (error) => error.code === "wechat_broker_unavailable" && error.status === 503,
  );
});

test("签名端点拒绝非法方法、来源和缺失 URL", async () => {
  assert.equal(
    (
      await handleWechatSignature(
        new Request("https://p.nanbostudio.com/api/wechat-share/signature", { method: "POST" }),
        fakeEnv(),
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await handleWechatSignature(
        new Request("https://p.nanbostudio.com/api/wechat-share/signature", {
          headers: { Origin: "https://example.com" },
        }),
        fakeEnv(),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleWechatSignature(
        new Request("https://p.nanbostudio.com/api/wechat-share/signature"),
        fakeEnv(),
      )
    ).status,
    400,
  );
});

test("签名端点只转发网页初始化所需字段且禁止缓存", async () => {
  const pageUrl = "https://p.nanbostudio.com/?from=wechat#works";
  const endpoint = new URL("https://p.nanbostudio.com/api/wechat-share/signature");
  endpoint.searchParams.set("url", pageUrl);

  const response = await handleWechatSignature(new Request(endpoint), fakeEnv(), {
    fetchImpl: async () => Response.json(validBrokerPayload),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(payload, validBrokerPayload);
  assert.deepEqual(Object.keys(payload).sort(), [
    "appId",
    "nonceStr",
    "signature",
    "timestamp",
    "url",
  ]);
});

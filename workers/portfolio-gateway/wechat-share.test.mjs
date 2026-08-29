import assert from "node:assert/strict";
import test from "node:test";

import {
  createWechatSignature,
  getWechatAccessToken,
  getWechatJsapiTicket,
  handleWechatSignature,
  normalizeWechatPageUrl,
} from "./wechat-share.js";

function fakeEnv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const putTtls = [];
  return {
    WECHAT_APP_ID: "wx-test-appid",
    WECHAT_APP_SECRET: "test-secret",
    putTtls,
    WECHAT_CACHE: {
      async get(key, options = {}) {
        const value = store.get(key);
        if (value === undefined) return null;
        return options.type === "json" ? value : JSON.stringify(value);
      },
      async put(key, value, options = {}) {
        store.set(key, JSON.parse(value));
        putTtls.push(options.expirationTtl);
      },
    },
  };
}

function sequentialWechatFetch(payloads) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : null,
    });
    const payload = payloads.shift();
    return Response.json(payload);
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

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
    assert.throws(() => normalizeWechatPageUrl(value), /invalid_wechat_url/);
  }
});

test("微信签名使用官方字段顺序生成小写 SHA-1", async () => {
  const signature = await createWechatSignature({
    ticket: "ticket-123",
    nonceStr: "nonce-456",
    timestamp: 1788020000,
    url: "https://p.nanbostudio.com/?from=wechat",
  });

  assert.equal(signature, "cddf18a899c39e0cace18a92b2e88a7a53ae5246");
});

test("有效缓存命中时不请求微信 API", async () => {
  const calls = [];
  const env = fakeEnv({
    "wechat:access-token": { value: "cached-token" },
    "wechat:jsapi-ticket": { value: "cached-ticket" },
  });
  const fetchImpl = async (...args) => {
    calls.push(args);
    throw new Error("unexpected fetch");
  };

  assert.equal(await getWechatAccessToken(env, fetchImpl), "cached-token");
  assert.equal(await getWechatJsapiTicket(env, "cached-token", fetchImpl), "cached-ticket");
  assert.equal(calls.length, 0);
});

test("缓存缺失时取得稳定 token 和 jsapi ticket 并提前五分钟过期", async () => {
  const env = fakeEnv();
  const fetchImpl = sequentialWechatFetch([
    { access_token: "fresh-token", expires_in: 7200 },
    { ticket: "fresh-ticket", expires_in: 7200, errcode: 0, errmsg: "ok" },
  ]);

  assert.equal(await getWechatAccessToken(env, fetchImpl), "fresh-token");
  assert.equal(await getWechatJsapiTicket(env, "fresh-token", fetchImpl), "fresh-ticket");
  assert.deepEqual(env.putTtls, [6900, 6900]);
  assert.deepEqual(fetchImpl.requests[0].body, {
    grant_type: "client_credential",
    appid: "wx-test-appid",
    secret: "test-secret",
    force_refresh: false,
  });
  assert.match(fetchImpl.requests[1].url, /type=jsapi/);
});

test("微信 IP 白名单错误只返回稳定错误码", async () => {
  const env = fakeEnv();
  const fetchImpl = sequentialWechatFetch([{ errcode: 40164, errmsg: "invalid ip" }]);

  await assert.rejects(
    () => getWechatAccessToken(env, fetchImpl),
    (error) =>
      error.code === "wechat_ip_not_allowed" &&
      error.status === 503 &&
      !error.message.includes("test-secret"),
  );
});

test("微信凭据与其他 API 错误使用稳定错误码", async () => {
  for (const errcode of [40013, 40125, 41002, 41004]) {
    await assert.rejects(
      () => getWechatAccessToken(fakeEnv(), sequentialWechatFetch([{ errcode, errmsg: "private detail" }])),
      (error) => error.code === "wechat_credentials_unavailable" && error.status === 503,
    );
  }

  await assert.rejects(
    () => getWechatJsapiTicket(fakeEnv(), "private-token", sequentialWechatFetch([{ errcode: 50001 }])),
    (error) => error.code === "wechat_api_unavailable" && !error.message.includes("private-token"),
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

test("签名端点只返回网页初始化所需字段且禁止缓存", async () => {
  const env = fakeEnv({
    "wechat:access-token": { value: "cached-token" },
    "wechat:jsapi-ticket": { value: "ticket-123" },
  });
  const pageUrl = "https://p.nanbostudio.com/?from=wechat#works";
  const endpoint = new URL("https://p.nanbostudio.com/api/wechat-share/signature");
  endpoint.searchParams.set("url", pageUrl);

  const response = await handleWechatSignature(new Request(endpoint), env, {
    now: () => 1788020000000,
    nonceStr: () => "nonce-456",
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(payload, {
    appId: "wx-test-appid",
    timestamp: 1788020000,
    nonceStr: "nonce-456",
    signature: "cddf18a899c39e0cace18a92b2e88a7a53ae5246",
    url: "https://p.nanbostudio.com/?from=wechat",
  });
});

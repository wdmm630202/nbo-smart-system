import assert from "node:assert/strict";
import test from "node:test";

import {
  createWechatSignature,
  createWechatTicketProvider,
  fetchWechatJsapiTicket,
  normalizeWechatPageUrl,
} from "./wechat.js";

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

test("微信签名使用官方字段顺序生成小写 SHA-1", async () => {
  const signature = await createWechatSignature({
    ticket: "ticket-123",
    nonceStr: "nonce-456",
    timestamp: 1788020000,
    url: "https://p.nanbostudio.com/?from=wechat",
  });
  assert.equal(signature, "cddf18a899c39e0cace18a92b2e88a7a53ae5246");
});

test("云托管通过开放接口无 access_token 获取 jsapi ticket", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json(
      { errcode: 0, errmsg: "ok", ticket: "ticket-from-openapi", expires_in: 7200 },
      { headers: { "x-openapi-seqid": "seq-123" } },
    );
  };

  const result = await fetchWechatJsapiTicket(fetchImpl);

  assert.deepEqual(result, { ticket: "ticket-from-openapi", expiresIn: 7200 });
  assert.equal(
    requests[0].url,
    "http://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi",
  );
  assert.equal(new URL(requests[0].url).searchParams.has("access_token"), false);
  assert.equal(requests[0].options.method, "GET");
});

test("开放接口响应缺少云调用标记时拒绝 ticket", async () => {
  const fetchImpl = async () =>
    Response.json({ errcode: 0, errmsg: "ok", ticket: "unsafe-ticket", expires_in: 7200 });

  await assert.rejects(
    () => fetchWechatJsapiTicket(fetchImpl),
    (error) => error.code === "wechat_openapi_unavailable" && error.status === 503,
  );
});

test("微信 ticket 错误不回显原始响应", async () => {
  const fetchImpl = async () =>
    Response.json(
      { errcode: 40001, errmsg: "sensitive upstream details" },
      { headers: { "x-openapi-seqid": "seq-456" } },
    );

  await assert.rejects(
    () => fetchWechatJsapiTicket(fetchImpl),
    (error) =>
      error.code === "wechat_ticket_unavailable" &&
      error.status === 503 &&
      !error.message.includes("sensitive upstream details"),
  );
});

test("ticket 在有效期内命中内存缓存并提前五分钟过期", async () => {
  let now = 1_000_000;
  let calls = 0;
  const fetchTicket = async () => {
    calls += 1;
    return { ticket: `ticket-${calls}`, expiresIn: 7200 };
  };
  const provider = createWechatTicketProvider({ fetchTicket, now: () => now });

  assert.equal(await provider.getTicket(), "ticket-1");
  now += 6_899_000;
  assert.equal(await provider.getTicket(), "ticket-1");
  now += 2_000;
  assert.equal(await provider.getTicket(), "ticket-2");
  assert.equal(calls, 2);
});

test("ticket 并发刷新只请求微信一次", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const fetchTicket = async () => {
    calls += 1;
    await pending;
    return { ticket: "shared-ticket", expiresIn: 7200 };
  };
  const provider = createWechatTicketProvider({ fetchTicket, now: () => 1_000_000 });

  const first = provider.getTicket();
  const second = provider.getTicket();
  release();

  assert.deepEqual(await Promise.all([first, second]), ["shared-ticket", "shared-ticket"]);
  assert.equal(calls, 1);
});

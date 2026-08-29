import assert from "node:assert/strict";
import test from "node:test";

import { createWechatSignature, normalizeWechatPageUrl } from "./wechat-share.js";

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

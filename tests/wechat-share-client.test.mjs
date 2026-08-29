import assert from "node:assert/strict";
import test from "node:test";

import { configureWechatShare } from "../apps/portfolio-v2/wechat-share.js";

function fakeWx() {
  let readyCallback = () => {};
  return {
    configValue: null,
    friendValue: null,
    timelineValue: null,
    config(value) {
      this.configValue = value;
    },
    ready(callback) {
      readyCallback = callback;
    },
    error(callback) {
      this.errorCallback = callback;
    },
    updateAppMessageShareData(value) {
      this.friendValue = value;
    },
    updateTimelineShareData(value) {
      this.timelineValue = value;
    },
    runReady() {
      readyCallback();
    },
  };
}

function signatureResponse() {
  return Response.json({
    appId: "wx-test-appid",
    timestamp: 1788020000,
    nonceStr: "nonce-456",
    signature: "cddf18a899c39e0cace18a92b2e88a7a53ae5246",
    url: "https://p.nanbostudio.com/?from=wechat",
  });
}

test("只有 p.nanbostudio.com 的微信浏览器初始化分享", async () => {
  const requests = [];
  const base = {
    wxApi: fakeWx(),
    fetchImpl: async (url) => {
      requests.push(url);
      return signatureResponse();
    },
    locationLike: {
      origin: "https://p.nanbostudio.com",
      href: "https://p.nanbostudio.com/#works",
    },
  };

  assert.equal(await configureWechatShare({ ...base, userAgent: "Safari" }), false);
  assert.equal(requests.length, 0);
  assert.equal(
    await configureWechatShare({
      ...base,
      locationLike: {
        origin: "https://wdmm630202.github.io",
        href: "https://wdmm630202.github.io/nbo-smart-system/p/",
      },
      userAgent: "MicroMessenger",
    }),
    false,
  );
  assert.equal(requests.length, 0);
});

test("微信 ready 后设置朋友与朋友圈固定分享内容", async () => {
  const wxApi = fakeWx();
  const configured = await configureWechatShare({
    wxApi,
    fetchImpl: async () => signatureResponse(),
    buildVersion: "pv2-123456789abc",
    locationLike: {
      origin: "https://p.nanbostudio.com",
      href: "https://p.nanbostudio.com/?from=wechat#works",
    },
    userAgent: "MicroMessenger/8.0",
  });

  assert.equal(configured, true);
  assert.deepEqual(wxApi.configValue.jsApiList, [
    "updateAppMessageShareData",
    "updateTimelineShareData",
  ]);
  wxApi.runReady();
  assert.deepEqual(wxApi.friendValue, {
    title: "南铂摄影｜268元拍2套｜先选风格，再预约时间到店开拍📷",
    desc: "浏览真实客片，找到适合你的场景与表达；在线确认风格与需求，到店完成拍摄",
    link: "https://p.nanbostudio.com/?share=pv2-123456789abc",
    imgUrl: "https://p.nanbostudio.com/projects/portfolio-v2/share-card-square.jpg",
  });
  assert.equal(wxApi.timelineValue.title, "南铂摄影｜268元拍2套｜先选风格，再预约时间到店开拍📷");
  assert.equal(wxApi.timelineValue.link, "https://p.nanbostudio.com/?share=pv2-123456789abc");
});

test("诊断链接启用微信 JS-SDK 自带调试提示", async () => {
  const wxApi = fakeWx();
  const configured = await configureWechatShare({
    wxApi,
    fetchImpl: async () => signatureResponse(),
    locationLike: {
      origin: "https://p.nanbostudio.com",
      href: "https://p.nanbostudio.com/?wxdebug=1",
    },
    userAgent: "MicroMessenger/8.0",
  });

  assert.equal(configured, true);
  assert.equal(wxApi.configValue.debug, true);
});

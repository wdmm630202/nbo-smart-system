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
    title: "南铂摄影｜真实客片选风格",
    desc: "浏览真实男士客片，挑选喜欢的场景与主题，生成你的拍摄需求。",
    link: "https://p.nanbostudio.com/",
    imgUrl: "https://p.nanbostudio.com/projects/portfolio-v2/share-card.jpg",
  });
  assert.equal(wxApi.timelineValue.title, "南铂摄影｜真实客片选风格");
});

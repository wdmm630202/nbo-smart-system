const PUBLIC_ORIGIN = "https://p.nanbostudio.com";

const SHARE_DATA = Object.freeze({
  title: "南铂摄影｜真实客片选风格",
  desc: "浏览真实男士客片，挑选喜欢的场景与主题，生成你的拍摄需求。",
  link: `${PUBLIC_ORIGIN}/`,
  imgUrl: `${PUBLIC_ORIGIN}/projects/portfolio-v2/share-card-square.jpg`,
});

export function isWechatBrowser(userAgent) {
  return /MicroMessenger/i.test(userAgent || "");
}

export async function configureWechatShare({
  wxApi,
  fetchImpl,
  locationLike,
  userAgent,
}) {
  if (!isWechatBrowser(userAgent) || locationLike?.origin !== PUBLIC_ORIGIN || !wxApi) {
    return false;
  }

  try {
    const pageUrl = new URL(locationLike.href);
    pageUrl.hash = "";
    const signatureEndpoint = new URL("/api/wechat-share/signature", PUBLIC_ORIGIN);
    signatureEndpoint.searchParams.set("url", pageUrl.toString());

    const response = await fetchImpl(signatureEndpoint.toString(), {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    const signature = await response.json();

    wxApi.ready(() => {
      wxApi.updateAppMessageShareData({ ...SHARE_DATA });
      wxApi.updateTimelineShareData({
        title: SHARE_DATA.title,
        link: SHARE_DATA.link,
        imgUrl: SHARE_DATA.imgUrl,
      });
    });
    wxApi.error(() => {});
    wxApi.config({
      debug: pageUrl.searchParams.get("wxdebug") === "1",
      appId: signature.appId,
      timestamp: signature.timestamp,
      nonceStr: signature.nonceStr,
      signature: signature.signature,
      jsApiList: ["updateAppMessageShareData", "updateTimelineShareData"],
    });
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") {
  configureWechatShare({
    wxApi: window.wx,
    fetchImpl: window.fetch.bind(window),
    locationLike: window.location,
    userAgent: window.navigator.userAgent,
  }).catch(() => {});
}

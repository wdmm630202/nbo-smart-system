const PUBLIC_ORIGIN = "https://p.nanbostudio.com";

const SHARE_DATA = Object.freeze({
  title: "南铂摄影｜先选风格，再预约到店拍摄",
  desc: "浏览真实男士客片，挑选喜欢的场景与主题，生成拍摄需求，让沟通更轻松，预约到店更高效。",
  imgUrl: `${PUBLIC_ORIGIN}/projects/portfolio-v2/share-card-square.jpg`,
});

function buildShareLink(buildVersion) {
  const shareUrl = new URL("/", PUBLIC_ORIGIN);
  if (/^pv2-[a-f0-9]{12}$/.test(buildVersion || "")) {
    shareUrl.searchParams.set("share", buildVersion);
  }
  return shareUrl.toString();
}

export function isWechatBrowser(userAgent) {
  return /MicroMessenger/i.test(userAgent || "");
}

export async function configureWechatShare({
  wxApi,
  fetchImpl,
  buildVersion,
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
    const shareData = { ...SHARE_DATA, link: buildShareLink(buildVersion) };

    wxApi.ready(() => {
      wxApi.updateAppMessageShareData({ ...shareData });
      wxApi.updateTimelineShareData({
        title: shareData.title,
        link: shareData.link,
        imgUrl: shareData.imgUrl,
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
    buildVersion: window.document.querySelector('meta[name="nbo-build-version"]')?.content || "",
    locationLike: window.location,
    userAgent: window.navigator.userAgent,
  }).catch(() => {});
}

const PUBLIC_ORIGIN = "https://p.nanbostudio.com";

export class WechatShareError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizeWechatPageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== PUBLIC_ORIGIN || url.username || url.password) {
      throw new Error("rejected");
    }
    url.hash = "";
    return url.toString();
  } catch {
    throw new WechatShareError("invalid_wechat_url", 400);
  }
}

export async function createWechatSignature({ ticket, nonceStr, timestamp, url }) {
  const source = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

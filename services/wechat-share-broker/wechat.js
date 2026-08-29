const PUBLIC_ORIGIN = "https://p.nanbostudio.com";
const WECHAT_TICKET_ENDPOINT =
  "http://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi";

export class WechatBrokerError extends Error {
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
    throw new WechatBrokerError("invalid_wechat_url", 400);
  }
}

export async function createWechatSignature({ ticket, nonceStr, timestamp, url }) {
  const source = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchWechatJsapiTicket(fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(WECHAT_TICKET_ENDPOINT, { method: "GET" });
  } catch {
    throw new WechatBrokerError("wechat_openapi_unavailable", 503);
  }

  if (!response.ok || !response.headers.get("x-openapi-seqid")) {
    throw new WechatBrokerError("wechat_openapi_unavailable", 503);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WechatBrokerError("wechat_ticket_unavailable", 503);
  }

  const expiresIn = Number(payload?.expires_in);
  if (
    Number(payload?.errcode) !== 0 ||
    typeof payload?.ticket !== "string" ||
    !payload.ticket ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new WechatBrokerError("wechat_ticket_unavailable", 503);
  }

  return { ticket: payload.ticket, expiresIn };
}

export function createWechatTicketProvider({
  fetchTicket = () => fetchWechatJsapiTicket(),
  now = Date.now,
} = {}) {
  let cachedTicket = null;
  let refreshPromise = null;

  async function refreshTicket() {
    const result = await fetchTicket();
    const lifetimeSeconds = Math.max(60, Number(result.expiresIn) - 300);
    cachedTicket = {
      value: result.ticket,
      expiresAt: now() + lifetimeSeconds * 1000,
    };
    return cachedTicket.value;
  }

  return {
    async getTicket() {
      if (cachedTicket && cachedTicket.expiresAt > now()) {
        return cachedTicket.value;
      }

      if (!refreshPromise) {
        refreshPromise = refreshTicket().finally(() => {
          refreshPromise = null;
        });
      }
      return refreshPromise;
    },
  };
}

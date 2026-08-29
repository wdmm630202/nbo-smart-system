const PUBLIC_ORIGIN = "https://p.nanbostudio.com";
const ACCESS_TOKEN_CACHE_KEY = "wechat:access-token";
const JSAPI_TICKET_CACHE_KEY = "wechat:jsapi-ticket";

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

async function readCachedValue(cache, key) {
  const entry = await cache.get(key, { type: "json" });
  return typeof entry?.value === "string" && entry.value ? entry.value : null;
}

async function cacheValue(cache, key, value, expiresIn) {
  const expirationTtl = Math.max(60, Number(expiresIn) - 300);
  await cache.put(key, JSON.stringify({ value }), { expirationTtl });
}

function throwWechatApiError(payload) {
  if (payload?.errcode === 40164) {
    throw new WechatShareError("wechat_ip_not_allowed", 503);
  }
  if ([40013, 40125, 41002, 41004].includes(payload?.errcode)) {
    throw new WechatShareError("wechat_credentials_unavailable", 503);
  }
  throw new WechatShareError("wechat_api_unavailable", 503);
}

export async function getWechatAccessToken(env, fetchImpl = fetch) {
  const cached = await readCachedValue(env.WECHAT_CACHE, ACCESS_TOKEN_CACHE_KEY);
  if (cached) return cached;

  const response = await fetchImpl("https://api.weixin.qq.com/cgi-bin/stable_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credential",
      appid: env.WECHAT_APP_ID,
      secret: env.WECHAT_APP_SECRET,
      force_refresh: false,
    }),
  });
  const payload = await response.json();
  if (!payload.access_token) {
    throwWechatApiError(payload);
  }

  await cacheValue(env.WECHAT_CACHE, ACCESS_TOKEN_CACHE_KEY, payload.access_token, payload.expires_in);
  return payload.access_token;
}

export async function getWechatJsapiTicket(env, accessToken, fetchImpl = fetch) {
  const cached = await readCachedValue(env.WECHAT_CACHE, JSAPI_TICKET_CACHE_KEY);
  if (cached) return cached;

  const endpoint = new URL("https://api.weixin.qq.com/cgi-bin/ticket/getticket");
  endpoint.searchParams.set("access_token", accessToken);
  endpoint.searchParams.set("type", "jsapi");
  const response = await fetchImpl(endpoint);
  const payload = await response.json();
  if (!payload.ticket) {
    throwWechatApiError(payload);
  }

  await cacheValue(env.WECHAT_CACHE, JSAPI_TICKET_CACHE_KEY, payload.ticket, payload.expires_in);
  return payload.ticket;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function handleWechatSignature(request, env, deps = {}) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== PUBLIC_ORIGIN) {
    return jsonResponse({ error: "origin_not_allowed" }, 403);
  }

  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) {
    return jsonResponse({ error: "invalid_wechat_url" }, 400);
  }

  try {
    const url = normalizeWechatPageUrl(rawUrl);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const accessToken = await getWechatAccessToken(env, fetchImpl);
    const ticket = await getWechatJsapiTicket(env, accessToken, fetchImpl);
    const timestamp = Math.floor((deps.now?.() ?? Date.now()) / 1000);
    const nonceStr = deps.nonceStr?.() ?? crypto.randomUUID().replaceAll("-", "");
    const signature = await createWechatSignature({ ticket, nonceStr, timestamp, url });

    return jsonResponse({
      appId: env.WECHAT_APP_ID,
      timestamp,
      nonceStr,
      signature,
      url,
    });
  } catch (error) {
    if (error instanceof WechatShareError) {
      return jsonResponse({ error: error.code }, error.status);
    }
    return jsonResponse({ error: "wechat_api_unavailable" }, 503);
  }
}

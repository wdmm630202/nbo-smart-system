const PUBLIC_ORIGIN = "https://p.nanbostudio.com";
const BROKER_RESPONSE_FIELDS = ["appId", "nonceStr", "signature", "timestamp", "url"];

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

function brokerEndpoint(env) {
  try {
    const endpoint = new URL(env.WECHAT_BROKER_URL);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
      throw new Error("rejected");
    }
    endpoint.pathname = "/v1/signature";
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString();
  } catch {
    throw new WechatShareError("wechat_broker_unavailable", 503);
  }
}

function isValidBrokerPayload(payload, expectedUrl) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const fields = Object.keys(payload).sort();
  if (
    fields.length !== BROKER_RESPONSE_FIELDS.length ||
    fields.some((field, index) => field !== BROKER_RESPONSE_FIELDS[index])
  ) {
    return false;
  }
  return (
    typeof payload.appId === "string" &&
    payload.appId.length > 0 &&
    Number.isInteger(payload.timestamp) &&
    payload.timestamp > 0 &&
    typeof payload.nonceStr === "string" &&
    payload.nonceStr.length > 0 &&
    typeof payload.signature === "string" &&
    /^[a-f0-9]{40}$/.test(payload.signature) &&
    payload.url === expectedUrl
  );
}

export async function fetchBrokerSignature(env, url, fetchImpl = fetch) {
  if (typeof env?.WECHAT_BROKER_SECRET !== "string" || !env.WECHAT_BROKER_SECRET) {
    throw new WechatShareError("wechat_broker_unavailable", 503);
  }

  let response;
  try {
    response = await fetchImpl(brokerEndpoint(env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WECHAT_BROKER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new WechatShareError("wechat_broker_unavailable", 503);
  }

  if (!response.ok) {
    throw new WechatShareError("wechat_broker_unavailable", 503);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WechatShareError("wechat_broker_unavailable", 503);
  }
  if (!isValidBrokerPayload(payload, url)) {
    throw new WechatShareError("wechat_broker_unavailable", 503);
  }
  return payload;
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
    const payload = await fetchBrokerSignature(env, url, deps.fetchImpl ?? fetch);
    return jsonResponse(payload);
  } catch (error) {
    if (error instanceof WechatShareError) {
      return jsonResponse({ error: error.code }, error.status);
    }
    return jsonResponse({ error: "wechat_broker_unavailable" }, 503);
  }
}

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  createWechatSignature,
  createWechatTicketProvider,
  normalizeWechatPageUrl,
  WechatBrokerError,
} from "./wechat.js";

const MAX_BODY_BYTES = 8 * 1024;

function jsonResponse(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(authorization, sharedSecret) {
  if (typeof authorization !== "string" || typeof sharedSecret !== "string") return false;
  const supplied = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${sharedSecret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    request.resume();
    throw new WechatBrokerError("request_too_large", 413);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new WechatBrokerError("request_too_large", 413);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WechatBrokerError("invalid_request", 400);
  }
}

function validateEnvironment(env) {
  if (typeof env?.WECHAT_APP_ID !== "string" || !env.WECHAT_APP_ID) {
    throw new Error("WECHAT_APP_ID is required");
  }
  if (
    typeof env?.BROKER_SHARED_SECRET !== "string" ||
    Buffer.byteLength(env.BROKER_SHARED_SECRET) < 32
  ) {
    throw new Error("BROKER_SHARED_SECRET must be at least 32 bytes");
  }
}

export function createBrokerServer({
  env = process.env,
  ticketProvider = createWechatTicketProvider(),
  now = Date.now,
  nonceStr = () => randomUUID().replaceAll("-", ""),
} = {}) {
  validateEnvironment(env);

  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname === "/healthz") {
      if (request.method !== "GET") {
        return jsonResponse(response, 405, { error: "method_not_allowed" }, { Allow: "GET" });
      }
      return jsonResponse(response, 200, { ok: true });
    }

    if (pathname !== "/v1/signature") {
      return jsonResponse(response, 404, { error: "not_found" });
    }
    if (request.method !== "POST") {
      return jsonResponse(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
    }
    if (!isAuthorized(request.headers.authorization, env.BROKER_SHARED_SECRET)) {
      return jsonResponse(response, 401, { error: "unauthorized" });
    }
    if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return jsonResponse(response, 415, { error: "unsupported_media_type" });
    }

    try {
      const body = await readJsonBody(request);
      const url = normalizeWechatPageUrl(body?.url);
      const ticket = await ticketProvider.getTicket();
      const timestamp = Math.floor(now() / 1000);
      const currentNonce = nonceStr();
      const signature = await createWechatSignature({
        ticket,
        nonceStr: currentNonce,
        timestamp,
        url,
      });

      return jsonResponse(response, 200, {
        appId: env.WECHAT_APP_ID,
        timestamp,
        nonceStr: currentNonce,
        signature,
        url,
      });
    } catch (error) {
      if (error instanceof WechatBrokerError) {
        return jsonResponse(response, error.status, { error: error.code });
      }
      return jsonResponse(response, 503, { error: "wechat_openapi_unavailable" });
    }
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const port = Number(process.env.PORT || 8080);
  const server = createBrokerServer();
  server.listen(port, "0.0.0.0");
}

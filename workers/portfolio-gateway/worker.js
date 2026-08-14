import { collectAnalytics } from "./analytics.js";

const ORIGIN = "https://wdmm630202.github.io";
const REPOSITORY_BASE = "/nbo-smart-system";
const PORTFOLIO_BASE = `${REPOSITORY_BASE}/p`;
const ANALYTICS_PATH = "/api/portfolio-analytics/collect";

export function originPathFor(pathname) {
  if (!pathname || pathname === "/") return `${PORTFOLIO_BASE}/`;
  if (pathname === "/p") return `${PORTFOLIO_BASE}/`;
  if (pathname.startsWith("/p/")) return `${REPOSITORY_BASE}${pathname}`;
  if (pathname.startsWith("/projects/")) return `${REPOSITORY_BASE}${pathname}`;
  return `${PORTFOLIO_BASE}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function shortPathFor(pathname) {
  if (pathname === PORTFOLIO_BASE || pathname === `${PORTFOLIO_BASE}/`) return "/";
  if (pathname.startsWith(`${PORTFOLIO_BASE}/`)) {
    return pathname.slice(PORTFOLIO_BASE.length) || "/";
  }
  return null;
}

function redirectToShortUrl(url, pathname) {
  const shortPath = shortPathFor(pathname);
  if (shortPath === null) return null;
  const target = new URL(url);
  target.pathname = shortPath;
  return Response.redirect(target.toString(), 301);
}

function rewriteHtml(response, publicOrigin) {
  if (typeof globalThis.HTMLRewriter === "undefined") return response;
  return new globalThis.HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", `${publicOrigin}/`);
      },
    })
    .transform(response);
}

export default {
  async fetch(request, env) {
    const publicUrl = new URL(request.url);
    if (publicUrl.pathname === ANALYTICS_PATH) {
      return collectAnalytics(request, env?.DB);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const shortRedirect = redirectToShortUrl(publicUrl, publicUrl.pathname);
    if (shortRedirect) return shortRedirect;

    const originUrl = new URL(ORIGIN);
    originUrl.pathname = originPathFor(publicUrl.pathname);
    originUrl.search = publicUrl.search;

    const originRequest = new Request(originUrl.toString(), request);
    const originResponse = await fetch(originRequest, {
      redirect: "follow",
      cf: {
        cacheEverything: request.method === "GET",
        cacheTtlByStatus: {
          "200-299": 600,
          "404": 60,
          "500-599": 0,
        },
      },
    });

    const contentType = originResponse.headers.get("content-type") || "";
    if (request.method === "GET" && contentType.includes("text/html")) {
      return rewriteHtml(originResponse, publicUrl.origin);
    }
    return originResponse;
  },
};

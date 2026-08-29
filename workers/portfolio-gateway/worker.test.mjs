import assert from "node:assert/strict";
import { collectAnalytics } from "./analytics.js";
import gateway, { originPathFor, shortPathFor } from "./worker.js";

assert.equal(originPathFor("/"), "/nbo-smart-system/p/");
assert.equal(originPathFor("/privacy.html"), "/nbo-smart-system/p/privacy.html");
assert.equal(originPathFor("/projects/portfolio-v2/app.js"), "/nbo-smart-system/projects/portfolio-v2/app.js");
assert.equal(originPathFor("/projects/portfolio/assets/photos/thumbs/photo-137.webp"), "/nbo-smart-system/projects/portfolio/assets/photos/thumbs/photo-137.webp");
assert.equal(originPathFor("/MP_verify_ZCU9ptvNi6e2Zgi3.txt"), "/nbo-smart-system/p/MP_verify_ZCU9ptvNi6e2Zgi3.txt");
assert.equal(shortPathFor("/nbo-smart-system/p/"), "/");
assert.equal(shortPathFor("/nbo-smart-system/p/privacy.html"), "/privacy.html");
assert.equal(shortPathFor("/projects/portfolio-v2/app.js"), null);

const invalidAnalytics = await collectAnalytics(new Request("https://p.nanbostudio.com/api/portfolio-analytics/collect", {
  method: "POST",
  headers: { Origin: "https://p.nanbostudio.com", "Content-Type": "text/plain" },
  body: JSON.stringify({ session: { id: "invalid" }, events: [] }),
}));
assert.equal(invalidAnalytics.status, 400);
assert.deepEqual(await invalidAnalytics.json(), { error: "invalid_session" });

const blockedAnalytics = await collectAnalytics(new Request("https://p.nanbostudio.com/api/portfolio-analytics/collect", {
  method: "OPTIONS",
  headers: { Origin: "https://example.com" },
}));
assert.equal(blockedAnalytics.status, 403);

const githubAnalytics = await collectAnalytics(new Request("https://p.nanbostudio.com/api/portfolio-analytics/collect", {
  method: "OPTIONS",
  headers: { Origin: "https://wdmm630202.github.io" },
}));
assert.equal(githubAnalytics.status, 204);
assert.equal(githubAnalytics.headers.get("access-control-allow-origin"), "https://wdmm630202.github.io");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("unexpected proxy", { status: 200 });
const missingInsightsToken = await gateway.fetch(new Request("https://p.nanbostudio.com/api/portfolio-analytics/insights", {
  headers: { Origin: "https://wdmm630202.github.io" },
}), {});
globalThis.fetch = originalFetch;
assert.equal(missingInsightsToken.status, 401);
assert.equal(missingInsightsToken.headers.get("access-control-allow-origin"), "https://wdmm630202.github.io");

const wrongInsightsToken = await gateway.fetch(new Request("https://p.nanbostudio.com/api/portfolio-analytics/insights", {
  headers: {
    Authorization: "Bearer wrong-owner-key",
    Origin: "https://wdmm630202.github.io",
  },
}), { PORTFOLIO_INSIGHTS_TOKEN: "existing-owner-key" });
assert.equal(wrongInsightsToken.status, 401);

const preparedInsights = [];
const analyticsDatabase = {
  prepare(query) {
    return {
      bind(...values) {
        const statement = { query, values };
        preparedInsights.push(statement);
        return statement;
      },
    };
  },
  async batch() {
    return [
      { results: [{ sessions: 42, engaged: 19 }] },
      { results: [{ key: "photo-1", label: "商务总裁", total: 8 }] },
      { results: [{ key: "business", label: "商务总裁", total: 8 }] },
      { results: [{ key: "wechat", label: "wechat", total: 12, conversions: 2 }] },
      { results: [{ session_id: "session-1", intent_score: 50 }] },
    ];
  },
};
globalThis.fetch = async () => { throw new Error("insights must read D1 directly"); };
const directInsights = await gateway.fetch(new Request("https://p.nanbostudio.com/api/portfolio-analytics/insights?days=30", {
  headers: {
    Authorization: "Bearer existing-owner-key",
    Origin: "https://wdmm630202.github.io",
  },
}), { DB: analyticsDatabase, PORTFOLIO_INSIGHTS_TOKEN: "existing-owner-key" });
globalThis.fetch = originalFetch;
assert.equal(directInsights.status, 200);
assert.equal(directInsights.headers.get("access-control-allow-origin"), "https://wdmm630202.github.io");
const directPayload = await directInsights.json();
assert.equal(directPayload.ok, true);
assert.equal(directPayload.days, 30);
assert.deepEqual(directPayload.summary, { sessions: 42, engaged: 19 });
assert.equal(directPayload.sessions[0].session_id, "session-1");
assert.equal(preparedInsights.length, 5);
assert.ok(preparedInsights.every((statement) => statement.values[0] === "-30 days"));

globalThis.fetch = async () => new Response("unexpected proxy", { status: 200 });
const missingWechatUrl = await gateway.fetch(
  new Request("https://p.nanbostudio.com/api/wechat-share/signature"),
  {},
);
globalThis.fetch = originalFetch;
assert.equal(missingWechatUrl.status, 400);

console.log("portfolio gateway path mapping: ok");

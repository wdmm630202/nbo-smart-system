import assert from "node:assert/strict";
import { collectAnalytics } from "./analytics.js";
import { originPathFor, shortPathFor } from "./worker.js";

assert.equal(originPathFor("/"), "/nbo-smart-system/p/");
assert.equal(originPathFor("/privacy.html"), "/nbo-smart-system/p/privacy.html");
assert.equal(originPathFor("/projects/portfolio-v2/app.js"), "/nbo-smart-system/projects/portfolio-v2/app.js");
assert.equal(originPathFor("/projects/portfolio/assets/photos/thumbs/photo-137.webp"), "/nbo-smart-system/projects/portfolio/assets/photos/thumbs/photo-137.webp");
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

console.log("portfolio gateway path mapping: ok");

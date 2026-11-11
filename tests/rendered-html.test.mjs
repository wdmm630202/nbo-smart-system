import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

// These assertions consume the worker's rendered page, not its source project list.
// Catch broken entry links, an inaccessible new entry, stale counts and starter regressions.
test("server-renders one cover studio entry including makeover and core destinations", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<h1\b[^>]*>NBO南铂智能系统<\/h1>/);
  const cards = [...html.matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*\bproject-card\b)[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
  const coverEntries = cards.filter((card) => card.includes('href="https://wdmm630202.github.io/nbo-cover-copy/cover.html"'));
  assert.equal(coverEntries.length, 1, "cover studio must have one consolidated project-card link");
  assert.match(coverEntries[0], /aria-label="打开自媒体封面制作：自媒体封面制作"/);
  assert.match(coverEntries[0], /<h3\b[^>]*>自媒体封面制作<\/h3>/);
  assert.match(coverEntries[0], /素人改造/);
  assert.match(coverEntries[0], /9种版式/);
  assert.ok(cards.every((card) => !card.includes('/projects/portrait-makeover/')), "makeover is reached from the cover studio rather than a duplicate portal card");

  const destinations = new Set(cards.map((card) => card.match(/\bhref="([^"]+)"/)?.[1]));
  for (const destination of [
    "https://stash-status.nanbostudio.com/",
    "https://wdmm630202.github.io/nbo-cover-copy/",
    "https://wdmm630202.github.io/nbo-cover-copy/cover.html",
    "https://erp.nanbostudio.com",
    "https://wdmm630202.github.io/nbo-smart-system/p/",
    "https://wdmm630202.github.io/nbo-smart-system/i/",
    "https://wdmm630202.github.io/nbo-smart-system/projects/copy-center/",
    "https://wdmm630202.github.io/nbo-smart-system/projects/portrait-fold/",
  ]) {
    assert.ok(destinations.has(destination), `core portal destination missing: ${destination}`);
  }
});

test("reports the rendered project count and contains no obsolete starter page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  const count = html.match(/<div\b[^>]*class="result-count"[^>]*>\s*<strong>(\d+)<\/strong>/);
  assert.ok(count, "portal must display its current result count");
  const cardLinks = [...html.matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*\bproject-card\b)[^>]*\bhref=["'][^"']+["'][^>]*>/g)];
  assert.ok(cardLinks.length > 0, "rendered project-card links must be present");
  assert.equal(Number(count[1]), cardLinks.length, "displayed count must match actual rendered project links");
  assert.match(html, /<title>NBO南铂智能系统<\/title>/);
  assert.doesNotMatch(html, /<title[^>]*>[^<]*(?:Starter Project|Your site is taking shape)/i);
  assert.doesNotMatch(html, /Building your site|Your first version will appear here automatically/i);
  assert.doesNotMatch(html, /<meta(?=[^>]*\bname=["']codex-preview["'])[^>]*>/i);
  assert.doesNotMatch(html, /react-loading-skeleton|sites-skeleton-/i);
});

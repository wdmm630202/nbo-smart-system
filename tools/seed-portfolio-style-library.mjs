import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPortfolioItems, portfolioCatalog } from "../apps/portfolio-v2/catalog.js";
import { normalizeStyleAssignments, normalizeStyleCatalog } from "../apps/portfolio-v2/style-library.js";

const toolPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(toolPath));

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function usageByAsset(assignments) {
  const usage = new Map();
  for (const assignment of Object.values(assignments)) {
    for (const slot of assignment.slots) usage.set(slot.assetId, (usage.get(slot.assetId) || 0) + 1);
  }
  return usage;
}

function ensureEveryAssetReferenced({ catalog, assignments, assets }) {
  const usage = usageByAsset(assignments);
  const missing = assets.filter((asset) => !usage.has(asset.id));
  for (const missingAsset of missing) {
    const candidates = catalog.styles.flatMap((style) => {
      if (style.scene !== missingAsset.scene) return [];
      const assignment = assignments[style.id];
      const occupied = new Set(assignment.slots.map(({ assetId }) => assetId));
      if (occupied.has(missingAsset.id)) return [];
      return assignment.slots.slice(1).map((slot, index) => ({
        style,
        position: index + 1,
        assetId: slot.assetId,
        usage: usage.get(slot.assetId) || 0,
      })).filter((candidate) => candidate.usage > 1);
    }).sort((left, right) => right.usage - left.usage
      || left.style.id.localeCompare(right.style.id)
      || left.position - right.position);
    const replacement = candidates[0];
    if (!replacement) throw new Error(`无法为公共资产 ${missingAsset.id} 保留场景安全照片位`);
    assignments[replacement.style.id].slots[replacement.position].assetId = missingAsset.id;
    usage.set(replacement.assetId, replacement.usage - 1);
    usage.set(missingAsset.id, 1);
  }
  return assignments;
}

function buildSeedReport(catalog, assignments, assets) {
  const slots = Object.values(assignments).flatMap((assignment) => assignment.slots);
  const usage = usageByAsset(assignments);
  const assetSceneById = new Map(assets.map((asset) => [asset.id, asset.scene]));
  return {
    styles: catalog.styles.length,
    slots: slots.length,
    assets: usage.size,
    scenes: Object.fromEntries(["indoor", "outdoor"].map((scene) => [scene, {
      styles: catalog.styles.filter((style) => style.scene === scene).length,
      slots: catalog.styles.filter((style) => style.scene === scene).length * 9,
      assets: [...usage.keys()].filter((assetId) => assetSceneById.get(assetId) === scene).length,
    }])),
    assetUsage: Object.fromEntries([...usage].sort(([left], [right]) => left - right)),
  };
}

export function buildSeedAssignments({ catalog, assets }) {
  const assignments = {};
  const familyCovers = new Map();
  for (const style of catalog.styles) {
    const sameScene = assets.filter((asset) => asset.scene === style.scene);
    const preferred = sameScene.filter((asset) => style.legacyThemeIds.includes(asset.theme));
    const pool = [...preferred, ...sameScene.filter((asset) => !preferred.includes(asset))];
    if (pool.length < 9) throw new Error(`风格 ${style.id} 没有 9 张同场景公共资产`);
    const offset = stableHash(style.id) % pool.length;
    const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
    const ids = [...new Set(rotated.map((asset) => asset.id))].slice(0, 9);
    const usedCovers = familyCovers.get(style.familyId) || new Set();
    const coverIndex = ids.findIndex((id) => !usedCovers.has(id));
    if (coverIndex > 0) [ids[0], ids[coverIndex]] = [ids[coverIndex], ids[0]];
    usedCovers.add(ids[0]);
    familyCovers.set(style.familyId, usedCovers);
    assignments[style.id] = {
      slots: ids.map((assetId, index) => ({
        assetId,
        poseLabel: `拍摄参考 ${String(index + 1).padStart(2, "0")}`,
        source: "seed",
        updatedAt: null,
      })),
      coverPosition: 1,
      maturity: "reference",
      updatedAt: null,
    };
  }
  const covered = ensureEveryAssetReferenced({ catalog, assignments, assets });
  return { schemaVersion: 1, assignments: covered, report: buildSeedReport(catalog, covered, assets) };
}

function publicAssets() {
  return buildPortfolioItems(portfolioCatalog).map((asset) => ({
    ...asset,
    thumb: `../apps/portfolio/assets/photos/thumbs/photo-${String(asset.id).padStart(3, "0")}.webp`,
    full: `../apps/portfolio/assets/photos/full/photo-${String(asset.id).padStart(3, "0")}.jpg`,
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function buildCoverAuditHtml({ catalog, assignments, assets }) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const families = catalog.families.map((family) => {
    const covers = catalog.styles.filter((style) => style.familyId === family.id).map((style) => {
      const cover = assignments[style.id].slots[assignments[style.id].coverPosition - 1];
      const asset = assetById.get(cover.assetId);
      return `<figure><img src="${escapeHtml(asset.thumb)}" alt="${escapeHtml(style.label)} 的封面参考"><figcaption>${escapeHtml(style.label)} · NB-${String(asset.id).padStart(3, "0")}</figcaption></figure>`;
    }).join("");
    return `<section><h2>${escapeHtml(family.label)} · ${escapeHtml(family.scene === "indoor" ? "内景" : "外景")}</h2><div class="covers">${covers}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>南铂 132 风格封面审查</title><style>body{margin:0;padding:24px;background:#f6f5f2;color:#1d1d1f;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{margin:0 0 24px}section{margin:0 0 28px}.covers{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));gap:8px}figure{margin:0;background:#fff;border-radius:8px;overflow:hidden}img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#ddd}figcaption{padding:6px;font-size:11px}@media(max-width:900px){.covers{grid-template-columns:repeat(4,minmax(0,1fr))}}</style><h1>132 个初始风格封面审查</h1>${families}</html>`;
}

async function runCli() {
  const catalogPath = join(root, "apps/portfolio-v2/style-catalog.json");
  const assignmentsPath = join(root, "apps/portfolio-v2/style-slot-assignments.json");
  const localDirectory = join(root, ".local");
  const auditOnly = process.argv.includes("--audit-only");
  const catalog = normalizeStyleCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
  const assets = publicAssets();
  await mkdir(localDirectory, { recursive: true });
  const document = auditOnly
    ? JSON.parse(await readFile(assignmentsPath, "utf8"))
    : (() => {
      const seeded = buildSeedAssignments({ catalog, assets });
      return { schemaVersion: seeded.schemaVersion, assignments: seeded.assignments };
    })();
  if (!auditOnly) await writeFile(assignmentsPath, `${JSON.stringify(document, null, 2)}\n`);
  const persistedAssignments = normalizeStyleAssignments(
    document,
    catalog,
    new Map(assets.map((asset) => [asset.id, asset])),
  ).assignments;
  const report = buildSeedReport(catalog, persistedAssignments, assets);
  await writeFile(join(localDirectory, "portfolio-style-seed-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    join(localDirectory, "portfolio-style-cover-audit.html"),
    buildCoverAuditHtml({ catalog, assignments: persistedAssignments, assets }),
  );
  console.log(`${report.styles} styles · ${report.slots} slots · ${report.assets} assets`);
}

if (process.argv[1] === toolPath) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

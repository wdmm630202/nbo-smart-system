import { NANBO_ALLOWED_CLAIMS } from "./constants.mjs";

const evidenceKinds = new Set(["official", "media", "complaint", "research", "platform"]);
const assertionLevels = new Set(["verified", "reported", "context"]);

function result(errors, extra = {}) {
  return { ok: errors.length === 0, errors, ...extra };
}

function parsePublicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname || ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function validateEvidenceItem(item) {
  const errors = [];
  if (!String(item?.sourceId || "").trim()) errors.push("证据缺少 sourceId");
  if (!evidenceKinds.has(item?.kind)) errors.push("证据类型无效");
  if (!String(item?.title || "").trim()) errors.push("证据缺少页面标题");
  if (!String(item?.publisher || "").trim()) errors.push("证据缺少发布者");
  if (!String(item?.summary || "").trim()) errors.push("证据缺少摘要");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item?.accessedAt || ""))) errors.push("证据访问日期无效");
  if (!parsePublicUrl(item?.url)) errors.push("证据 URL 必须是不携带凭据的公开 HTTPS 地址");
  if (!assertionLevels.has(item?.assertionLevel)) errors.push("证据断言级别无效");
  if (item?.kind === "complaint" && item?.assertionLevel === "verified") {
    errors.push("公开投诉只能证明有人公开反映，不能直接标记为官方已证实");
  }
  return result(errors);
}

export function validateClaim(claim, evidenceItems) {
  const errors = [];
  const evidenceById = new Map((evidenceItems || []).map((item) => [item.sourceId, item]));
  const ids = [...new Set(claim?.evidenceIds || [])];
  if (!String(claim?.claimId || "").trim()) errors.push("说法缺少 claimId");
  if (!String(claim?.text || "").trim()) errors.push("说法文本不能为空");
  if (!ids.length) errors.push("说法缺少可追溯证据");

  const sources = [];
  for (const id of ids) {
    const source = evidenceById.get(id);
    if (!source) {
      errors.push(`找不到证据：${id}`);
      continue;
    }
    const validation = validateEvidenceItem(source);
    if (!validation.ok) errors.push(...validation.errors.map((message) => `${id}：${message}`));
    sources.push(source);
  }

  if (claim?.quantified || claim?.universal || claim?.causal) {
    const hasOfficial = sources.some((source) => source.kind === "official");
    const independentHosts = new Set(sources.map((source) => parsePublicUrl(source.url)?.hostname).filter(Boolean));
    if (!hasOfficial && independentHosts.size < 2) errors.push("数字、普遍性或因果结论需要权威来源或两个独立来源");
  }

  return result(errors, { supportingSourceIds: ids });
}

export function validateNanboClaims(claimIds) {
  const errors = [];
  for (const claimId of [...new Set(claimIds || [])]) {
    if (!NANBO_ALLOWED_CLAIMS.has(claimId)) errors.push(`未确认的南铂商业说法：${claimId}`);
  }
  return result(errors);
}

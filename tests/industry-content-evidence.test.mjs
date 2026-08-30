import assert from "node:assert/strict";
import test from "node:test";

import {
  validateClaim,
  validateEvidenceItem,
  validateNanboClaims,
} from "../tools/industry-content-workbench/evidence-policy.mjs";

const mediaSource = {
  sourceId: "media-1",
  kind: "media",
  title: "摄影服务消费提示",
  url: "https://news.example.com/photo-service",
  publisher: "公开媒体",
  publishedAt: "2026-01-10",
  accessedAt: "2026-08-31",
  summary: "报道消费者在底片和精修费用上遇到的争议。",
  assertionLevel: "reported",
};

test("可追溯的公开来源通过基础校验", () => {
  assert.deepEqual(validateEvidenceItem(mediaSource), { ok: true, errors: [] });
});

test("投诉来源不能被标记为官方已证实", () => {
  const result = validateEvidenceItem({
    ...mediaSource,
    sourceId: "complaint-1",
    kind: "complaint",
    url: "https://complaints.example.org/case/1",
    assertionLevel: "verified",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /投诉只能证明有人公开反映/);
});

test("来源 URL 不得携带用户名、密码或非 HTTPS 协议", () => {
  for (const url of ["http://example.com/report", "https://user:secret@example.com/report"]) {
    const result = validateEvidenceItem({ ...mediaSource, url });
    assert.equal(result.ok, false, url);
  }
});

test("普遍性、数字或因果结论需权威来源或两个独立来源", () => {
  const riskyClaim = {
    claimId: "claim-1",
    text: "这种问题非常普遍",
    evidenceIds: ["media-1"],
    universal: true,
  };
  const rejected = validateClaim(riskyClaim, [mediaSource]);
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join("\n"), /需要权威来源或两个独立来源/);

  const accepted = validateClaim(
    { ...riskyClaim, evidenceIds: ["media-1", "media-2"] },
    [mediaSource, { ...mediaSource, sourceId: "media-2", url: "https://consumer.example.net/report" }],
  );
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.supportingSourceIds, ["media-1", "media-2"]);
});

test("官方来源可以单独支持风险结论的消费提示", () => {
  const official = {
    ...mediaSource,
    sourceId: "official-1",
    kind: "official",
    url: "https://www.gov.cn/example/photo-consumer-warning",
    publisher: "官方部门",
    assertionLevel: "verified",
  };
  const result = validateClaim({
    claimId: "claim-2",
    text: "消费者应在拍摄前确认价格与交付内容",
    evidenceIds: ["official-1"],
    causal: true,
  }, [official]);
  assert.equal(result.ok, true);
});

test("只允许已确认的南铂商业事实", () => {
  assert.deepEqual(
    validateNanboClaims(["package_268_two_sets", "all_originals_included", "no_retouch_upsell"]),
    { ok: true, errors: [] },
  );
  assert.deepEqual(validateNanboClaims(["same_day_delivery"]), {
    ok: false,
    errors: ["未确认的南铂商业说法：same_day_delivery"],
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildVisualBeatPlan,
  validateStyleProfile,
} from "../tools/industry-content-workbench/style-profile.mjs";

const profilePath = new URL("../content-workbench/reference-styles/nanbo-evidence-explainer-v1.json", import.meta.url);

async function loadProfile() {
  return JSON.parse(await readFile(profilePath, "utf8"));
}

test("参考拆解记录可复核指标但不携带博主素材或绝对路径", async () => {
  const profile = validateStyleProfile(await loadProfile());
  assert.equal(profile.reference.sha256, "2ca4433c58b413e127392ae6ba1fbd813a2f5d2210e1b3a47cfcbc0cc4d3bb01");
  assert.equal(profile.reference.durationSeconds, 310.25);
  assert.equal(profile.reference.visualChangeCandidates, 56);
  assert.equal(profile.reference.transcriptSegments, 155);
  assert.equal(JSON.stringify(profile).includes("/Users/"), false);
});

test("南铂模板固定为不出镜竖屏并明确禁止照搬", async () => {
  const profile = validateStyleProfile(await loadProfile());
  assert.deepEqual(profile.output.canvas, { width: 1080, height: 1920, fps: 30 });
  assert.equal(profile.output.humanAppearance, false);
  assert.ok(profile.originality.exclude.includes("参考博主的人物形象"));
  assert.ok(profile.originality.exclude.includes("参考视频原文案"));
  assert.ok(profile.originality.exclude.includes("参考视频界面截图"));
});

test("视觉节拍覆盖全片且每个镜头不超过模板上限", async () => {
  const profile = validateStyleProfile(await loadProfile());
  const beats = buildVisualBeatPlan(30, profile);
  assert.equal(beats[0].startSeconds, 0);
  assert.equal(beats.at(-1).endSeconds, 30);
  assert.ok(beats.length >= 10);
  assert.ok(beats.every((beat) => beat.endSeconds - beat.startSeconds <= profile.cadence.maxShotSeconds));
  assert.deepEqual(new Set(beats.map(({ role }) => role)), new Set(["hook", "problem", "evidence", "mechanism", "nanbo-proof", "cta"]));
});

test("非法模板会在渲染前被拒绝", async () => {
  const profile = await loadProfile();
  assert.throws(() => validateStyleProfile({ ...profile, output: { ...profile.output, humanAppearance: true } }), /不出镜/);
  assert.throws(() => validateStyleProfile({ ...profile, originality: { exclude: [] } }), /原创边界/);
});

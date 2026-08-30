import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createEpisode } from "../tools/industry-content-workbench/project-store.mjs";
import {
  buildRenderPlan,
  renderProject,
  validateRenderInputs,
} from "../tools/industry-content-workbench/render-project.mjs";
import { inspectRenderedVideo } from "../tools/industry-content-workbench/qa-video.mjs";

const run = promisify(execFile);
const ffmpegPath = "/Users/nanbosheyingimacpro/.local/bin/ffmpeg";
const ffprobePath = "/Users/nanbosheyingimacpro/.local/bin/ffprobe";

test("渲染计划只接受已放行文案、旁白和完整时间轴", () => {
  const project = createEpisode({ projectId: "episode-render", title: "渲染", platform: "both" });
  assert.throws(() => buildRenderPlan(project), /文案和旁白未放行/);

  project.approvals.script = true;
  project.approvals.voice = true;
  project.voice.path = "/tmp/voice.m4a";
  project.outputs.preview = "/tmp/preview.mp4";
  project.storyboard = [
    { sceneId: "scene-1", startSeconds: 0, endSeconds: 2, fallbackApproved: true, headline: "价格先讲清" },
    { sceneId: "scene-2", startSeconds: 2, endSeconds: 4, fallbackApproved: true, headline: "底片先问清" },
  ];
  const plan = buildRenderPlan(project);
  assert.equal(plan.durationSeconds, 4);
  assert.deepEqual({ width: plan.width, height: plan.height, fps: plan.fps }, { width: 1080, height: 1920, fps: 30 });
});

test("质检拒绝错误尺寸、错误编码和缺失素材", () => {
  const report = validateRenderInputs({
    probe: { width: 720, height: 1280, fps: 25, videoCodec: "hevc", audioCodec: "mp3" },
    storyboard: [{ assetId: null, assetPath: null, fallbackApproved: false }],
    captions: [],
    durationSeconds: 10,
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /1080×1920/);
  assert.match(report.errors.join("\n"), /30fps/);
  assert.match(report.errors.join("\n"), /H\.264/);
  assert.match(report.errors.join("\n"), /AAC/);
  assert.match(report.errors.join("\n"), /缺素材/);
});

test("字幕时间重叠、越界或超出安全区会被阻断", () => {
  const report = validateRenderInputs({
    probe: { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac" },
    storyboard: [{ fallbackApproved: true }],
    durationSeconds: 5,
    captions: [
      { startSeconds: 0, endSeconds: 3, text: "第一句", box: { x: 72, y: 1500, width: 936, height: 120 } },
      { startSeconds: 2.5, endSeconds: 6, text: "第二句", box: { x: 20, y: 1700, width: 1040, height: 160 } },
    ],
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /字幕时间重叠/);
  assert.match(report.errors.join("\n"), /成片时长/);
  assert.match(report.errors.join("\n"), /安全区/);
});

test("真实生成 1080×1920 H.264/AAC 测试片并完成工具质检", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "nbo-render-"));
  const voicePath = join(directory, "voice.m4a");
  const outputPath = join(directory, "preview.mp4");
  try {
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "2", "-c:a", "aac", voicePath]);
    const plan = {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 2,
      audioPath: voicePath,
      outputPath,
      scenes: [
        { sceneId: "scene-1", startSeconds: 0, endSeconds: 1, fallbackApproved: true, backgroundColor: "#07120d", headline: "明码实价" },
        { sceneId: "scene-2", startSeconds: 1, endSeconds: 2, fallbackApproved: true, backgroundColor: "#f2ede2", headline: "拍得明白" },
      ],
      captions: [{ startSeconds: 0, endSeconds: 2, text: "南铂摄影", box: { x: 72, y: 1500, width: 936, height: 120 } }],
    };
    const receipt = await renderProject(plan, { ffmpegPath });
    assert.equal(receipt.ok, true);
    const qa = await inspectRenderedVideo(outputPath, { ffmpegPath, ffprobePath });
    assert.equal(qa.ok, true, qa.errors.join("\n"));
    assert.deepEqual(
      { width: qa.probe.width, height: qa.probe.height, fps: qa.probe.fps, videoCodec: qa.probe.videoCodec, audioCodec: qa.probe.audioCodec },
      { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac" },
    );
    assert.ok(qa.warnings.some((warning) => /静音/.test(warning)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

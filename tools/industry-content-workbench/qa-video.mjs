import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { normalizeProbe } from "./media-library.mjs";
import { validateRenderInputs } from "./render-project.mjs";

const execFileAsync = promisify(execFile);

export async function inspectRenderedVideo(path, {
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  run = execFileAsync,
  storyboard = [{ fallbackApproved: true }],
  captions = [],
} = {}) {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels",
    "-of", "json",
    path,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout);
  const probe = normalizeProbe(raw);
  const durationSeconds = Number(raw.format?.duration || 0);
  const validation = validateRenderInputs({ probe, storyboard, captions, durationSeconds });
  const warnings = [...validation.warnings];

  const { stderr } = await run(ffmpegPath, [
    "-hide_banner", "-nostats", "-i", path,
    "-vf", "blackdetect=d=0.5:pix_th=0.98",
    "-af", "silencedetect=noise=-45dB:d=1.0",
    "-f", "null", "-",
  ], { maxBuffer: 16 * 1024 * 1024 });
  const blackRanges = [...String(stderr).matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)/g)].map((match) => ({ startSeconds: Number(match[1]), endSeconds: Number(match[2]) }));
  const silenceStarts = [...String(stderr).matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const silenceEnds = [...String(stderr).matchAll(/silence_end:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  if (blackRanges.length) warnings.push(`检测到 ${blackRanges.length} 段长黑场，请结合设计画面人工复核`);
  if (silenceStarts.length) warnings.push(`检测到 ${silenceStarts.length} 段长静音，请实际试听确认`);

  return {
    ok: validation.errors.length === 0,
    errors: validation.errors,
    warnings,
    probe: { ...probe, durationSeconds },
    blackRanges,
    silenceRanges: silenceStarts.map((startSeconds, index) => ({ startSeconds, endSeconds: silenceEnds[index] ?? durationSeconds })),
  };
}

async function runCli() {
  const videoFlag = process.argv.indexOf("--video");
  const projectFlag = process.argv.indexOf("--project");
  if (videoFlag < 0 || !process.argv[videoFlag + 1]) throw new Error("用法：qa-video.mjs --video <video.mp4> [--project <project.json>]");
  let options = { ffmpegPath: "/Users/nanbosheyingimacpro/.local/bin/ffmpeg", ffprobePath: "/Users/nanbosheyingimacpro/.local/bin/ffprobe" };
  if (projectFlag >= 0 && process.argv[projectFlag + 1]) {
    const project = JSON.parse(await readFile(process.argv[projectFlag + 1], "utf8"));
    options = { ...options, storyboard: project.storyboard, captions: project.script?.captions || [] };
  }
  const report = await inspectRenderedVideo(process.argv[videoFlag + 1], options);
  const reportFlag = process.argv.indexOf("--report");
  if (reportFlag >= 0 && process.argv[reportFlag + 1]) await writeFile(process.argv[reportFlag + 1], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("qa-video.mjs")) await runCli();

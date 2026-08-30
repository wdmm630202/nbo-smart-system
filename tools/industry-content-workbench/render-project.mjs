import { execFile } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { promisify } from "node:util";

import { OUTPUT_SPEC } from "./constants.mjs";

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const FONT_CANDIDATES = [
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
];

function almostEqual(left, right, tolerance = 0.02) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function isH264(codec) {
  return ["h264", "avc", "avc1"].includes(String(codec || "").toLowerCase());
}

export function validateRenderInputs({ probe, storyboard = [], captions = [], durationSeconds }) {
  const errors = [];
  const warnings = [];
  if (probe) {
    if (probe.width !== OUTPUT_SPEC.width || probe.height !== OUTPUT_SPEC.height) errors.push("成片必须为 1080×1920");
    if (!almostEqual(probe.fps, OUTPUT_SPEC.fps)) errors.push("成片必须为 30fps");
    if (!isH264(probe.videoCodec)) errors.push("视频编码必须为 H.264");
    if (String(probe.audioCodec || "").toLowerCase() !== "aac") errors.push("音频编码必须为 AAC");
  }
  if (!Array.isArray(storyboard) || storyboard.length === 0) errors.push("分镜不能为空");
  storyboard.forEach((scene, index) => {
    if (!scene?.assetPath && !scene?.assetId && !scene?.fallbackApproved) errors.push(`第 ${index + 1} 段缺素材且未批准中性动效`);
  });

  let previousEnd = -1;
  captions.forEach((caption, index) => {
    const start = Number(caption.startSeconds);
    const end = Number(caption.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) errors.push(`第 ${index + 1} 条字幕时间无效`);
    if (start < previousEnd) errors.push(`第 ${index + 1} 条字幕时间重叠`);
    if (Number.isFinite(durationSeconds) && end > durationSeconds + 0.001) errors.push(`第 ${index + 1} 条字幕超出成片时长`);
    previousEnd = Math.max(previousEnd, end);
    if (caption.box) {
      const { x, y, width, height } = caption.box;
      const inside = x >= 72 && y >= 150 && x + width <= 1008 && y + height <= 1660;
      if (!inside) errors.push(`第 ${index + 1} 条字幕超出竖屏安全区`);
    }
  });
  return { ok: errors.length === 0, errors, warnings };
}

function validateTimeline(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("分镜不能为空");
  let cursor = 0;
  for (const [index, scene] of scenes.entries()) {
    if (!almostEqual(scene.startSeconds, cursor)) throw new Error(`第 ${index + 1} 段分镜与前一段不连续`);
    if (!Number.isFinite(scene.endSeconds) || scene.endSeconds <= scene.startSeconds) throw new Error(`第 ${index + 1} 段分镜时长无效`);
    cursor = Number(scene.endSeconds);
  }
  return cursor;
}

export function buildRenderPlan(project) {
  if (!project?.approvals?.script || !project?.approvals?.voice) throw new Error("文案和旁白未放行");
  if (!project?.voice?.path) throw new Error("旁白文件不存在于项目账本");
  if (!project?.outputs?.preview) throw new Error("缺少预览输出路径");
  const scenes = structuredClone(project.storyboard || []);
  const durationSeconds = validateTimeline(scenes);
  const report = validateRenderInputs({ storyboard: scenes, captions: project.script?.captions || [], durationSeconds });
  if (!report.ok) throw new Error(report.errors.join("；"));
  return {
    ...OUTPUT_SPEC,
    durationSeconds,
    scenes,
    captions: structuredClone(project.script?.captions || []),
    audioPath: project.voice.path,
    outputPath: project.outputs.preview,
  };
}

async function findFont(preferred) {
  const candidates = preferred ? [preferred, ...FONT_CANDIDATES] : FONT_CANDIDATES;
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue through the fixed local font candidates.
    }
  }
  throw new Error("未找到可用于中文字幕的 PingFang 或华文黑体字体");
}

function escapeFilterText(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "’")
    .replaceAll(":", "\\:")
    .replaceAll("\n", "\\n");
}

function drawText(text, { fontPath, fontSize, x, y, color = "white", align = "left", enable } = {}) {
  if (!text) return "";
  const positionX = align === "center" ? "(w-text_w)/2" : x;
  const fields = [
    `drawtext=fontfile='${fontPath}'`,
    `text='${escapeFilterText(text)}'`,
    "expansion=none",
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `x=${positionX}`,
    `y=${y}`,
  ];
  if (enable) fields.push(`enable='${enable}'`);
  return fields.join(":");
}

function sceneInputArgs(scene, duration, fps) {
  if (!scene.assetPath) {
    const color = String(scene.backgroundColor || "#07120d").replace("#", "0x");
    return ["-f", "lavfi", "-t", String(duration), "-i", `color=c=${color}:s=1080x1920:r=${fps}`];
  }
  if (IMAGE_EXTENSIONS.has(extname(scene.assetPath).toLowerCase())) {
    return ["-loop", "1", "-framerate", String(fps), "-t", String(duration), "-i", scene.assetPath];
  }
  return ["-stream_loop", "-1", "-ss", String(scene.sourceStartSeconds || 0), "-t", String(duration), "-i", scene.assetPath];
}

export async function renderProject(plan, { ffmpegPath = "ffmpeg", fontPath, run = execFileAsync } = {}) {
  const validation = validateRenderInputs({ storyboard: plan.scenes, captions: plan.captions, durationSeconds: plan.durationSeconds });
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  await access(plan.audioPath);
  for (const scene of plan.scenes) if (scene.assetPath) await access(scene.assetPath);
  const resolvedFont = await findFont(fontPath);
  await mkdir(dirname(plan.outputPath), { recursive: true, mode: 0o700 });

  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  const filters = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const duration = Number(scene.endSeconds) - Number(scene.startSeconds);
    args.push(...sceneInputArgs(scene, duration, plan.fps));
    const light = /^#?(f|e|d)/i.test(scene.backgroundColor || "");
    const textColor = scene.textColor || (light ? "#17201a" : "white");
    const chain = [
      `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase`,
      `crop=${plan.width}:${plan.height}`,
      "setsar=1",
      `fps=${plan.fps}`,
      `trim=duration=${duration}`,
      "setpts=PTS-STARTPTS",
      "format=yuv420p",
    ];
    if (scene.kicker) chain.push(drawText(scene.kicker, { fontPath: resolvedFont, fontSize: 30, x: 72, y: 180, color: scene.accentColor || "#69f29a" }));
    if (scene.headline) chain.push(drawText(scene.headline, { fontPath: resolvedFont, fontSize: 76, x: 72, y: 320, color: textColor }));
    if (scene.body) chain.push(drawText(scene.body, { fontPath: resolvedFont, fontSize: 40, x: 72, y: 590, color: textColor }));
    filters.push(`[${index}:v]${chain.filter(Boolean).join(",")}[s${index}]`);
  }

  const sceneLabels = plan.scenes.map((_, index) => `[s${index}]`).join("");
  filters.push(`${sceneLabels}concat=n=${plan.scenes.length}:v=1:a=0[vbase]`);
  let videoLabel = "vbase";
  for (const [index, caption] of (plan.captions || []).entries()) {
    const next = `vc${index}`;
    const enable = `between(t\\,${caption.startSeconds}\\,${caption.endSeconds})`;
    const box = caption.box || { x: 72, y: 1500, width: 936, height: 120 };
    const boxFilter = `drawbox=x=${box.x}:y=${box.y}:w=${box.width}:h=${box.height}:color=black@0.78:t=fill:enable='${enable}'`;
    const textFilter = drawText(caption.text, {
      fontPath: resolvedFont,
      fontSize: caption.fontSize || 44,
      x: box.x + 24,
      y: box.y + Math.max(12, Math.round((box.height - (caption.fontSize || 44)) / 2) - 4),
      color: "white",
      align: "center",
      enable,
    });
    filters.push(`[${videoLabel}]${boxFilter},${textFilter}[${next}]`);
    videoLabel = next;
  }

  args.push("-i", plan.audioPath);
  const audioIndex = plan.scenes.length;
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`,
    "-map", `${audioIndex}:a:0`,
    "-t", String(plan.durationSeconds),
    "-af", `apad=pad_dur=${plan.durationSeconds}`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level:v", "4.1",
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "48000",
    "-movflags", "+faststart",
    plan.outputPath,
  );
  await run(ffmpegPath, args, { maxBuffer: 16 * 1024 * 1024 });
  return { ok: true, outputPath: plan.outputPath, durationSeconds: plan.durationSeconds, command: "ffmpeg" };
}

async function runCli() {
  const projectFlag = process.argv.indexOf("--project");
  if (projectFlag < 0 || !process.argv[projectFlag + 1]) throw new Error("用法：render-project.mjs --project <project.json>");
  const project = JSON.parse(await readFile(process.argv[projectFlag + 1], "utf8"));
  const receipt = await renderProject(buildRenderPlan(project), { ffmpegPath: "/Users/nanbosheyingimacpro/.local/bin/ffmpeg" });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1]?.endsWith("render-project.mjs")) await runCli();


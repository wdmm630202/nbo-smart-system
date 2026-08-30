import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff"]);
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]);

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRate(value) {
  if (!value || value === "0/0") return null;
  const [numerator, denominator = "1"] = String(value).split("/");
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? Number(rate.toFixed(6)) : null;
}

export function normalizeProbe(input) {
  const streams = Array.isArray(input?.streams) ? input.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const format = input?.format || {};
  return {
    type: video ? "video" : audio ? "audio" : "unknown",
    durationSeconds: finiteNumber(format.duration),
    width: finiteNumber(video?.width),
    height: finiteNumber(video?.height),
    fps: parseRate(video?.avg_frame_rate || video?.r_frame_rate),
    videoCodec: video?.codec_name || null,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name || null,
    sampleRate: finiteNumber(audio?.sample_rate),
    channels: finiteNumber(audio?.channels),
    bitRate: finiteNumber(format.bit_rate),
  };
}

export async function fingerprintFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function probeMedia(path, { ffprobePath = "ffprobe", run = execFileAsync } = {}) {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels",
    "-of", "json",
    path,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const normalized = normalizeProbe(JSON.parse(stdout));
  const extension = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return { ...normalized, type: "image", durationSeconds: null, fps: null };
  if (AUDIO_EXTENSIONS.has(extension)) return { ...normalized, type: "audio" };
  return normalized;
}

async function discoverMedia(inputPaths) {
  const discovered = [];
  const seen = new Set();

  async function visit(candidate) {
    const absolute = resolve(candidate);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const details = await lstat(absolute);
    if (details.isSymbolicLink()) return;
    if (details.isDirectory()) {
      const entries = await readdir(absolute, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        await visit(resolve(absolute, entry.name));
      }
      return;
    }
    if (details.isFile() && MEDIA_EXTENSIONS.has(extname(absolute).toLowerCase())) discovered.push(absolute);
  }

  for (const path of inputPaths) await visit(path);
  return discovered;
}

export async function indexMedia(paths, { probe = probeMedia, ffprobePath } = {}) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("至少选择一个素材文件或目录");
  const files = await discoverMedia(paths);
  const assets = [];
  for (const path of files) {
    const [details, sha256, media] = await Promise.all([
      stat(path),
      fingerprintFile(path),
      probe(path, { ffprobePath }),
    ]);
    assets.push({
      assetId: sha256.slice(0, 20),
      name: basename(path),
      path,
      extension: extname(path).toLowerCase(),
      sizeBytes: details.size,
      mtimeMs: details.mtimeMs,
      sha256,
      media,
      indexedAt: new Date().toISOString(),
    });
  }
  return assets;
}

export async function verifyMediaFingerprint(asset) {
  if (!asset?.path || !asset?.sha256) throw new Error("素材记录缺少路径或指纹");
  const actualSha256 = await fingerprintFile(asset.path);
  return { ok: actualSha256 === asset.sha256, actualSha256 };
}

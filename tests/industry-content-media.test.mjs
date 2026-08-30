import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  fingerprintFile,
  indexMedia,
  normalizeProbe,
  verifyMediaFingerprint,
} from "../tools/industry-content-workbench/media-library.mjs";
import { selectLocalPath } from "../tools/industry-content-workbench/select-path.mjs";

async function withFixture(run) {
  const rootDir = await mkdtemp(join(tmpdir(), "nbo-content-media-"));
  try {
    const filePath = join(rootDir, "样片.mp4");
    await writeFile(filePath, "original-media-bytes");
    await run({ rootDir, filePath });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("素材索引只读原文件并记录可复核指纹", async () => {
  await withFixture(async ({ filePath }) => {
    const before = await stat(filePath);
    const expected = await fingerprintFile(filePath);
    const [asset] = await indexMedia([filePath], {
      probe: async () => ({ type: "video", durationSeconds: 12.5, width: 1080, height: 1920, fps: 30, hasAudio: true }),
    });
    const after = await stat(filePath);

    assert.equal(asset.sha256, expected);
    assert.equal(asset.path, filePath);
    assert.equal(asset.media.durationSeconds, 12.5);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(await readFile(filePath, "utf8"), "original-media-bytes");
  });
});

test("指纹变更会阻断旧素材引用", async () => {
  await withFixture(async ({ filePath }) => {
    const [asset] = await indexMedia([filePath], { probe: async () => ({ type: "video" }) });
    await writeFile(filePath, "changed");
    const verification = await verifyMediaFingerprint(asset);
    assert.equal(verification.ok, false);
    assert.notEqual(verification.actualSha256, asset.sha256);
  });
});

test("ffprobe 输出会被规范化为稳定的媒体元数据", () => {
  const media = normalizeProbe({
    streams: [
      { codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2 },
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" },
    ],
    format: { duration: "10.250000", bit_rate: "900000" },
  });

  assert.deepEqual(media, {
    type: "video",
    durationSeconds: 10.25,
    width: 1920,
    height: 1080,
    fps: 29.97003,
    videoCodec: "h264",
    hasAudio: true,
    audioCodec: "aac",
    sampleRate: 44100,
    channels: 2,
    bitRate: 900000,
  });
});

test("目录索引递归发现媒体并忽略无关文件和符号链接", async () => {
  await withFixture(async ({ rootDir }) => {
    await writeFile(join(rootDir, "海报.jpg"), "image");
    await writeFile(join(rootDir, "说明.txt"), "ignore");
    const assets = await indexMedia([rootDir], { probe: async (path) => ({ type: path.endsWith(".jpg") ? "image" : "video" }) });
    assert.deepEqual(assets.map(({ name }) => name).sort(), ["样片.mp4", "海报.jpg"]);
  });
});

test("macOS 选择器取消时返回 null 且拒绝未知类型", async () => {
  assert.equal(await selectLocalPath({ kind: "file", run: async () => ({ stdout: "\n" }) }), null);
  await assert.rejects(selectLocalPath({ kind: "volume", run: async () => ({ stdout: "" }) }), /选择类型/);
});

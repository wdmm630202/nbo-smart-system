import { homedir } from "node:os";
import { join } from "node:path";

export const WORKBENCH_VERSION = "1.0.0";
export const WORKBENCH_HOST = "127.0.0.1";
export const WORKBENCH_PORT = 4176;
export const WORKBENCH_ROOT = join(homedir(), "Documents", "NBO-行业内容工作台");

export const STAGE_IDS = ["evidence", "script", "voice", "storyboard", "qa", "export"];
export const STAGE_LABELS = {
  evidence: "选题与证据",
  script: "文案",
  voice: "旁白",
  storyboard: "分镜与素材",
  qa: "字幕与质检",
  export: "导出",
};
export const STAGE_STATUSES = ["pending", "running", "needs_review", "completed", "failed"];
export const OUTPUT_SPEC = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: "h264",
  audioCodec: "aac",
};

export const NANBO_ALLOWED_CLAIMS = new Map([
  ["package_268_two_sets", "268拍摄2套"],
  ["all_originals_included", "全部原片全送"],
  ["no_retouch_upsell", "不推销加精修"],
]);

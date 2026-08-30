const REQUIRED_ORIGINALITY_EXCLUSIONS = ["参考博主的人物形象", "参考视频原文案", "参考视频界面截图"];
const SECTIONS = [
  { role: "hook", ratio: 0.12, mode: "evidence-card" },
  { role: "problem", ratio: 0.18, mode: "dark-dashboard" },
  { role: "evidence", ratio: 0.25, mode: "source-proof" },
  { role: "mechanism", ratio: 0.18, mode: "warm-process" },
  { role: "nanbo-proof", ratio: 0.17, mode: "real-process" },
  { role: "cta", ratio: 0.10, mode: "brand-card" },
];

export function validateStyleProfile(profile) {
  if (!profile || typeof profile !== "object") throw new Error("风格模板无效");
  if (profile.output?.humanAppearance !== false) throw new Error("南铂模板必须保持不出镜");
  if (profile.output?.canvas?.width !== 1080 || profile.output?.canvas?.height !== 1920) throw new Error("南铂模板必须使用 1080×1920 竖屏");
  if (!Number.isFinite(profile.cadence?.maxShotSeconds) || profile.cadence.maxShotSeconds <= 0) throw new Error("镜头节奏上限无效");
  const exclusions = profile.originality?.exclude;
  if (!Array.isArray(exclusions) || REQUIRED_ORIGINALITY_EXCLUSIONS.some((entry) => !exclusions.includes(entry))) {
    throw new Error("原创边界不完整");
  }
  const serialized = JSON.stringify(profile);
  if (serialized.includes("/Users/") || serialized.includes("file://")) throw new Error("风格模板不得记录本机绝对路径");
  return profile;
}

export function buildVisualBeatPlan(durationSeconds, rawProfile) {
  const profile = validateStyleProfile(rawProfile);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < 12 || duration > 180) throw new Error("成片时长需在 12–180 秒之间");
  const beats = [];
  let sectionStart = 0;
  for (const [sectionIndex, section] of SECTIONS.entries()) {
    const sectionEnd = sectionIndex === SECTIONS.length - 1
      ? duration
      : Number((sectionStart + duration * section.ratio).toFixed(3));
    const sectionDuration = sectionEnd - sectionStart;
    const shotCount = Math.max(1, Math.ceil(sectionDuration / profile.cadence.maxShotSeconds));
    for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
      const startSeconds = Number((sectionStart + (sectionDuration * shotIndex) / shotCount).toFixed(3));
      const endSeconds = shotIndex === shotCount - 1
        ? sectionEnd
        : Number((sectionStart + (sectionDuration * (shotIndex + 1)) / shotCount).toFixed(3));
      beats.push({
        beatId: `${section.role}-${shotIndex + 1}`,
        role: section.role,
        mode: section.mode,
        startSeconds,
        endSeconds,
      });
    }
    sectionStart = sectionEnd;
  }
  return beats;
}


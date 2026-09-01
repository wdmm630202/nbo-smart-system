const STYLE_FAVORITES_KEY = "nanbo-favorite-styles";
const POSE_SELECTIONS_KEY = "nanbo-selected-poses";
const neutralPosePattern = /^拍摄参考\s*0?([1-9])$/;

function readArray(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem?.(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function librarySlots(library) {
  if (Array.isArray(library?.slots)) return library.slots;
  return Array.isArray(library?.styles)
    ? library.styles.flatMap((style) => Array.isArray(style.slots) ? style.slots : [])
    : [];
}

function storedIds(values) {
  return [...values]
    .filter((id) => typeof id === "string" && id)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function neutralPosePosition(slot) {
  const match = typeof slot?.poseLabel === "string" ? slot.poseLabel.trim().match(neutralPosePattern) : null;
  return match && Number(match[1]) === slot.position ? slot.position : null;
}

function poseDescription(slots) {
  const descriptions = [];
  let neutralPositions = [];
  const flushNeutralPositions = () => {
    if (!neutralPositions.length) return;
    descriptions.push(`第 ${neutralPositions.join("、")} 个拍摄参考`);
    neutralPositions = [];
  };
  for (const slot of slots) {
    const neutralPosition = neutralPosePosition(slot);
    if (neutralPosition) neutralPositions.push(neutralPosition);
    else {
      flushNeutralPositions();
      descriptions.push(slot.poseLabel.trim());
    }
  }
  flushNeutralPositions();
  return descriptions.join("、");
}

function legacyAssetIds(assets) {
  return [...new Set((assets || []).map((asset) => (
    Number.isInteger(asset) ? asset : Number.isInteger(asset?.id) ? asset.id : 0
  )).filter((id) => id > 0))].sort((left, right) => left - right);
}

export function readStylePreferences(storage, library) {
  const validStyles = new Set((library?.styles || []).map(({ id }) => id));
  const validSlots = new Set(librarySlots(library).map(({ id }) => id));
  return {
    styleIds: new Set(readArray(storage, STYLE_FAVORITES_KEY).filter((id) => validStyles.has(id))),
    slotIds: new Set(readArray(storage, POSE_SELECTIONS_KEY).filter((id) => validSlots.has(id))),
  };
}

export function writeStylePreferences(storage, preferences) {
  storage?.setItem?.(STYLE_FAVORITES_KEY, JSON.stringify(storedIds(preferences?.styleIds || [])));
  storage?.setItem?.(POSE_SELECTIONS_KEY, JSON.stringify(storedIds(preferences?.slotIds || [])));
}

export function buildPoseBrief({ slotIds, library, legacyFavoriteAssets = [], settings = {} }) {
  const styles = Array.isArray(library?.styles) ? library.styles : [];
  const styleOrder = new Map(styles.map((style, index) => [style.id, index]));
  const styleById = new Map(styles.map((style) => [style.id, style]));
  const slotById = new Map(librarySlots(library).map((slot) => [slot.id, slot]));
  const chosenSlots = [...(slotIds || [])]
    .map((id) => slotById.get(id))
    .filter(Boolean)
    .sort((left, right) => (
      (styleOrder.get(left.styleId) ?? Number.MAX_SAFE_INTEGER) - (styleOrder.get(right.styleId) ?? Number.MAX_SAFE_INTEGER)
      || left.styleId.localeCompare(right.styleId, "en")
      || left.position - right.position
    ));
  const grouped = new Map();
  for (const slot of chosenSlots) {
    if (!grouped.has(slot.styleId)) grouped.set(slot.styleId, []);
    grouped.get(slot.styleId).push(slot);
  }
  const groups = [...grouped].map(([styleId, slots]) => {
    const style = styleById.get(styleId);
    return {
      styleId,
      styleLabel: style?.label || styleId,
      slots: slots.map((slot) => ({
        ...slot,
        displayLabel: neutralPosePosition(slot) ? `第 ${slot.position} 个拍摄参考` : slot.poseLabel.trim(),
      })),
    };
  });
  const legacyIds = legacyAssetIds(legacyFavoriteAssets);
  const lines = ["南铂摄影拍摄需求"];
  for (const group of groups) {
    lines.push(`风格：${group.styleLabel}`);
    lines.push(`想拍姿势：${poseDescription(group.slots)}`);
  }
  if (legacyIds.length) {
    lines.push(`其他喜欢客片：${legacyIds.map((id) => `NB-${String(id).padStart(3, "0")}`).join("、")}`);
  }
  const note = typeof settings?.note === "string" ? settings.note.trim() : "";
  if (note) lines.push(`补充要求：${note}`);
  return { groups, text: lines.join("\n") };
}

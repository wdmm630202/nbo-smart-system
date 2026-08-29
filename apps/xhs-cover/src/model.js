export const DEFAULT_STATE = Object.freeze({
  mode: 'compare',
  canvas: Object.freeze({ width: 1080, height: 1440 }),
  line1: '无需刻意',
  line2: '自然自有力量',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  beforeZoom: 1.3,
  beforeOffsetX: 0,
  beforeOffsetY: 0,
  textSide: 'left',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const titleLength = (value) => Array.from(String(value ?? '').trim()).length;

export function normalizeState(input = {}) {
  const state = { ...DEFAULT_STATE, ...input };
  state.mode = state.mode === 'single' ? 'single' : 'compare';
  state.zoom = clamp(state.zoom, 1, 2.2);
  state.offsetX = clamp(state.offsetX, -1, 1);
  state.offsetY = clamp(state.offsetY, -1, 1);
  state.beforeZoom = clamp(state.beforeZoom, 1, 2.2);
  state.beforeOffsetX = clamp(state.beforeOffsetX, -1, 1);
  state.beforeOffsetY = clamp(state.beforeOffsetY, -1, 1);
  state.line1 = String(state.line1 ?? '');
  state.line2 = String(state.line2 ?? '');
  state.titleWarnings = {
    line1: titleLength(state.line1) > 7 ? '建议控制在7个汉字以内' : '',
    line2: titleLength(state.line2) > 7 ? '建议控制在7个汉字以内' : '',
  };
  return state;
}

export function coverRect(imageWidth, imageHeight, frame, zoom = 1, offsetX = 0, offsetY = 0) {
  const scale = Math.max(frame.width / imageWidth, frame.height / imageHeight) * clamp(zoom, 1, 2.2);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const travelX = Math.max(0, width - frame.width) / 2;
  const travelY = Math.max(0, height - frame.height) / 2;
  return {
    x: frame.x + (frame.width - width) / 2 + clamp(offsetX, -1, 1) * travelX,
    y: frame.y + (frame.height - height) / 2 + clamp(offsetY, -1, 1) * travelY,
    width,
    height,
  };
}

export function evidenceLayout(canvas, beforeZoom = DEFAULT_STATE.beforeZoom) {
  const width = Math.round(canvas.width * 0.39);
  const height = Math.round(canvas.height * 0.42);
  return {
    frame: {
      x: canvas.width - width - Math.round(canvas.width * 0.027),
      y: canvas.height - height - Math.round(canvas.height * 0.0194),
      width,
      height,
      radius: Math.round(canvas.width * 0.0278),
    },
    imageZoom: clamp(beforeZoom, 1, 2.2),
    imageInset: 4,
  };
}

export function evidenceFadeStops() {
  return [
    [0, 0],
    [0.04, 0.78],
    [0.08, 1],
    [0.92, 1],
    [0.96, 0.78],
    [1, 0],
  ];
}

export function comparisonLabelLayout(canvas) {
  const { frame } = evidenceLayout(canvas);
  const right = canvas.width - 48;
  const capsule = { width: 104, height: 54, radius: 27 };
  const emphasis = { width: 38, height: 38, radius: 19, inset: 8 };
  return {
    after: { right, y: 48, ...capsule, emphasis: { ...emphasis } },
    before: { right, y: frame.y + 24, ...capsule, emphasis: { ...emphasis } },
  };
}

export function comparisonLabelContent() {
  return {
    prefix: '拍摄',
    after: '后',
    before: '前',
  };
}

export function comparisonLabelTypography() {
  return { prefixLetterSpacing: 2 };
}

export function titleLayout() {
  return {
    left: 64,
    eyebrowBaseline: 1153,
    line1Baseline: 1240,
    line2Baseline: 1330,
    accent: { x: 64, y: 1378, width: 64, height: 4, radius: 2 },
  };
}

export function titleTypography() {
  return {
    eyebrowText: '真实客片 · NANBOART',
    eyebrowSize: 16,
    eyebrowWeight: 500,
    eyebrowLetterSpacing: 4,
    titleSize: 68,
    titleWeight: 600,
    titleLetterSpacing: 1,
    textAlign: 'left',
    accentColor: '#fee800',
  };
}

export function validateForExport(state) {
  if (!state.afterReady) return ['请先添加成片'];
  if (state.mode === 'compare' && !state.beforeReady) return ['请添加到店照，或切换为单张模式'];
  return [];
}

export function buildExportFilename(title, date = new Date().toISOString().slice(0, 10)) {
  const safe = String(title || '南铂')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${date}-${safe || '南铂'}-小红书封面.png`;
}

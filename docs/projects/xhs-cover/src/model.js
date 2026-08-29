export const DEFAULT_STATE = Object.freeze({
  mode: 'compare',
  canvas: Object.freeze({ width: 1080, height: 1440 }),
  line1: '不会摆动作',
  line2: '也能拍得自然',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  beforeZoom: 1.17,
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
  };
}

export function evidenceFadeStops() {
  return [
    [0, 0],
    [0.11, 0.72],
    [0.2, 1],
    [0.8, 1],
    [0.89, 0.72],
    [1, 0],
  ];
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

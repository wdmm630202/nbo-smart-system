import { DEFAULT_STATE, normalizeState, validateForExport, buildExportFilename } from './model.js';
import { renderCover } from './renderer.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#coverCanvas');
const ctx = canvas.getContext('2d');
let state = normalizeState(DEFAULT_STATE);
const images = { after: null, before: null };
const objectUrls = { after: null, before: null };
let framePending = false;

function setStatus(message, kind = '') {
  const status = $('#status');
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function requestRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    state = normalizeState(state);
    renderCover(ctx, state, images);
    $('#line1Warning').textContent = state.titleWarnings.line1;
    $('#line2Warning').textContent = state.titleWarnings.line2;
    framePending = false;
  });
}

function loadImageSource(src, slot, displayName) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      images[slot] = image;
      $(`#${slot}Name`).textContent = displayName;
      requestRender();
      resolve(image);
    };
    image.onerror = () => reject(new Error('图片解码失败，请重新选择'));
    image.src = src;
  });
}

async function loadFile(file, slot) {
  if (!file?.type.startsWith('image/')) throw new Error('请选择 JPG、PNG 或其他图片文件');
  if (objectUrls[slot]) URL.revokeObjectURL(objectUrls[slot]);
  objectUrls[slot] = URL.createObjectURL(file);
  await loadImageSource(objectUrls[slot], slot, file.name);
}

async function loadExample() {
  try {
    const [afterResponse, beforeResponse] = await Promise.all([
      fetch('assets/example-after.jpg'),
      fetch('assets/example-before.jpg'),
    ]);
    if (!afterResponse.ok || !beforeResponse.ok) throw new Error('示例照片未准备好');
    const [afterBlob, beforeBlob] = await Promise.all([afterResponse.blob(), beforeResponse.blob()]);
    if (objectUrls.after) URL.revokeObjectURL(objectUrls.after);
    if (objectUrls.before) URL.revokeObjectURL(objectUrls.before);
    objectUrls.after = URL.createObjectURL(afterBlob);
    objectUrls.before = URL.createObjectURL(beforeBlob);
    await Promise.all([
      loadImageSource(objectUrls.after, 'after', 'T62_7263.JPG'),
      loadImageSource(objectUrls.before, 'before', '2977.JPG'),
    ]);
    state = normalizeState({ ...DEFAULT_STATE, offsetX: .18, offsetY: -.04, beforeOffsetY: -.05 });
    syncControls();
    setStatus('示例已加载，可直接替换照片', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function syncControls() {
  for (const key of ['line1', 'line2', 'zoom', 'offsetX', 'offsetY', 'beforeZoom', 'beforeOffsetX', 'beforeOffsetY']) {
    $(`#${key}`).value = state[key];
  }
  document.querySelectorAll('.mode-button').forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const compare = state.mode === 'compare';
  $('#beforeUpload').hidden = !compare;
  $('#beforeAdjustments').hidden = !compare;
  requestRender();
}

$('#afterInput').addEventListener('change', async (event) => {
  try { await loadFile(event.target.files[0], 'after'); setStatus('成片已替换', 'success'); }
  catch (error) { setStatus(error.message, 'error'); }
});
$('#beforeInput').addEventListener('change', async (event) => {
  try { await loadFile(event.target.files[0], 'before'); setStatus('到店照已替换', 'success'); }
  catch (error) { setStatus(error.message, 'error'); }
});
$('#loadExample').addEventListener('click', loadExample);

document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  syncControls();
}));

for (const key of ['line1', 'line2']) {
  $(`#${key}`).addEventListener('input', (event) => { state[key] = event.target.value; requestRender(); });
}
for (const key of ['zoom', 'offsetX', 'offsetY', 'beforeZoom', 'beforeOffsetX', 'beforeOffsetY']) {
  $(`#${key}`).addEventListener('input', (event) => { state[key] = Number(event.target.value); requestRender(); });
}

$('#resetButton').addEventListener('click', () => {
  state = normalizeState({ ...state, zoom: 1, offsetX: 0, offsetY: 0, beforeZoom: DEFAULT_STATE.beforeZoom, beforeOffsetX: 0, beforeOffsetY: 0 });
  syncControls();
  setStatus('照片位置已恢复默认');
});

$('#exportButton').addEventListener('click', () => {
  const errors = validateForExport({ mode: state.mode, afterReady: Boolean(images.after), beforeReady: Boolean(images.before) });
  if (errors.length) { setStatus(errors[0], 'error'); return; }
  renderCover(ctx, state, images);
  canvas.toBlob((blob) => {
    if (!blob) { setStatus('导出失败，请重试', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildExportFilename(state.line1);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('已导出 1080×1440 PNG', 'success');
  }, 'image/png');
});

let drag = null;
canvas.addEventListener('pointerdown', (event) => {
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const rect = canvas.getBoundingClientRect();
  state.offsetX = Math.max(-1, Math.min(1, drag.offsetX + (event.clientX - drag.x) / rect.width * 2));
  state.offsetY = Math.max(-1, Math.min(1, drag.offsetY + (event.clientY - drag.y) / rect.height * 2));
  $('#offsetX').value = state.offsetX;
  $('#offsetY').value = state.offsetY;
  requestRender();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });

window.addEventListener('beforeunload', () => Object.values(objectUrls).forEach((url) => url && URL.revokeObjectURL(url)));
syncControls();

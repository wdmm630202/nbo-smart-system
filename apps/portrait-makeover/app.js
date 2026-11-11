import { POSTER, PHOTO_AREA, clampSplit, getPanes, coverImage } from './geometry.mjs';

const $ = (selector) => document.querySelector(selector);
const preview = $('#preview');
const previewContext = preview.getContext('2d');
const names = ['素颜照片', '精修照片'];
const photos = names.map(() => ({ image: null, zoom: 1, panX: 0, panY: 0, request: 0, loading: false }));
let template = null;
let templateRequest = 0;
let split = .5;
let activeSide = 0;
let pointer = null;
let frame = 0;
let revision = 0;
let exporting = false;
let downloadURL = null;

function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}

function ready() {
  return Boolean(template && photos.every((photo) => photo.image && !photo.loading));
}

function updateButtons() {
  $('#export-png').disabled = $('#export-jpg').disabled = exporting || !ready();
  photos.forEach((photo, side) => {
    $(`#zoom-${side}`).disabled = !photo.image || photo.loading;
    $(`[data-reset="${side}"]`).disabled = !photo.image || photo.loading;
    $(`#zoom-${side}`).value = photo.zoom;
    $(`#zoom-value-${side}`).textContent = `${photo.zoom.toFixed(2)}×`;
  });
}

function readyStatus() {
  if (!template) {
    if (!$('#retry-template').hidden) status('原版模板加载失败，请检查网络后重新加载。模板就绪前无法导出。', true);
    return;
  }
  if (photos.some((photo) => photo.loading)) {
    status('正在读取照片…');
    return;
  }
  if (ready()) status('两张照片已就绪，可以导出。');
  else status(`请选择${photos.map((photo, side) => !photo.image ? names[side] : '').filter(Boolean).join('和')}。`);
}

function clearDownload() {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = null;
  $('#download-result').hidden = true;
  $('#download-link').removeAttribute('href');
  $('#open-image').removeAttribute('href');
}

function edited() {
  revision += 1;
  if (downloadURL) {
    clearDownload();
    status('构图已更新，可以重新导出。');
  }
  renderSoon();
}

function paint(context, width, height) {
  context.save();
  context.clearRect(0, 0, width, height);
  context.scale(width / POSTER.width, height / POSTER.height);
  // The source PSD's rounded outer corners keep a white underfill in both formats.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, POSTER.width, POSTER.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  getPanes(split, width).forEach((pane, side) => {
    if (pane.width <= 0) return;
    context.save();
    context.beginPath();
    context.rect(pane.x, pane.y, pane.width, pane.height);
    context.clip();
    const photo = photos[side];
    if (photo.image) {
      const placement = coverImage(pane, photo.image.naturalWidth, photo.image.naturalHeight, photo.zoom, photo.panX, photo.panY);
      context.drawImage(photo.image, placement.x, placement.y, placement.width, placement.height);
    } else {
      context.fillStyle = side === 0 ? '#e5e8e3' : '#d6ddd5';
      context.fillRect(pane.x, pane.y, pane.width, pane.height);
    }
    context.restore();
  });
  // All design, lettering, fades, borders and logos come only from the original overlay.
  if (template) context.drawImage(template, 0, 0, POSTER.width, POSTER.height);
  context.restore();
}

function renderSoon() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paint(previewContext, preview.width, preview.height);
    const panes = getPanes(split, preview.width);
    const pane = panes[activeSide];
    $('#selection').style.left = `${pane.x / POSTER.width * 100}%`;
    $('#selection').style.width = `${pane.width / POSTER.width * 100}%`;
    $('#divider').style.left = `${panes[1].x / POSTER.width * 100}%`;
  });
}

function selectSide(side) {
  activeSide = side;
  document.querySelectorAll('.photo-card').forEach((card, index) => card.classList.toggle('selected', index === side));
  $(`input[name="active-side"][value="${side}"]`).checked = true;
  $('#active-label').textContent = `正在调整：${names[side]}`;
  renderSoon();
}

function setSplit(value) {
  split = clampSplit(value);
  const percentage = Math.round(split * 1000) / 10;
  $('#split').value = percentage;
  $('#split-value').textContent = `${percentage}%`;
  $('#split-handle').setAttribute('aria-valuenow', String(percentage));
  $('#split-handle').setAttribute('aria-valuetext', `素颜照片占 ${percentage}%，精修照片占 ${Math.round((100 - percentage) * 10) / 10}%`);
  edited();
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('图片没有有效尺寸'));
    image.onerror = () => reject(new Error('无法解码图片'));
    image.src = url;
  });
}

async function loadPhoto(file, side) {
  const photo = photos[side];
  const request = ++photo.request;
  photo.loading = false;
  // MIME can be empty for local files; allow only these three known extensions then.
  const supported = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!supported) {
    status(`${names[side]}格式不支持，请使用 JPG、PNG 或 WebP。`, true);
    updateButtons();
    return;
  }
  photo.loading = true;
  updateButtons();
  status(`正在读取${names[side]}…`);
  let url;
  try {
    url = URL.createObjectURL(file);
    const image = await decodeImage(url);
    if (request !== photo.request) return;
    Object.assign(photo, { image, zoom: 1, panX: 0, panY: 0 });
    $(`#file-name-${side}`).textContent = file.name;
    $(`#file-name-${side}`).title = file.name;
    selectSide(side);
    edited();
  } catch {
    if (request === photo.request) status(`${names[side]}读取失败，图片可能已损坏或浏览器无法解码，请换一张 JPG、PNG 或 WebP。`, true);
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (request === photo.request) {
      photo.loading = false;
      updateButtons();
      // Retain a useful decode error instead of replacing it with a ready message.
      if (!$('#status').classList.contains('error')) readyStatus();
    }
  }
}

async function loadTemplate() {
  const request = ++templateRequest;
  $('#retry-template').hidden = true;
  status('正在加载原版模板…');
  try {
    const image = await decodeImage(`./assets/template-overlay.png${request > 1 ? `?retry=${request}` : ''}`);
    if (request !== templateRequest) return;
    if (image.naturalWidth !== POSTER.width || image.naturalHeight !== POSTER.height) throw new Error('模板尺寸不符');
    template = image;
    renderSoon();
    readyStatus();
  } catch {
    if (request !== templateRequest) return;
    template = null;
    $('#retry-template').hidden = false;
    status('原版模板加载失败，请检查网络后重新加载。模板就绪前无法导出。', true);
  }
  updateButtons();
}

function point(event) {
  const bounds = preview.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * POSTER.width / bounds.width, y: (event.clientY - bounds.top) * POSTER.height / bounds.height };
}

preview.addEventListener('pointerdown', (event) => {
  if (pointer || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const position = point(event);
  const panes = getPanes(split, preview.width);
  const side = position.x < panes[1].x ? 0 : 1;
  selectSide(side);
  preview.focus({ preventScroll: true });
  const photo = photos[side];
  if (!photo.image || photo.loading) return;
  const placement = coverImage(panes[side], photo.image.naturalWidth, photo.image.naturalHeight, photo.zoom, photo.panX, photo.panY);
  pointer = { id: event.pointerId, type: 'photo', side, startX: position.x, startY: position.y, panX: photo.panX, panY: photo.panY, marginX: placement.marginX, marginY: placement.marginY };
  preview.setPointerCapture(event.pointerId);
  event.preventDefault();
});

$('#divider').addEventListener('pointerdown', (event) => {
  if (pointer || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointer = { id: event.pointerId, type: 'split', offset: point(event).x - (PHOTO_AREA.x + PHOTO_AREA.width * split) };
  event.currentTarget.setPointerCapture(event.pointerId);
  $('#split-handle').focus({ preventScroll: true });
  event.preventDefault();
});

function movePointer(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const position = point(event);
  if (pointer.type === 'split') setSplit((position.x - pointer.offset - PHOTO_AREA.x) / PHOTO_AREA.width);
  else {
    const photo = photos[pointer.side];
    photo.panX = pointer.marginX ? Math.max(-1, Math.min(1, pointer.panX + (position.x - pointer.startX) / pointer.marginX)) : 0;
    photo.panY = pointer.marginY ? Math.max(-1, Math.min(1, pointer.panY + (position.y - pointer.startY) / pointer.marginY)) : 0;
    edited();
  }
}

for (const target of [preview, $('#divider')]) {
  target.addEventListener('pointermove', movePointer);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) target.addEventListener(type, (event) => {
    if (pointer?.id === event.pointerId) pointer = null;
  });
}

$('#split-handle').addEventListener('keydown', (event) => {
  const changes = { ArrowLeft: -.01, ArrowDown: -.01, ArrowRight: .01, ArrowUp: .01, PageDown: -.1, PageUp: .1 };
  if (event.key in changes) setSplit(split + changes[event.key]);
  else if (event.key === 'Home') setSplit(0);
  else if (event.key === 'End') setSplit(1);
  else return;
  event.preventDefault();
});

preview.addEventListener('keydown', (event) => {
  const photo = photos[activeSide];
  if (!photo.image || photo.loading) return;
  const changes = { ArrowLeft: [-.05, 0], ArrowRight: [.05, 0], ArrowUp: [0, -.05], ArrowDown: [0, .05] };
  if (event.key in changes) {
    const [x, y] = changes[event.key];
    photo.panX = Math.max(-1, Math.min(1, photo.panX + x));
    photo.panY = Math.max(-1, Math.min(1, photo.panY + y));
  } else if (['+', '=', '-'].includes(event.key)) {
    photo.zoom = Math.max(1, Math.min(4, photo.zoom + (event.key === '-' ? -.05 : .05)));
    updateButtons();
  } else return;
  event.preventDefault();
  edited();
});

const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

// Keep a file dropped outside its upload box from opening over the editor.
document.addEventListener('dragover', (event) => {
  if (!isFileDrag(event) || event.defaultPrevented) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'none';
});
document.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  status('请把图片拖到素颜照片或精修照片的上传框内。', true);
});

photos.forEach((photo, side) => {
  const dropZone = $(`label[for="photo-${side}"]`);
  let dragDepth = 0;
  const clearDrag = () => {
    dragDepth = 0;
    dropZone.classList.remove('is-dragover');
  };
  dropZone.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) clearDrag();
  });
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDrag();
    const files = event.dataTransfer?.files;
    if (!files || files.length !== 1) {
      status(`请一次拖入一张${names[side]}，支持 JPG、PNG 或 WebP。`, true);
      return;
    }
    loadPhoto(files[0], side);
  });
  dropZone.addEventListener('dragend', clearDrag);
  window.addEventListener('blur', clearDrag);

  $(`#photo-${side}`).addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // The same file can be selected again.
    if (file) loadPhoto(file, side);
  });
  $(`input[name="active-side"][value="${side}"]`).addEventListener('change', () => selectSide(side));
  $(`#zoom-${side}`).addEventListener('input', (event) => {
    photo.zoom = Number(event.target.value);
    selectSide(side);
    updateButtons();
    edited();
  });
  $(`[data-reset="${side}"]`).addEventListener('click', () => {
    Object.assign(photo, { zoom: 1, panX: 0, panY: 0 });
    selectSide(side);
    updateButtons();
    edited();
  });
});
$('#split').addEventListener('input', (event) => setSplit(Number(event.target.value) / 100));
$('#equal-split').addEventListener('click', () => setSplit(.5));
$('#retry-template').addEventListener('click', loadTemplate);

async function exportPoster(format) {
  if (!ready() || exporting) return;
  exporting = true;
  const snapshot = revision;
  clearDownload();
  updateButtons();
  status(`正在生成 ${format.toUpperCase()} 原图…`);
  let canvas;
  try {
    canvas = document.createElement('canvas');
    canvas.width = POSTER.width;
    canvas.height = POSTER.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    paint(context, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成图片')), format === 'jpg' ? 'image/jpeg' : 'image/png', .95));
    if (snapshot !== revision || photos.some((photo) => photo.loading)) {
      status('照片或构图已更改，请重新导出。');
      return;
    }
    downloadURL = URL.createObjectURL(blob);
    const link = $('#download-link');
    link.href = downloadURL;
    const timestamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/\D/g, '');
    link.download = `南铂素人改造对比图-${timestamp.slice(0, 8)}-${timestamp.slice(8)}.${format}`;
    $('#open-image').href = downloadURL;
    $('#download-result').hidden = false;
    status('原图已生成。若未自动下载，请点击下方链接保存。');
    link.click();
  } catch {
    status('导出失败，可能是图片过大或浏览器内存不足。请重新尝试，或更换浏览器。', true);
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    exporting = false;
    updateButtons();
  }
}

$('#export-png').addEventListener('click', () => exportPoster('png'));
$('#export-jpg').addEventListener('click', () => exportPoster('jpg'));
window.addEventListener('pagehide', (event) => {
  // Preserve working download links on back-forward cache restores.
  if (!event.persisted) clearDownload();
});
renderSoon();
loadTemplate();

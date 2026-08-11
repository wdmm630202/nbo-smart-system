const categoryConfig = [
  { id: "all", label: "全部作品", description: "158 张精选样片" },
  { id: "business", label: "商务质感", description: "利落、稳重、有质感" },
  { id: "relaxed", label: "自然松弛", description: "清爽、自然、不用端着" },
  { id: "mood", label: "情绪光影", description: "克制、安静、有故事感" },
  { id: "creative", label: "创意主题", description: "鲜明、特别、有记忆点" },
];

// 每个数字代表原始双图系列，确保同一组照片归入同一种风格。
const categorySeries = {
  business: new Set([3, 9, 11, 17, 18, 20, 21, 26, 36, 38, 45, 50, 58, 69, 70]),
  relaxed: new Set([12, 16, 19, 22, 23, 25, 27, 28, 30, 31, 32, 33, 41, 53, 55, 61, 74, 76]),
  mood: new Set([6, 7, 13, 15, 29, 34, 35, 39, 42, 43, 44, 46, 47, 49, 54, 59, 68, 71, 73, 79]),
  creative: new Set([1, 2, 4, 5, 8, 10, 14, 24, 37, 40, 48, 51, 52, 56, 57, 60, 62, 63, 64, 65, 66, 67, 72, 75, 77, 78]),
};

const titleByCategory = Object.fromEntries(categoryConfig.map((item) => [item.id, item.label]));
const featuredIds = [137, 37, 115, 127, 111, 77, 107, 51, 81, 129, 11, 59, 93, 139, 147, 157, 45, 49, 73, 99, 21, 65, 85, 119, 13, 95, 105, 123, 143, 31];

function categoryForSeries(series) {
  return Object.entries(categorySeries).find(([, numbers]) => numbers.has(series))?.[0] || "creative";
}

function itemFromId(id) {
  const series = Math.ceil(id / 2);
  const category = categoryForSeries(series);
  const code = `NB-${String(id).padStart(3, "0")}`;
  return {
    id,
    code,
    series,
    category,
    title: titleByCategory[category],
    thumb: `../portfolio/assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
    full: `../portfolio/assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
  };
}

const remainingA = Array.from({ length: 79 }, (_, index) => index * 2 + 1).filter((id) => !featuredIds.includes(id));
const variantB = Array.from({ length: 79 }, (_, index) => index * 2 + 2);
const galleryItems = [...featuredIds, ...remainingA, ...variantB].map(itemFromId);
const itemById = new Map(galleryItems.map((item) => [item.id, item]));

const filters = document.querySelector("#filters");
const galleryGrid = document.querySelector("#gallery-grid");
const gallerySummary = document.querySelector("#gallery-summary");
const galleryProgress = document.querySelector("#gallery-progress");
const loadMoreButton = document.querySelector("#load-more");
const loadRemaining = document.querySelector("#load-remaining");
const viewer = document.querySelector("#viewer");
const viewerImage = document.querySelector("#viewer-image");
const viewerLoader = document.querySelector("#viewer-loader");
const viewerStage = document.querySelector("#viewer-stage");
const viewerCategory = document.querySelector("#viewer-category");
const viewerCode = document.querySelector("#viewer-code");
const viewerCount = document.querySelector("#viewer-count");
const viewerLike = document.querySelector("#viewer-like");
const selectionBar = document.querySelector("#selection-bar");
const selectionCount = document.querySelector("#selection-count");
const navFavoriteCount = document.querySelector("#nav-favorite-count");
const selectionSheet = document.querySelector("#selection-sheet");
const selectionCard = document.querySelector("#selection-card");
const selectionGenerating = document.querySelector("#selection-generating");
const selectedList = document.querySelector("#selected-list");
const selectionSummary = document.querySelector("#selection-summary");
const copyRequest = document.querySelector("#copy-request");
const settingsToggle = document.querySelector("#settings-toggle");
const briefSettingsPanel = document.querySelector("#brief-settings");
const customerNameInput = document.querySelector("#customer-name");
const additionalNoteInput = document.querySelector("#additional-note");
const focusInputs = [...document.querySelectorAll('input[name="brief-focus"]')];
const toast = document.querySelector("#toast");

const PAGE_SIZE = 30;
let activeCategory = "all";
let filteredItems = [...galleryItems];
let visibleCount = PAGE_SIZE;
let viewerIndex = 0;
let toastTimer;
let dragStartX = 0;
let dragStartY = 0;
let dragDeltaX = 0;
let dragDeltaY = 0;
let dragging = false;
let selectionCardBlob = null;
let selectionCardUrl = "";
let generationId = 0;
let settingsRefreshTimer;
let lastCopiedSignature = "";
let lastCopyMode = "";

function readBriefSettings() {
  const defaults = { name: "", focus: ["光线与色调", "妆发造型", "动作与构图"], note: "" };
  try {
    const stored = JSON.parse(localStorage.getItem("nanbo-brief-settings") || "null");
    if (!stored || typeof stored !== "object") return defaults;
    return {
      name: typeof stored.name === "string" ? stored.name.slice(0, 12) : "",
      focus: Array.isArray(stored.focus) ? stored.focus.filter((value) => defaults.focus.includes(value)) : defaults.focus,
      note: typeof stored.note === "string" ? stored.note.slice(0, 80) : "",
    };
  } catch {
    return defaults;
  }
}

let briefSettings = readBriefSettings();

function readFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem("nanbo-favorite-photos") || "[]");
    return new Set(stored.filter((id) => Number.isInteger(id) && itemById.has(id)));
  } catch {
    return new Set();
  }
}

const favoriteIds = readFavorites();
let primaryFavoriteId = Number(localStorage.getItem("nanbo-primary-favorite")) || 0;

function ensurePrimaryFavorite() {
  if (!favoriteIds.has(primaryFavoriteId)) primaryFavoriteId = [...favoriteIds][0] || 0;
  if (primaryFavoriteId) localStorage.setItem("nanbo-primary-favorite", String(primaryFavoriteId));
  else localStorage.removeItem("nanbo-primary-favorite");
}

function selectedItems() {
  ensurePrimaryFavorite();
  return [...favoriteIds]
    .sort((a, b) => Number(b === primaryFavoriteId) - Number(a === primaryFavoriteId))
    .map((id) => itemById.get(id))
    .filter(Boolean);
}

function briefSignature(items = selectedItems()) {
  return JSON.stringify({ ids: items.map((item) => item.id), primaryFavoriteId, ...briefSettings });
}

function hydrateSettingsForm() {
  customerNameInput.value = briefSettings.name;
  additionalNoteInput.value = briefSettings.note;
  focusInputs.forEach((input) => { input.checked = briefSettings.focus.includes(input.value); });
}

function resetCopyButton() {
  lastCopyMode = "";
  copyRequest.disabled = false;
  copyRequest.classList.remove("is-success");
  copyRequest.textContent = "复制图片＋文字";
}

function updateCopyButton() {
  const copied = lastCopiedSignature && lastCopiedSignature === briefSignature();
  copyRequest.disabled = Boolean(copied);
  copyRequest.classList.toggle("is-success", Boolean(copied));
  copyRequest.textContent = copied
    ? lastCopyMode === "text" ? "✓ 文字已复制，请长按保存需求图" : "✓ 图文已复制，可回微信粘贴"
    : "复制图片＋文字";
}

function saveBriefSettings() {
  briefSettings = {
    name: customerNameInput.value.trim().slice(0, 12),
    focus: focusInputs.filter((input) => input.checked).map((input) => input.value),
    note: additionalNoteInput.value.trim().slice(0, 80),
  };
  localStorage.setItem("nanbo-brief-settings", JSON.stringify(briefSettings));
  selectionCardBlob = null;
  lastCopiedSignature = "";
  resetCopyButton();
}

function scheduleSettingsRefresh() {
  saveBriefSettings();
  window.clearTimeout(settingsRefreshTimer);
  settingsRefreshTimer = window.setTimeout(() => {
    if (selectionSheet.open) renderSelectionSheet();
  }, 220);
}

function categoryCount(categoryId) {
  return categoryId === "all" ? galleryItems.length : galleryItems.filter((item) => item.category === categoryId).length;
}

function renderFilters() {
  filters.replaceChildren(...categoryConfig.map((category) => {
    const button = document.createElement("button");
    button.className = "filter-button";
    button.type = "button";
    button.dataset.category = category.id;
    button.setAttribute("aria-pressed", String(activeCategory === category.id));
    button.innerHTML = `${category.label}<span>${categoryCount(category.id)}</span>`;
    button.addEventListener("click", () => setCategory(category.id));
    return button;
  }));
}

function createCard(item, index) {
  const article = document.createElement("article");
  article.className = "gallery-card";

  const photoButton = document.createElement("button");
  photoButton.className = "photo-button";
  photoButton.type = "button";
  photoButton.setAttribute("aria-label", `查看${item.title}高清样片，编号${item.code}`);
  photoButton.addEventListener("click", () => openViewer(index));

  const image = document.createElement("img");
  image.alt = `${item.title}男士摄影样片，编号${item.code}`;
  image.width = 480;
  image.height = 640;
  image.loading = "lazy";
  image.decoding = "async";
  image.dataset.loading = "true";
  image.addEventListener("load", () => { image.dataset.loading = "false"; }, { once: true });
  image.addEventListener("error", () => {
    if (image.dataset.fallback !== "true") {
      image.dataset.fallback = "true";
      image.src = item.full;
    }
  });
  image.src = item.thumb;

  const code = document.createElement("span");
  code.className = "photo-code";
  code.textContent = item.code;
  photoButton.append(image, code);

  const likeButton = document.createElement("button");
  likeButton.className = "like-button";
  likeButton.type = "button";
  likeButton.dataset.favoriteId = String(item.id);
  likeButton.setAttribute("aria-label", `喜欢${item.code}`);
  likeButton.addEventListener("click", () => toggleFavorite(item.id));
  updateLikeButton(likeButton, item.id);

  article.append(photoButton, likeButton);
  return article;
}

function renderGallery() {
  const shownItems = filteredItems.slice(0, visibleCount);
  galleryGrid.replaceChildren(...shownItems.map(createCard));
  const category = categoryConfig.find((item) => item.id === activeCategory) || categoryConfig[0];
  gallerySummary.textContent = `${category.label} · ${category.description}`;
  galleryProgress.textContent = `显示 ${shownItems.length} / ${filteredItems.length}`;
  const remaining = Math.max(0, filteredItems.length - shownItems.length);
  loadRemaining.textContent = remaining ? `还有 ${remaining} 张` : "";
  loadMoreButton.hidden = remaining === 0;
}

function setCategory(categoryId) {
  activeCategory = categoryId;
  visibleCount = PAGE_SIZE;
  filteredItems = categoryId === "all" ? [...galleryItems] : galleryItems.filter((item) => item.category === categoryId);
  renderFilters();
  renderGallery();
}

function loadMore() {
  visibleCount = Math.min(visibleCount + PAGE_SIZE, filteredItems.length);
  renderGallery();
}

function updateLikeButton(button, id) {
  const selected = favoriteIds.has(id);
  button.setAttribute("aria-pressed", String(selected));
  button.textContent = selected ? "♥" : "♡";
  button.setAttribute("aria-label", `${selected ? "取消喜欢" : "喜欢"}${itemById.get(id)?.code || "这张照片"}`);
}

function updateSelectionUi() {
  ensurePrimaryFavorite();
  const count = favoriteIds.size;
  selectionCount.textContent = String(count);
  navFavoriteCount.textContent = String(count);
  navFavoriteCount.hidden = count === 0;
  selectionBar.hidden = count === 0;
  document.body.classList.toggle("has-selection", count > 0);
  document.querySelectorAll("[data-favorite-id]").forEach((button) => updateLikeButton(button, Number(button.dataset.favoriteId)));
  updateViewerLike();
  localStorage.setItem("nanbo-favorite-photos", JSON.stringify([...favoriteIds]));
}

function toggleFavorite(id) {
  const wasSelected = favoriteIds.has(id);
  if (wasSelected) favoriteIds.delete(id);
  else {
    favoriteIds.add(id);
    if (!primaryFavoriteId) primaryFavoriteId = id;
  }
  ensurePrimaryFavorite();
  lastCopiedSignature = "";
  resetCopyButton();
  navigator.vibrate?.(wasSelected ? 4 : 8);
  updateSelectionUi();
  showToast(wasSelected ? "已取消喜欢" : `已加入喜欢 · 共 ${favoriteIds.size} 张`);
  if (selectionSheet.open) renderSelectionSheet();
}

function setPrimaryFavorite(id) {
  if (!favoriteIds.has(id) || primaryFavoriteId === id) return;
  primaryFavoriteId = id;
  localStorage.setItem("nanbo-primary-favorite", String(id));
  selectionCardBlob = null;
  lastCopiedSignature = "";
  resetCopyButton();
  navigator.vibrate?.(8);
  renderSelectionSheet();
  showToast(`${itemById.get(id)?.code || "这张照片"} 已设为首选参考`);
}

function setViewer(index) {
  viewerIndex = (index + filteredItems.length) % filteredItems.length;
  const item = filteredItems[viewerIndex];
  viewerImage.dataset.loading = "true";
  viewerLoader.hidden = false;
  viewerLoader.textContent = "高清加载中";
  viewerImage.alt = `${item.title}高清样片，编号${item.code}`;
  viewerImage.src = item.full;
  viewerCategory.textContent = `${item.title} · NANBO PORTRAIT`;
  viewerCode.textContent = item.code;
  viewerCount.textContent = `${viewerIndex + 1} / ${filteredItems.length}`;
  updateViewerLike();
}

function updateViewerLike() {
  if (!filteredItems.length || !viewerLike) return;
  const item = filteredItems[viewerIndex];
  const selected = favoriteIds.has(item.id);
  viewerLike.classList.toggle("is-selected", selected);
  viewerLike.textContent = selected ? "♥ 已加入喜欢" : "♡ 加入喜欢";
}

function openViewer(index) {
  setViewer(index);
  if (!viewer.open) viewer.showModal();
  document.body.classList.add("viewer-open");
}

function closeViewer() {
  if (viewer.open) viewer.close();
  document.body.classList.remove("viewer-open");
}

function moveViewer(direction) {
  setViewer(viewerIndex + direction);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2300);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  if (successMessage) showToast(successMessage);
}

function requestText(items = selectedItems()) {
  const styles = [...new Set(items.map((item) => item.title))];
  const codes = items.map((item) => item.code).join("、");
  const lines = [
    briefSettings.name ? `你好，我是${briefSettings.name}，这是我喜欢的南铂客片方向：` : "你好，这是我喜欢的南铂客片方向：",
    `偏好风格：${styles.join("、")}`,
    `首选参考：${items[0].code} · ${items[0].title}`,
    `参考编号：${codes}`,
  ];
  if (briefSettings.focus.length) lines.push(`重点参考：${briefSettings.focus.join("、")}`);
  if (briefSettings.note) lines.push(`补充要求：${briefSettings.note}`);
  lines.push("请化妆师与摄影师结合我的个人条件参考。请以本人实际条件与现场沟通为准。");
  return lines.join("\n");
}

function renderSelectedList(items) {
  selectedList.replaceChildren(...items.map((item) => {
    const chip = document.createElement("div");
    chip.className = "selected-chip";
    chip.classList.toggle("is-primary", item.id === primaryFavoriteId);
    const choose = document.createElement("button");
    choose.className = "selected-chip-select";
    choose.type = "button";
    choose.setAttribute("aria-label", `${item.id === primaryFavoriteId ? "当前首选" : "设为首选"}${item.code}`);
    choose.addEventListener("click", () => setPrimaryFavorite(item.id));
    const image = document.createElement("img");
    image.src = item.thumb;
    image.alt = `${item.code} ${item.title}`;
    image.draggable = false;
    choose.append(image);
    if (item.id === primaryFavoriteId) {
      const primaryBadge = document.createElement("em");
      primaryBadge.textContent = "首选";
      choose.append(primaryBadge);
    }
    const label = document.createElement("span");
    label.className = "selected-chip-label";
    label.textContent = `${item.code} · ${item.title}`;
    const remove = document.createElement("button");
    remove.className = "selected-chip-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除${item.code}`);
    remove.addEventListener("click", () => toggleFavorite(item.id));
    chip.append(choose, label, remove);
    return chip;
  }));
}

function openSelectionSheet() {
  if (!favoriteIds.size) return;
  hydrateSettingsForm();
  briefSettingsPanel.hidden = true;
  settingsToggle.setAttribute("aria-expanded", "false");
  renderSelectionSheet();
  if (!selectionSheet.open) selectionSheet.showModal();
  document.body.classList.add("dialog-open");
}

function openFavoritesOrGuide() {
  if (favoriteIds.size) {
    openSelectionSheet();
    return;
  }
  showToast("先点照片右上角的爱心，再生成图文需求");
  document.querySelector("#works").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSelectionSheet() {
  if (selectionSheet.open) selectionSheet.close();
  document.body.classList.remove("dialog-open");
}

function renderSelectionSheet() {
  const items = selectedItems();
  if (!items.length) {
    closeSelectionSheet();
    return;
  }
  renderSelectedList(items);
  selectionSummary.textContent = requestText(items);
  updateCopyButton();
  generateSelectionCard(items);
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function drawImageCover(context, image, x, y, width, height) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  if (imageRatio > boxRatio) {
    sourceWidth = image.naturalHeight * boxRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / boxRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawImageCoverRounded(context, image, layout, radius = 18) {
  context.save();
  roundedRectPath(context, layout.x, layout.y, layout.width, layout.height, radius);
  context.clip();
  drawImageCover(context, image, layout.x, layout.y, layout.width, layout.height);
  context.restore();
}

function setFittedFont(context, text, maxWidth, startSize, minSize, weight = 600) {
  let size = startSize;
  do {
    context.font = `${weight} ${size}px -apple-system, "PingFang SC", sans-serif`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 1;
  } while (size > minSize);
  return size;
}

function photoLayouts(count) {
  if (count === 1) return [{ x: 170, y: 270, width: 740, height: 730, primary: true }];
  if (count === 2) return [60, 555].map((x, index) => ({ x, y: 280, width: 465, height: 700, primary: index === 0 }));
  if (count === 3) return [
    { x: 60, y: 280, width: 540, height: 720, primary: true },
    { x: 625, y: 280, width: 395, height: 345 },
    { x: 625, y: 655, width: 395, height: 345 },
  ];
  if (count === 4) return [
    { x: 60, y: 280, width: 465, height: 340, primary: true }, { x: 555, y: 280, width: 465, height: 340 },
    { x: 60, y: 650, width: 465, height: 350 }, { x: 555, y: 650, width: 465, height: 350 },
  ];
  return Array.from({ length: count }, (_, index) => ({
    x: 55 + (index % 3) * 325,
    y: 280 + Math.floor(index / 3) * 365,
    width: 310,
    height: 335,
    primary: index === 0,
  }));
}

async function generateSelectionCard(items) {
  const currentGeneration = ++generationId;
  selectionCardBlob = null;
  selectionGenerating.hidden = false;
  selectionCard.style.opacity = "0";
  const visibleItems = items.slice(0, 6);

  try {
    const images = await Promise.all(visibleItems.map((item) => imageFromUrl(item.thumb)));
    if (currentGeneration !== generationId) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    const context = canvas.getContext("2d");
    context.fillStyle = "#f3f0e9";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "#171714";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(92, 82, 31, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#171714";
    context.font = "italic 31px Georgia, serif";
    context.textAlign = "center";
    context.fillText("N", 92, 93);
    context.textAlign = "left";
    context.font = '650 25px -apple-system, "PingFang SC", sans-serif';
    context.fillText("南铂摄影", 145, 75);
    context.fillStyle = "#7a7770";
    context.font = '600 16px -apple-system, "PingFang SC", sans-serif';
    context.fillText("NANBO PORTRAIT", 145, 101);
    context.textAlign = "right";
    context.fillStyle = "#a27f48";
    context.font = '650 17px -apple-system, "PingFang SC", sans-serif';
    context.fillText("MY PORTRAIT BRIEF / 2026", 1020, 88);
    context.textAlign = "left";
    context.fillStyle = "#171714";
    context.font = '520 58px -apple-system, "PingFang SC", sans-serif';
    context.fillText("我喜欢的拍摄风格", 60, 185);
    context.font = '400 22px -apple-system, "PingFang SC", sans-serif';
    context.fillStyle = "#77756f";
    const customerPrefix = briefSettings.name ? `${briefSettings.name} · ` : "";
    context.fillText(`${customerPrefix}已选择 ${items.length} 张 · 首选 ${visibleItems[0].code} · 请化妆师与摄影师重点参考`, 60, 230);

    const layouts = photoLayouts(visibleItems.length);
    images.forEach((image, index) => {
      const layout = layouts[index];
      context.save();
      context.shadowColor = "rgba(30,27,20,.2)";
      context.shadowBlur = layout.primary ? 28 : 15;
      context.shadowOffsetY = layout.primary ? 12 : 7;
      context.fillStyle = "#fff";
      roundedRectPath(context, layout.x, layout.y, layout.width, layout.height, 18);
      context.fill();
      context.restore();
      drawImageCoverRounded(context, image, layout);

      context.save();
      roundedRectPath(context, layout.x, layout.y, layout.width, layout.height, 18);
      context.clip();
      const labelGradient = context.createLinearGradient(0, layout.y + layout.height - 100, 0, layout.y + layout.height);
      labelGradient.addColorStop(0, "rgba(0,0,0,0)");
      labelGradient.addColorStop(1, "rgba(0,0,0,.82)");
      context.fillStyle = labelGradient;
      context.fillRect(layout.x, layout.y + layout.height - 110, layout.width, 110);
      context.restore();

      if (layout.primary) {
        context.strokeStyle = "#b99459";
        context.lineWidth = 7;
        roundedRectPath(context, layout.x, layout.y, layout.width, layout.height, 18);
        context.stroke();
        context.fillStyle = "#b99459";
        roundedRectPath(context, layout.x + 16, layout.y + 16, 132, 40, 20);
        context.fill();
        context.fillStyle = "#171714";
        context.font = '700 18px -apple-system, "PingFang SC", sans-serif';
        context.fillText("首选参考  01", layout.x + 32, layout.y + 43);
      }

      context.fillStyle = "white";
      setFittedFont(context, `${visibleItems[index].code} · ${visibleItems[index].title}`, layout.width - 32, layout.primary ? 23 : 20, 15, 600);
      context.fillText(`${visibleItems[index].code} · ${visibleItems[index].title}`, layout.x + 16, layout.y + layout.height - 22);
    });

    const styles = [...new Set(items.map((item) => item.title))];
    context.fillStyle = "rgba(255,253,248,.96)";
    context.strokeStyle = "rgba(23,23,20,.12)";
    context.lineWidth = 2;
    roundedRectPath(context, 60, 1040, 960, 270, 24);
    context.fill();
    context.stroke();

    context.fillStyle = "rgba(162,127,72,.08)";
    context.font = "italic 240px Georgia, serif";
    context.fillText("01", 790, 1295);
    context.fillStyle = "#a27f48";
    context.font = '700 18px -apple-system, "PingFang SC", sans-serif';
    context.fillText(`首选参考  ${visibleItems[0].code} · ${visibleItems[0].title}`, 88, 1087);

    const stylesText = `偏好风格  ${styles.join(" · ")}`;
    context.fillStyle = "#171714";
    setFittedFont(context, stylesText, 850, 36, 27, 650);
    context.fillText(stylesText, 88, 1145);
    context.fillStyle = "#6e6c66";
    context.font = '450 22px -apple-system, "PingFang SC", sans-serif';
    const codes = items.map((item) => item.code).join("  ");
    context.fillText(`参考编号  ${codes.slice(0, 65)}${codes.length > 65 ? "…" : ""}`, 88, 1195);
    const focusText = briefSettings.focus.length ? briefSettings.focus.join("、") : "以上照片的整体感觉";
    context.fillText(`拍摄重点  ${focusText}${items.length > 6 ? `（另选 ${items.length - 6} 张）` : ""}`, 88, 1240);
    if (briefSettings.note) {
      context.fillStyle = "#4f4d47";
      setFittedFont(context, `补充要求  ${briefSettings.note.slice(0, 42)}`, 850, 22, 17, 500);
      context.fillText(`补充要求  ${briefSettings.note.slice(0, 42)}`, 88, 1282);
    }

    context.fillStyle = "#a27f48";
    context.fillRect(60, 1362, 960, 3);
    context.fillStyle = "#77756f";
    context.font = '500 18px -apple-system, "PingFang SC", sans-serif';
    context.fillText("南铂摄影 · 男士写真 · MY PORTRAIT BRIEF", 60, 1403);
    context.textAlign = "right";
    context.fillText("真实客片 · 结合本人条件与现场沟通调整", 1020, 1403);
    context.textAlign = "left";

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || currentGeneration !== generationId) return null;
    selectionCardBlob = blob;
    if (selectionCardUrl) URL.revokeObjectURL(selectionCardUrl);
    selectionCardUrl = URL.createObjectURL(blob);
    selectionCard.src = selectionCardUrl;
    selectionCard.style.opacity = "1";
    selectionCard.dataset.cardReady = "true";
    selectionGenerating.hidden = true;
    return blob;
  } catch {
    selectionGenerating.textContent = "需求图生成失败，请使用下方文字";
    return null;
  }
}

async function copyImageAndText() {
  const items = selectedItems();
  if (!items.length) return;
  if (lastCopiedSignature === briefSignature(items)) return;
  const text = requestText(items);
  const blob = selectionCardBlob || await generateSelectionCard(items);

  if (blob && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      const clipboardItem = new ClipboardItem({
        "image/png": blob,
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([clipboardItem]);
      lastCopiedSignature = briefSignature(items);
      lastCopyMode = "rich";
      updateCopyButton();
      navigator.vibrate?.(10);
      showToast("图片和文字已复制，回企业微信粘贴即可");
      return;
    } catch {
      // 企业微信内置浏览器可能限制图片剪贴板，下面自动复制文字。
    }
  }
  await copyText(text);
  lastCopiedSignature = briefSignature(items);
  lastCopyMode = "text";
  copyRequest.disabled = true;
  copyRequest.classList.add("is-success");
  copyRequest.textContent = "✓ 文字已复制，请长按保存需求图";
  showToast("文字已复制；长按上方需求图保存后一起发送");
}

viewerImage.addEventListener("load", () => {
  viewerImage.dataset.loading = "false";
  viewerLoader.hidden = true;
});

viewerImage.addEventListener("error", () => {
  viewerLoader.textContent = "图片暂时加载失败，请切换下一张";
});

viewerStage.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (event.target.closest("button")) return;
  dragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragDeltaX = 0;
  dragDeltaY = 0;
  viewerStage.setPointerCapture?.(event.pointerId);
});

viewerStage.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  dragDeltaX = event.clientX - dragStartX;
  dragDeltaY = event.clientY - dragStartY;
  viewerImage.style.transform = `translateX(${dragDeltaX * .55}px)`;
  viewerImage.style.opacity = String(Math.max(.55, 1 - Math.abs(dragDeltaX) / 500));
});

function finishDrag(event, cancelled = false) {
  if (!dragging) return;
  dragging = false;
  viewerStage.releasePointerCapture?.(event.pointerId);
  viewerImage.style.transform = "";
  viewerImage.style.opacity = "";
  if (cancelled) return;
  if (Math.abs(dragDeltaX) <= 10 && Math.abs(dragDeltaY) <= 10) {
    closeViewer();
    return;
  }
  if (Math.abs(dragDeltaX) > 55) moveViewer(dragDeltaX < 0 ? 1 : -1);
}

viewerStage.addEventListener("pointerup", finishDrag);
viewerStage.addEventListener("pointercancel", (event) => finishDrag(event, true));
document.querySelector("#viewer-close").addEventListener("click", closeViewer);
document.querySelector("#viewer-prev").addEventListener("click", () => moveViewer(-1));
document.querySelector("#viewer-next").addEventListener("click", () => moveViewer(1));
viewerLike.addEventListener("click", () => toggleFavorite(filteredItems[viewerIndex].id));
selectionBar.addEventListener("click", openSelectionSheet);
document.querySelector("#favorite-tab").addEventListener("click", openFavoritesOrGuide);
document.querySelector("#quick-favorites").addEventListener("click", openFavoritesOrGuide);
document.querySelectorAll("[data-category-link]").forEach((button) => {
  button.addEventListener("click", () => {
    setCategory(button.dataset.categoryLink);
    document.querySelector("#works").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
document.querySelector("#selection-close").addEventListener("click", closeSelectionSheet);
settingsToggle.addEventListener("click", () => {
  const willOpen = briefSettingsPanel.hidden;
  briefSettingsPanel.hidden = !willOpen;
  settingsToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) customerNameInput.focus({ preventScroll: true });
});
document.querySelector("#settings-done").addEventListener("click", () => {
  briefSettingsPanel.hidden = true;
  settingsToggle.setAttribute("aria-expanded", "false");
  settingsToggle.focus({ preventScroll: true });
});
customerNameInput.addEventListener("input", scheduleSettingsRefresh);
additionalNoteInput.addEventListener("input", scheduleSettingsRefresh);
focusInputs.forEach((input) => input.addEventListener("change", scheduleSettingsRefresh));
copyRequest.addEventListener("click", copyImageAndText);
document.querySelector("#clear-selection").addEventListener("click", () => {
  favoriteIds.clear();
  lastCopiedSignature = "";
  resetCopyButton();
  updateSelectionUi();
  closeSelectionSheet();
  showToast("已清空，可以重新选择");
});
selectionSheet.addEventListener("click", (event) => { if (event.target === selectionSheet) closeSelectionSheet(); });
selectionSheet.addEventListener("cancel", (event) => { event.preventDefault(); closeSelectionSheet(); });
loadMoreButton.addEventListener("click", loadMore);
viewer.addEventListener("click", (event) => { if (event.target === viewer) closeViewer(); });
viewer.addEventListener("cancel", (event) => { event.preventDefault(); closeViewer(); });
window.addEventListener("keydown", (event) => {
  if (!viewer.open) return;
  if (event.key === "ArrowLeft") moveViewer(-1);
  if (event.key === "ArrowRight") moveViewer(1);
  if (event.key === "Escape") closeViewer();
});

const tabTargets = ["top", "styles", "works", "prep"];
const tabObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === visible.target.id));
}, { rootMargin: "-20% 0px -65%", threshold: [0, .1, .4] });
tabTargets.forEach((id) => {
  const section = document.getElementById(id);
  if (section) tabObserver.observe(section);
});

document.querySelector("#year").textContent = new Date().getFullYear();
hydrateSettingsForm();
renderFilters();
renderGallery();
updateSelectionUi();

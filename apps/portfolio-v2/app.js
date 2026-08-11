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

function selectedItems() {
  return [...favoriteIds].map((id) => itemById.get(id)).filter(Boolean);
}

function briefSignature(items = selectedItems()) {
  return JSON.stringify({ ids: items.map((item) => item.id), ...briefSettings });
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
  else favoriteIds.add(id);
  lastCopiedSignature = "";
  resetCopyButton();
  navigator.vibrate?.(wasSelected ? 4 : 8);
  updateSelectionUi();
  showToast(wasSelected ? "已取消喜欢" : `已加入喜欢 · 共 ${favoriteIds.size} 张`);
  if (selectionSheet.open) renderSelectionSheet();
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
    const image = document.createElement("img");
    image.src = item.thumb;
    image.alt = `${item.code} ${item.title}`;
    const label = document.createElement("span");
    label.textContent = `${item.code} · ${item.title}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除${item.code}`);
    remove.addEventListener("click", () => toggleFavorite(item.id));
    chip.append(image, label, remove);
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

function photoLayouts(count) {
  if (count === 1) return [{ x: 210, y: 190, width: 660, height: 880 }];
  if (count === 2) return [65, 555].map((x) => ({ x, y: 235, width: 460, height: 613 }));
  if (count === 3) return [55, 375, 695].map((x) => ({ x, y: 255, width: 300, height: 400 }));
  if (count === 4) return [
    { x: 190, y: 180, width: 330, height: 440 }, { x: 560, y: 180, width: 330, height: 440 },
    { x: 190, y: 650, width: 330, height: 440 }, { x: 560, y: 650, width: 330, height: 440 },
  ];
  return Array.from({ length: count }, (_, index) => ({
    x: 55 + (index % 3) * 320,
    y: 190 + Math.floor(index / 3) * 425,
    width: 300,
    height: 400,
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
    context.fillStyle = "#f5f2eb";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(162,127,72,.055)";
    context.font = "italic 520px Georgia, serif";
    context.fillText("N", 690, 1415);
    context.fillStyle = "#a27f48";
    context.fillRect(55, 42, 4, 32);
    context.fillStyle = "#171714";
    context.font = '600 28px -apple-system, "PingFang SC", sans-serif';
    context.fillText("NANBO PORTRAIT", 76, 69);
    context.font = '500 56px -apple-system, "PingFang SC", sans-serif';
    context.fillText("我喜欢的拍摄风格", 55, 135);
    context.font = '400 24px -apple-system, "PingFang SC", sans-serif';
    context.fillStyle = "#77756f";
    const customerPrefix = briefSettings.name ? `${briefSettings.name} · ` : "";
    context.fillText(`${customerPrefix}已选择 ${items.length} 张参考照片 · 请化妆师与摄影师参考`, 55, 175);

    const layouts = photoLayouts(visibleItems.length);
    images.forEach((image, index) => {
      const layout = layouts[index];
      context.save();
      context.shadowColor = "rgba(35,29,20,.16)";
      context.shadowBlur = 18;
      context.shadowOffsetY = 7;
      drawImageCover(context, image, layout.x, layout.y, layout.width, layout.height);
      context.restore();
      context.fillStyle = "rgba(0,0,0,.56)";
      context.fillRect(layout.x, layout.y + layout.height - 48, layout.width, 48);
      context.fillStyle = "white";
      context.font = '500 21px Georgia, -apple-system, "PingFang SC", sans-serif';
      context.fillText(`${visibleItems[index].code} · ${visibleItems[index].title}`, layout.x + 14, layout.y + layout.height - 17);
    });

    const styles = [...new Set(items.map((item) => item.title))];
    const footerY = visibleItems.length === 4 ? 1140 : visibleItems.length <= 3 ? 1120 : 1095;
    context.fillStyle = "#171714";
    context.font = '600 26px -apple-system, "PingFang SC", sans-serif';
    context.fillText(`偏好风格：${styles.join(" · ")}`, 55, footerY);
    context.fillStyle = "#6e6c66";
    context.font = '400 21px -apple-system, "PingFang SC", sans-serif';
    const codes = items.map((item) => item.code).join("  ");
    context.fillText(`参考编号：${codes.slice(0, 74)}${codes.length > 74 ? "…" : ""}`, 55, footerY + 45);
    const focusText = briefSettings.focus.length ? briefSettings.focus.join("、") : "以上照片的整体感觉";
    context.fillText(`重点参考：${focusText}${items.length > 6 ? `（另选 ${items.length - 6} 张）` : ""}`, 55, footerY + 88);
    if (briefSettings.note) context.fillText(`补充要求：${briefSettings.note.slice(0, 42)}`, 55, footerY + 128);
    context.fillStyle = "#a27f48";
    context.fillRect(55, 1370, 970, 3);
    context.fillStyle = "#77756f";
    context.font = '500 18px -apple-system, "PingFang SC", sans-serif';
    context.fillText("南铂摄影 · 男士写真 · MY PORTRAIT BRIEF", 55, 1410);

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

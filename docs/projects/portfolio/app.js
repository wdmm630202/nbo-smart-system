const categoryConfig = [
  { id: "all", label: "全部作品", description: "158 张精选样片" },
  { id: "business", label: "商务质感", description: "利落、稳重、有质感" },
  { id: "relaxed", label: "日常松弛", description: "自然、清爽、不用端着" },
  { id: "mood", label: "情绪光影", description: "克制、安静、有故事感" },
  { id: "creative", label: "创意主题", description: "鲜明、特别、有记忆点" },
];

const categorySeries = {
  business: new Set([3, 4, 6, 9, 11, 17, 18, 20, 21, 26, 30, 36, 50, 58, 70, 73, 79]),
  relaxed: new Set([12, 19, 22, 23, 25, 27, 28, 29, 31, 32, 33, 34, 53, 55, 56, 57, 61, 69, 74, 76]),
  mood: new Set([1, 5, 7, 13, 15, 35, 39, 41, 42, 43, 44, 45, 46, 47, 49, 54, 59, 60, 68, 71]),
  creative: new Set([2, 8, 10, 14, 16, 24, 37, 38, 40, 48, 51, 52, 62, 63, 64, 65, 66, 67, 72, 75, 77, 78]),
};

const titleByCategory = Object.fromEntries(categoryConfig.map((item) => [item.id, item.label]));
const featuredIds = [31, 77, 127, 111, 37, 107, 51, 81, 129, 11, 59, 93, 115, 139, 147, 157, 45, 49, 73, 99, 21, 65, 85, 119, 137, 13, 95, 105, 123, 143];

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
    thumb: `assets/photos/thumbs/photo-${String(id).padStart(3, "0")}.webp`,
    full: `assets/photos/full/photo-${String(id).padStart(3, "0")}.jpg`,
  };
}

const remainingA = Array.from({ length: 79 }, (_, index) => index * 2 + 1).filter((id) => !featuredIds.includes(id));
const variantB = Array.from({ length: 79 }, (_, index) => index * 2 + 2);
const galleryItems = [...featuredIds, ...remainingA, ...variantB].map(itemFromId);

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
const toast = document.querySelector("#toast");

const PAGE_SIZE = 30;
let activeCategory = "all";
let filteredItems = [...galleryItems];
let visibleCount = PAGE_SIZE;
let viewerIndex = 0;
let toastTimer;
let dragStartX = 0;
let dragDeltaX = 0;
let dragging = false;

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

  const button = document.createElement("button");
  button.className = "photo-button";
  button.type = "button";
  button.setAttribute("aria-label", `查看${item.title}高清样片，编号${item.code}`);
  button.addEventListener("click", () => openViewer(index));

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
  button.append(image, code);
  article.append(button);
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

function setViewer(index) {
  viewerIndex = (index + filteredItems.length) % filteredItems.length;
  const item = filteredItems[viewerIndex];
  viewerImage.dataset.loading = "true";
  viewerLoader.hidden = false;
  viewerImage.alt = `${item.title}高清样片，编号${item.code}`;
  viewerImage.src = item.full;
  viewerCategory.textContent = `${item.title} · NANBO PORTRAIT`;
  viewerCode.textContent = item.code;
  viewerCount.textContent = `${viewerIndex + 1} / ${filteredItems.length}`;
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
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
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
  showToast(successMessage);
}

function copyCurrentPhoto() {
  const item = filteredItems[viewerIndex];
  copyText(`你好，我喜欢南铂客片 ${item.code} 这张的感觉，想参考这个方向拍。`, `已复制 ${item.code}，回微信粘贴即可`);
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
  dragging = true;
  dragStartX = event.clientX;
  dragDeltaX = 0;
  viewerStage.setPointerCapture?.(event.pointerId);
});

viewerStage.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  dragDeltaX = event.clientX - dragStartX;
  viewerImage.style.transform = `translateX(${dragDeltaX * .55}px)`;
  viewerImage.style.opacity = String(Math.max(.55, 1 - Math.abs(dragDeltaX) / 500));
});

function finishDrag(event) {
  if (!dragging) return;
  dragging = false;
  viewerStage.releasePointerCapture?.(event.pointerId);
  viewerImage.style.transform = "";
  viewerImage.style.opacity = "";
  if (Math.abs(dragDeltaX) > 55) moveViewer(dragDeltaX < 0 ? 1 : -1);
}

viewerStage.addEventListener("pointerup", finishDrag);
viewerStage.addEventListener("pointercancel", finishDrag);
document.querySelector("#viewer-close").addEventListener("click", closeViewer);
document.querySelector("#viewer-prev").addEventListener("click", () => moveViewer(-1));
document.querySelector("#viewer-next").addEventListener("click", () => moveViewer(1));
document.querySelector("#viewer-copy").addEventListener("click", copyCurrentPhoto);
document.querySelector("#copy-page-message").addEventListener("click", () => copyText("你好，我看了南铂摄影的客片，想咨询男士写真。我再把喜欢的照片编号发给你。", "咨询话术已复制，回微信粘贴即可"));
loadMoreButton.addEventListener("click", loadMore);
viewer.addEventListener("click", (event) => { if (event.target === viewer) closeViewer(); });
viewer.addEventListener("cancel", (event) => { event.preventDefault(); closeViewer(); });
window.addEventListener("keydown", (event) => {
  if (!viewer.open) return;
  if (event.key === "ArrowLeft") moveViewer(-1);
  if (event.key === "ArrowRight") moveViewer(1);
  if (event.key === "Escape") closeViewer();
});

document.querySelector("#year").textContent = new Date().getFullYear();
renderFilters();
renderGallery();

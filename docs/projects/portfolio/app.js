const categories = [
  { id: "all", label: "全部客片", hint: "先随便看看" },
  { id: "business", label: "商务西装", hint: "利落、稳重、有质感" },
  { id: "relaxed", label: "日常松弛", hint: "自然、轻松、不用端着" },
  { id: "mood", label: "情绪光影", hint: "克制、安静、有故事感" },
  { id: "profile", label: "个人形象", hint: "干净、可靠、适合展示自己" },
];

// 只需把真实照片按下列文件名放进 assets/photos 文件夹，不必修改这里。
const galleryItems = [
  { id: "NB-01", src: "assets/photos/photo-01.webp", fallback: "assets/photos/photo-01.jpg", category: "business", title: "商务西装" },
  { id: "NB-02", src: "assets/photos/photo-02.webp", fallback: "assets/photos/photo-02.jpg", category: "business", title: "商务西装" },
  { id: "NB-03", src: "assets/photos/photo-03.webp", fallback: "assets/photos/photo-03.jpg", category: "business", title: "商务西装" },
  { id: "NB-04", src: "assets/photos/photo-04.webp", fallback: "assets/photos/photo-04.jpg", category: "relaxed", title: "日常松弛" },
  { id: "NB-05", src: "assets/photos/photo-05.webp", fallback: "assets/photos/photo-05.jpg", category: "relaxed", title: "日常松弛" },
  { id: "NB-06", src: "assets/photos/photo-06.webp", fallback: "assets/photos/photo-06.jpg", category: "relaxed", title: "日常松弛" },
  { id: "NB-07", src: "assets/photos/photo-07.webp", fallback: "assets/photos/photo-07.jpg", category: "mood", title: "情绪光影" },
  { id: "NB-08", src: "assets/photos/photo-08.webp", fallback: "assets/photos/photo-08.jpg", category: "mood", title: "情绪光影" },
  { id: "NB-09", src: "assets/photos/photo-09.webp", fallback: "assets/photos/photo-09.jpg", category: "mood", title: "情绪光影" },
  { id: "NB-10", src: "assets/photos/photo-10.webp", fallback: "assets/photos/photo-10.jpg", category: "profile", title: "个人形象" },
  { id: "NB-11", src: "assets/photos/photo-11.webp", fallback: "assets/photos/photo-11.jpg", category: "profile", title: "个人形象" },
  { id: "NB-12", src: "assets/photos/photo-12.webp", fallback: "assets/photos/photo-12.jpg", category: "profile", title: "个人形象" },
];

const filters = document.querySelector("#filters");
const galleryGrid = document.querySelector("#gallery-grid");
const viewer = document.querySelector("#viewer");
const viewerImage = document.querySelector("#viewer-image");
const viewerTitle = document.querySelector("#viewer-title");
const viewerCount = document.querySelector("#viewer-count");
const viewerStage = document.querySelector("#viewer-stage");
const styleSheet = document.querySelector("#style-sheet");
const styleOptions = document.querySelector("#style-options");
const scrim = document.querySelector("#dialog-scrim");
const toast = document.querySelector("#toast");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let activeCategory = "all";
let visibleItems = [...galleryItems];
let viewerIndex = 0;
let toastTimer;
let dragStartX = 0;
let dragLastX = 0;
let dragStartTime = 0;
let isDragging = false;

function categoryById(id) {
  return categories.find((category) => category.id === id) || categories[0];
}

function placeholderFor(item) {
  const palettes = {
    business: ["#2c3033", "#9b8a70"],
    relaxed: ["#827c70", "#d0b98f"],
    mood: ["#272727", "#695d58"],
    profile: ["#526064", "#b4a68c"],
  };
  const [from, to] = palettes[item.category];
  const filename = item.src.split("/").pop();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${from}" />
          <stop offset="1" stop-color="${to}" />
        </linearGradient>
        <radialGradient id="r" cx="72%" cy="15%" r="72%">
          <stop stop-color="#fff" stop-opacity=".22" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#g)" />
      <rect width="900" height="1200" fill="url(#r)" />
      <circle cx="450" cy="430" r="132" fill="#fff" opacity=".08" />
      <path d="M245 950c18-215 93-330 205-330s187 115 205 330" fill="#fff" opacity=".08" />
      <line x1="90" y1="1050" x2="810" y2="1050" stroke="#fff" stroke-opacity=".22" />
      <text x="90" y="1104" fill="#fff" font-family="Arial, sans-serif" font-size="34" font-weight="700">${item.title}</text>
      <text x="810" y="1104" fill="#fff" fill-opacity=".68" text-anchor="end" font-family="Arial, sans-serif" font-size="24">请替换 ${filename}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function heroPlaceholder() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#222422" />
          <stop offset=".52" stop-color="#71695d" />
          <stop offset="1" stop-color="#b49c77" />
        </linearGradient>
        <radialGradient id="r" cx="78%" cy="12%" r="78%">
          <stop stop-color="#fff" stop-opacity=".28" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="1200" height="1600" fill="url(#g)" />
      <rect width="1200" height="1600" fill="url(#r)" />
      <path d="M780 0h420v1600H980z" fill="#fff" opacity=".06" />
      <circle cx="650" cy="520" r="170" fill="#fff" opacity=".075" />
      <path d="M330 1420c25-360 132-570 320-570s295 210 320 570" fill="#fff" opacity=".075" />
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function attachImageFallback(image, item) {
  const useFallback = () => {
    if (image.dataset.jpgFallback !== "true" && item.fallback) {
      image.dataset.jpgFallback = "true";
      image.src = item.fallback;
      return;
    }
    if (image.dataset.fallback === "true") return;
    image.dataset.fallback = "true";
    image.src = placeholderFor(item);
  };
  image.addEventListener("error", useFallback);
  if (image.complete && image.naturalWidth === 0) useFallback();
}

function attachHeroFallback(image, jpgFallback) {
  const useFallback = () => {
    if (image.dataset.jpgFallback !== "true") {
      image.dataset.jpgFallback = "true";
      image.src = jpgFallback;
      return;
    }
    if (image.dataset.fallback === "true") return;
    image.dataset.fallback = "true";
    image.src = heroPlaceholder();
  };
  image.addEventListener("error", useFallback);
  if (image.complete && image.naturalWidth === 0) useFallback();
}

function renderFilters() {
  filters.replaceChildren(
    ...categories.map((category) => {
      const button = document.createElement("button");
      button.className = "filter-button";
      button.type = "button";
      button.textContent = category.label;
      button.dataset.category = category.id;
      button.setAttribute("aria-pressed", String(activeCategory === category.id));
      button.addEventListener("click", () => setCategory(category.id));
      return button;
    }),
  );
}

function createGalleryCard(item, sourceIndex) {
  const article = document.createElement("article");
  article.className = "gallery-card";

  const photoButton = document.createElement("button");
  photoButton.className = "photo-button";
  photoButton.type = "button";
  photoButton.setAttribute("aria-label", `全屏查看${item.title}客片 ${item.id}`);
  photoButton.addEventListener("click", () => openViewer(sourceIndex));

  const image = document.createElement("img");
  image.src = item.src;
  image.alt = `${item.title}真实客片，编号${item.id}`;
  image.width = 1080;
  image.height = 1440;
  image.loading = sourceIndex < 2 ? "eager" : "lazy";
  image.decoding = "async";
  attachImageFallback(image, item);
  photoButton.append(image);

  const meta = document.createElement("div");
  meta.className = "photo-meta";
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = item.title;
  const id = document.createElement("span");
  id.textContent = item.id;
  text.append(title, id);

  const select = document.createElement("button");
  select.className = "select-photo";
  select.type = "button";
  select.textContent = "喜欢这张";
  select.addEventListener("click", () => copyPhotoMessage(item));
  meta.append(text, select);
  article.append(photoButton, meta);
  return article;
}

function renderGallery() {
  visibleItems =
    activeCategory === "all"
      ? [...galleryItems]
      : galleryItems.filter((item) => item.category === activeCategory);
  galleryGrid.replaceChildren(...visibleItems.map(createGalleryCard));
}

function setCategory(categoryId) {
  activeCategory = categoryId;
  renderFilters();
  renderGallery();
}

function setViewerContent(index) {
  viewerIndex = (index + visibleItems.length) % visibleItems.length;
  const item = visibleItems[viewerIndex];
  viewerImage.dataset.fallback = "false";
  viewerImage.dataset.jpgFallback = "false";
  viewerImage.src = item.src;
  viewerImage.alt = `${item.title}真实客片，编号${item.id}`;
  viewerTitle.textContent = `${item.title} · ${item.id}`;
  viewerCount.textContent = `${viewerIndex + 1} / ${visibleItems.length}`;
}

function openViewer(index) {
  setViewerContent(index);
  if (!viewer.open) viewer.showModal();
  document.body.style.overflow = "hidden";
}

function closeViewer() {
  if (viewer.open) viewer.close();
  document.body.style.overflow = "";
}

function moveViewer(direction) {
  if (visibleItems.length < 2) return;
  const nextIndex = viewerIndex + direction;
  if (prefersReducedMotion.matches || !viewerImage.animate) {
    setViewerContent(nextIndex);
    return;
  }

  const outX = direction > 0 ? "-16%" : "16%";
  const enterX = direction > 0 ? "16%" : "-16%";
  const outgoing = viewerImage.animate(
    [
      { transform: `translateX(${dragLastX || 0}px)`, opacity: 1 },
      { transform: `translateX(${outX})`, opacity: 0 },
    ],
    { duration: 170, easing: "ease-out", fill: "forwards" },
  );
  outgoing.finished.then(() => {
    setViewerContent(nextIndex);
    viewerImage.animate(
      [
        { transform: `translateX(${enterX})`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  });
}

function resetDraggedImage() {
  if (prefersReducedMotion.matches || !viewerImage.animate) {
    viewerImage.style.transform = "";
    viewerImage.style.opacity = "";
    return;
  }
  viewerImage
    .animate(
      [
        { transform: `translateX(${dragLastX}px)`, opacity: Math.max(0.65, 1 - Math.abs(dragLastX) / 900) },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
    )
    .finished.finally(() => {
      viewerImage.style.transform = "";
      viewerImage.style.opacity = "";
    });
}

function onDragStart(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  isDragging = true;
  dragStartX = event.clientX;
  dragLastX = 0;
  dragStartTime = performance.now();
  viewerStage.setPointerCapture(event.pointerId);
}

function onDragMove(event) {
  if (!isDragging) return;
  dragLastX = event.clientX - dragStartX;
  const resistance = 1 / (1 + Math.abs(dragLastX) / 1100);
  const translated = dragLastX * resistance;
  viewerImage.style.transform = `translateX(${translated}px)`;
  viewerImage.style.opacity = String(Math.max(0.65, 1 - Math.abs(translated) / 900));
}

function onDragEnd(event) {
  if (!isDragging) return;
  isDragging = false;
  const elapsed = Math.max(1, performance.now() - dragStartTime);
  const velocity = dragLastX / elapsed;
  viewerStage.releasePointerCapture?.(event.pointerId);
  viewerImage.style.transform = "";
  viewerImage.style.opacity = "";

  if (Math.abs(dragLastX) > 64 || Math.abs(velocity) > 0.45) {
    moveViewer(dragLastX < 0 ? 1 : -1);
  } else {
    resetDraggedImage();
  }
}

function openStyleSheet() {
  if (!styleSheet.open) styleSheet.showModal();
  scrim.classList.add("is-visible");
}

function closeStyleSheet() {
  if (styleSheet.open) styleSheet.close();
  scrim.classList.remove("is-visible");
}

function renderStyleOptions() {
  styleOptions.replaceChildren(
    ...categories.slice(1).map((category) => {
      const button = document.createElement("button");
      button.className = "style-option";
      button.type = "button";
      button.innerHTML = `<span><strong>${category.label}</strong><small>${category.hint}</small></span><em>复制话术</em>`;
      button.addEventListener("click", () => copyStyleMessage(category));
      return button;
    }),
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function copyStyleMessage(category) {
  await copyText(`你好，我看了客片，比较喜欢「${category.label}」这种感觉，想了解一下怎么拍～`);
  closeStyleSheet();
  showToast("已复制，返回微信粘贴给我就好");
}

async function copyPhotoMessage(item) {
  await copyText(`你好，我喜欢客片 ${item.id} 这张「${item.title}」的感觉，想参考这个方向拍～`);
  showToast(`已复制 ${item.id}，返回微信粘贴给我`);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

document.querySelector("#year").textContent = new Date().getFullYear();
document.querySelector("#style-cta").addEventListener("click", openStyleSheet);
document.querySelector("#sheet-close").addEventListener("click", closeStyleSheet);
document.querySelector("#viewer-close").addEventListener("click", closeViewer);
document.querySelector("#viewer-prev").addEventListener("click", () => moveViewer(-1));
document.querySelector("#viewer-next").addEventListener("click", () => moveViewer(1));
document.querySelector("#viewer-copy").addEventListener("click", () => copyPhotoMessage(visibleItems[viewerIndex]));
scrim.addEventListener("click", closeStyleSheet);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) closeViewer();
});
styleSheet.addEventListener("click", (event) => {
  if (event.target === styleSheet) closeStyleSheet();
});
document.addEventListener("keydown", (event) => {
  if (!viewer.open) return;
  if (event.key === "ArrowLeft") moveViewer(-1);
  if (event.key === "ArrowRight") moveViewer(1);
  if (event.key === "Escape") closeViewer();
});
viewerStage.addEventListener("pointerdown", onDragStart);
viewerStage.addEventListener("pointermove", onDragMove);
viewerStage.addEventListener("pointerup", onDragEnd);
viewerStage.addEventListener("pointercancel", onDragEnd);

attachHeroFallback(document.querySelector("#hero-image"), galleryItems[0].fallback);
viewerImage.addEventListener("error", () => {
  const item = visibleItems[viewerIndex];
  if (viewerImage.dataset.jpgFallback !== "true") {
    viewerImage.dataset.jpgFallback = "true";
    viewerImage.src = item.fallback;
    return;
  }
  if (viewerImage.dataset.fallback === "true") return;
  viewerImage.dataset.fallback = "true";
  viewerImage.src = placeholderFor(item);
});
renderFilters();
renderGallery();
renderStyleOptions();

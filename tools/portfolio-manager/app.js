const $ = (selector) => document.querySelector(selector);
const elements = {
  statusIndicator: $("#status-indicator"), statusTitle: $("#status-title"), statusDescription: $("#status-description"),
  dirtyCount: $("#dirty-count"), catalogCount: $("#catalog-count"), headVersion: $("#head-version"), branchName: $("#branch-name"),
  onlineLink: $("#online-link"), unrelatedWarning: $("#unrelated-warning"), unrelatedFiles: $("#unrelated-files"),
  previewButton: $("#preview-button"), publishButton: $("#publish-button"), sceneFilters: $("#scene-filters"),
  themeFilter: $("#theme-filter"), searchInput: $("#search-input"), dirtyOnly: $("#dirty-only"), photoGrid: $("#photo-grid"),
  resultCount: $("#result-count"), emptyState: $("#empty-state"), globalError: $("#global-error"), globalErrorMessage: $("#global-error-message"),
  photoDialog: $("#photo-dialog"), photoDialogTitle: $("#photo-dialog-title"), photoDialogMeta: $("#photo-dialog-meta"),
  photoDirtyBadge: $("#photo-dirty-badge"), currentPhoto: $("#current-photo"), currentPhotoLabel: $("#current-photo-label"),
  currentPhotoFallback: $("#current-photo-fallback"), photoFile: $("#photo-file"), candidatePhoto: $("#candidate-photo"),
  candidateDimensions: $("#candidate-dimensions"), dropZone: $("#drop-zone"), dropPrompt: $("#drop-prompt"),
  fileFeedback: $("#file-feedback"), replaceButton: $("#replace-button"), undoButton: $("#undo-button"),
  chooseAnotherButton: $("#choose-another-button"), publishDialog: $("#publish-dialog"), publishCount: $("#publish-count"),
  publishSlots: $("#publish-slots"), publishApproval: $("#publish-approval"), publishConfirm: $("#publish-confirm"),
  publishError: $("#publish-error"), deployPanel: $("#deploy-panel"), deployTitle: $("#deploy-title"),
  deployMessage: $("#deploy-message"), deploySteps: [...document.querySelectorAll("#deploy-steps li")],
  deployElapsed: $("#deploy-elapsed"), deployOnlineLink: $("#deploy-online-link"), toast: $("#toast"),
};

const state = {
  token: "", catalog: null, status: null, scene: "all", theme: "all", search: "", dirtyOnly: false,
  selectedId: 0, candidate: null, candidateUrl: "", candidateValid: false, candidateGeneration: 0,
  mutationBusy: false, toastTimer: 0, deployTimer: 0,
};

function setMutationBusy(busy) {
  state.mutationBusy = busy;
  elements.photoFile.disabled = busy;
  elements.undoButton.disabled = busy;
  elements.replaceButton.disabled = busy || !state.candidateValid;
  elements.chooseAnotherButton.disabled = busy;
  $("#photo-dialog-close").disabled = busy;
}

async function requestJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.method && options.method !== "GET") headers.set("X-Nanbo-Token", state.token);
  const response = await fetch(path, { cache: "no-store", ...options, headers });
  const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `操作失败（${response.status}）`);
  return payload;
}

function showToast(message, type = "") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast is-visible${type ? ` is-${type}` : ""}`;
  state.toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 3200);
}

function dirtySet() { return new Set(state.status?.dirtySlots || []); }

function showSkeletons() {
  elements.photoGrid.className = "photo-grid is-loading";
  elements.photoGrid.replaceChildren(...Array.from({ length: 18 }, () => {
    const item = document.createElement("div");
    item.className = "photo-skeleton";
    item.setAttribute("aria-hidden", "true");
    return item;
  }));
}

function updateStatusCard() {
  if (!state.status || !state.catalog) return;
  const pending = state.status.dirtySlots.length;
  const unrelated = state.status.unrelatedFiles || [];
  elements.statusIndicator.className = `status-indicator${pending ? " is-dirty" : ""}`;
  elements.statusTitle.textContent = pending ? `有 ${pending} 张客片等待同步` : "本地客片库已就绪";
  elements.statusDescription.textContent = pending ? "请先打开本地预览，确认无误后再同步。" : "现在可以选一张客片开始替换。";
  elements.dirtyCount.textContent = String(pending);
  elements.catalogCount.textContent = String(state.catalog.photoCount);
  elements.headVersion.textContent = state.status.head;
  elements.branchName.textContent = `${state.status.branch} 分支 · ${state.status.buildVersion}`;
  elements.onlineLink.href = state.catalog.onlineUrl;
  elements.onlineLink.hidden = false;
  elements.previewButton.disabled = false;
  elements.publishButton.disabled = pending === 0 || unrelated.length > 0 || state.status.branch !== "main";
  elements.unrelatedWarning.hidden = unrelated.length === 0;
  elements.unrelatedFiles.replaceChildren(...unrelated.slice(0, 8).map((path) => {
    const item = document.createElement("li"); item.textContent = path; return item;
  }));
}

function renderSceneFilters() {
  elements.sceneFilters.replaceChildren(...state.catalog.scenes.map((scene) => {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.scene = scene.id; button.textContent = scene.label;
    button.setAttribute("aria-pressed", String(state.scene === scene.id));
    return button;
  }));
}

function renderThemeOptions() {
  const themes = state.catalog.themes.filter((theme) => state.scene === "all" || theme.scene === state.scene);
  if (state.theme !== "all" && !themes.some((theme) => theme.id === state.theme)) state.theme = "all";
  elements.themeFilter.replaceChildren(
    new Option("全部主题", "all"),
    ...themes.map((theme) => new Option(`${theme.label} · ${theme.count}`, theme.id)),
  );
  elements.themeFilter.value = state.theme;
}

function filteredItems() {
  const query = state.search.trim().toLowerCase().replace(/\s+/g, "");
  const dirty = dirtySet();
  return state.catalog.items.filter((item) => {
    if (state.scene !== "all" && item.scene !== state.scene) return false;
    if (state.theme !== "all" && item.theme !== state.theme) return false;
    if (state.dirtyOnly && !dirty.has(item.id)) return false;
    if (!query) return true;
    return `${item.code}${item.title}${item.sceneTitle}${item.styleTitle}${String(item.id).padStart(3, "0")}`
      .toLowerCase().replace(/\s+/g, "").includes(query);
  });
}

function photoCard(item, dirty) {
  const button = document.createElement("button");
  button.type = "button"; button.className = `photo-card${dirty ? " is-dirty" : ""}`; button.dataset.id = String(item.id);
  button.setAttribute("aria-label", `${item.code} ${item.title}，点开查看或替换`);
  const imageWrap = document.createElement("span"); imageWrap.className = "photo-card-image";
  const image = document.createElement("img"); image.src = item.thumbUrl; image.alt = `${item.title}男士写真 ${item.code}`; image.loading = "lazy";
  image.addEventListener("error", () => image.classList.add("is-error")); imageWrap.append(image);
  if (dirty || item.isHeroAsset) {
    const badge = document.createElement("span"); badge.className = "photo-badge"; badge.textContent = dirty ? "待同步" : "首页图"; imageWrap.append(badge);
  }
  const code = document.createElement("span"); code.className = "photo-code-overlay"; code.textContent = item.code; imageWrap.append(code);
  const copy = document.createElement("span"); copy.className = "photo-card-copy";
  const title = document.createElement("strong"); title.textContent = item.title;
  const meta = document.createElement("span"); meta.textContent = `${item.sceneTitle} · ${item.styleTitle}`; copy.append(title, meta);
  button.append(imageWrap, copy); return button;
}

function renderGrid() {
  const items = filteredItems(); const dirty = dirtySet();
  elements.photoGrid.className = "photo-grid"; elements.photoGrid.setAttribute("aria-busy", "false");
  elements.photoGrid.replaceChildren(...items.map((item) => photoCard(item, dirty.has(item.id))));
  elements.resultCount.textContent = `${items.length} / ${state.catalog.photoCount}`;
  elements.emptyState.hidden = items.length > 0;
}

function revokeCandidateUrl() { if (state.candidateUrl) URL.revokeObjectURL(state.candidateUrl); state.candidateUrl = ""; }
function setFileFeedback(message, type = "") {
  elements.fileFeedback.className = `file-feedback${type ? ` is-${type}` : ""}`;
  elements.fileFeedback.querySelector("p").textContent = message;
}
function resetCandidate() {
  state.candidateGeneration += 1; revokeCandidateUrl(); state.candidate = null; state.candidateValid = false; elements.photoFile.value = "";
  elements.candidatePhoto.hidden = true; elements.candidatePhoto.removeAttribute("src"); elements.dropPrompt.hidden = false;
  elements.dropZone.classList.remove("has-photo", "is-dragging"); elements.candidateDimensions.textContent = "还未选择";
  elements.replaceButton.disabled = true; elements.chooseAnotherButton.hidden = true;
  setFileFeedback("换图只改这个编号，不会改主题、顺序或其他客片。");
}
function closeDialog(dialog) {
  if (dialog === elements.photoDialog && state.mutationBusy) return;
  if (dialog.open) dialog.close();
}

function openPhotoDialog(id) {
  const item = state.catalog.items.find((photo) => photo.id === id); if (!item) return;
  state.selectedId = id; resetCandidate();
  elements.photoDialogTitle.textContent = `${item.code} · ${item.title}`;
  elements.photoDialogMeta.textContent = `${item.sceneTitle} / ${item.styleTitle}${item.isHeroAsset ? " / 首页图" : ""}`;
  elements.currentPhotoLabel.textContent = `${item.code} · 1080×1440`;
  elements.currentPhoto.src = `${item.fullUrl}&open=${Date.now()}`; elements.currentPhoto.alt = `${item.code} ${item.title}当前客片`;
  elements.currentPhoto.hidden = false; elements.currentPhotoFallback.hidden = true;
  const dirty = dirtySet().has(id); elements.photoDirtyBadge.hidden = !dirty; elements.undoButton.hidden = !dirty;
  elements.photoDialog.showModal();
}

function acceptCandidate(file) {
  if (state.mutationBusy) return;
  resetCandidate();
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setFileFeedback("只支持 JPG、PNG 或 WebP 图片", "error"); return; }
  if (file.size > 50 * 1024 * 1024) { setFileFeedback("图片超过 50 MB，请先导出精修 JPG", "error"); return; }
  const generation = state.candidateGeneration;
  const objectUrl = URL.createObjectURL(file); const probe = new Image();
  probe.onload = () => {
    if (generation !== state.candidateGeneration) { URL.revokeObjectURL(objectUrl); return; }
    const { naturalWidth: width, naturalHeight: height } = probe;
    const ratioOkay = Math.abs(width / height - 0.75) <= 0.005; const sizeOkay = width >= 900 && height >= 1200;
    revokeCandidateUrl(); state.candidateUrl = objectUrl; state.candidate = file; state.candidateValid = ratioOkay && sizeOkay;
    elements.candidatePhoto.src = objectUrl; elements.candidatePhoto.hidden = false; elements.dropPrompt.hidden = true; elements.dropZone.classList.add("has-photo");
    elements.candidateDimensions.textContent = `${width}×${height} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    elements.chooseAnotherButton.hidden = false; elements.replaceButton.disabled = !state.candidateValid;
    if (!sizeOkay) setFileFeedback(`图片只有 ${width}×${height}，请使用至少 900×1200 的精修图。`, "error");
    else if (!ratioOkay) setFileFeedback(`当前比例是 ${width}:${height}，请先裁成 3:4，系统不会自动裁掉人物。`, "error");
    else setFileFeedback("尺寸和比例正常。确认人物、精修和发布授权后可以替换。", "success");
  };
  probe.onerror = () => { URL.revokeObjectURL(objectUrl); if (generation === state.candidateGeneration) setFileFeedback("这张图片无法读取，请重新导出 JPG。", "error"); };
  probe.src = objectUrl;
}

async function refreshData() {
  const [catalog, status] = await Promise.all([requestJson("/api/catalog"), requestJson("/api/status")]);
  state.catalog = catalog; state.status = status; updateStatusCard(); renderThemeOptions(); renderSceneFilters(); renderGrid();
}

async function replaceSelectedPhoto() {
  if (state.mutationBusy || !state.candidate || !state.candidateValid || !state.selectedId) return;
  const id = state.selectedId;
  const candidate = state.candidate;
  setMutationBusy(true);
  setFileFeedback("正在生成高清图、缩略图和本地备份…", "working");
  try {
    await requestJson(`/api/replace?id=${id}`, {
      method: "POST", headers: { "Content-Type": candidate.type, "X-File-Name": encodeURIComponent(candidate.name) }, body: candidate,
    });
    await refreshData(); setMutationBusy(false); closeDialog(elements.photoDialog); resetCandidate();
    showToast(`NB-${String(id).padStart(3, "0")} 已在本地替换，请先预览`, "success");
  } catch (error) { setFileFeedback(error.message, "error"); }
  finally { setMutationBusy(false); }
}

async function undoSelectedPhoto() {
  if (state.mutationBusy) return;
  const id = state.selectedId;
  const code = `NB-${String(id).padStart(3, "0")}`;
  if (!confirm(`恢复 ${code} 换图前的版本？`)) return;
  setMutationBusy(true);
  try {
    await requestJson(`/api/undo?id=${id}`, { method: "POST" });
    await refreshData(); setMutationBusy(false); closeDialog(elements.photoDialog); showToast(`${code} 已恢复旧图`, "success");
  }
  catch (error) { showToast(error.message, "error"); }
  finally { setMutationBusy(false); }
}

function openPreview() { if (state.catalog) window.open(`/preview/?v=${encodeURIComponent(state.catalog.version)}`, "_blank", "noopener,noreferrer"); }
function openPublishDialog() {
  const slots = state.status?.dirtySlots || []; if (!slots.length) return;
  elements.publishCount.textContent = String(slots.length); elements.publishSlots.textContent = slots.map((id) => `NB-${String(id).padStart(3, "0")}`).join("、");
  elements.publishApproval.checked = false; elements.publishConfirm.disabled = true; elements.publishError.hidden = true; elements.publishDialog.showModal();
}
function setDeploySteps(states) {
  elements.deploySteps.forEach((step) => { step.classList.remove("is-active", "is-complete", "is-error"); if (states[step.dataset.step]) step.classList.add(`is-${states[step.dataset.step]}`); });
}

async function waitForDeployment(version, onlineUrl) {
  const startedAt = Date.now(); setDeploySteps({ prepare: "complete", deploy: "active" });
  elements.deployTitle.textContent = "GitHub 已接收"; elements.deployMessage.textContent = "正在等待 GitHub Pages 发布新版本…";
  clearInterval(state.deployTimer); state.deployTimer = setInterval(() => { elements.deployElapsed.textContent = `已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒`; }, 1000);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt ? 7500 : 3500));
    try {
      const result = await requestJson(`/api/deploy-status?version=${encodeURIComponent(version)}`); if (!result.ready) continue;
      clearInterval(state.deployTimer); elements.deployElapsed.textContent = "已完成"; elements.deployTitle.textContent = "网站已同步";
      elements.deployMessage.textContent = "线上资源版本与本地一致，可以打开查看。";
      setDeploySteps({ prepare: "complete", deploy: "complete", verify: "complete" }); elements.deployOnlineLink.href = result.onlineUrl || onlineUrl; elements.deployOnlineLink.hidden = false;
      await refreshData(); showToast("南铂客片网站已上线", "success"); return;
    } catch { /* 部署期间暂时读不到 build.json 属正常等待。 */ }
  }
  clearInterval(state.deployTimer); elements.deployTitle.textContent = "GitHub 仍在发布";
  elements.deployMessage.textContent = "照片已推送，但等待超过 5 分钟。可稍后打开线上网站查看。";
  elements.deployOnlineLink.href = onlineUrl; elements.deployOnlineLink.hidden = false;
}

async function publishPhotos() {
  elements.publishConfirm.disabled = true; elements.publishError.hidden = true; elements.publishConfirm.textContent = "正在检查并推送…";
  try {
    const result = await requestJson("/api/publish", { method: "POST" }); closeDialog(elements.publishDialog);
    elements.deployPanel.hidden = false; elements.deployOnlineLink.hidden = true; elements.deployPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    if (result.noChanges) { elements.deployTitle.textContent = "无需同步"; elements.deployMessage.textContent = result.message; setDeploySteps({ prepare: "complete", deploy: "complete", verify: "complete" }); await refreshData(); return; }
    await waitForDeployment(result.version, result.onlineUrl);
  } catch (error) { elements.publishError.textContent = error.message; elements.publishError.hidden = false; elements.publishConfirm.disabled = false; }
  finally { elements.publishConfirm.textContent = "确认同步到网站"; }
}

async function initialize() {
  showSkeletons();
  try { const session = await requestJson("/api/session"); state.token = session.token; await refreshData(); elements.globalError.hidden = true; }
  catch (error) {
    elements.statusIndicator.className = "status-indicator is-error"; elements.statusTitle.textContent = "本地管理台连接失败"; elements.statusDescription.textContent = error.message;
    elements.globalErrorMessage.textContent = error.message; elements.globalError.hidden = false; elements.photoGrid.className = "photo-grid"; elements.photoGrid.replaceChildren();
  }
}

elements.sceneFilters.addEventListener("click", (event) => { const button = event.target.closest("button[data-scene]"); if (!button) return; state.scene = button.dataset.scene; renderSceneFilters(); renderThemeOptions(); renderGrid(); });
$("#filters").addEventListener("submit", (event) => event.preventDefault());
elements.themeFilter.addEventListener("change", () => { state.theme = elements.themeFilter.value; renderGrid(); });
elements.searchInput.addEventListener("input", () => { state.search = elements.searchInput.value; renderGrid(); });
elements.dirtyOnly.addEventListener("change", () => { state.dirtyOnly = elements.dirtyOnly.checked; renderGrid(); });
elements.photoGrid.addEventListener("click", (event) => {
  if (state.mutationBusy) return;
  const card = event.target.closest("button[data-id]"); if (card) openPhotoDialog(Number(card.dataset.id));
});
elements.currentPhoto.addEventListener("error", () => { elements.currentPhoto.hidden = true; elements.currentPhotoFallback.hidden = false; });
elements.photoFile.addEventListener("change", () => { if (elements.photoFile.files?.[0]) acceptCandidate(elements.photoFile.files[0]); });
elements.dropZone.addEventListener("dragover", (event) => { event.preventDefault(); if (!state.mutationBusy) elements.dropZone.classList.add("is-dragging"); });
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
elements.dropZone.addEventListener("drop", (event) => { event.preventDefault(); elements.dropZone.classList.remove("is-dragging"); if (!state.mutationBusy && event.dataTransfer?.files?.[0]) acceptCandidate(event.dataTransfer.files[0]); });
elements.previewButton.addEventListener("click", openPreview); $("#confirm-preview-button").addEventListener("click", openPreview);
elements.publishButton.addEventListener("click", openPublishDialog); elements.publishApproval.addEventListener("change", () => { elements.publishConfirm.disabled = !elements.publishApproval.checked; });
elements.publishConfirm.addEventListener("click", publishPhotos); elements.replaceButton.addEventListener("click", replaceSelectedPhoto); elements.undoButton.addEventListener("click", undoSelectedPhoto);
elements.chooseAnotherButton.addEventListener("click", () => { if (!state.mutationBusy) elements.photoFile.click(); }); $("#photo-dialog-close").addEventListener("click", () => closeDialog(elements.photoDialog));
$("#publish-dialog-close").addEventListener("click", () => closeDialog(elements.publishDialog)); $("#publish-cancel").addEventListener("click", () => closeDialog(elements.publishDialog));
$("#retry-button").addEventListener("click", initialize); $("#clear-filters").addEventListener("click", () => {
  state.scene = "all"; state.theme = "all"; state.search = ""; state.dirtyOnly = false; elements.searchInput.value = ""; elements.dirtyOnly.checked = false;
  renderSceneFilters(); renderThemeOptions(); renderGrid();
});
[elements.photoDialog, elements.publishDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(dialog); }));
elements.photoDialog.addEventListener("cancel", (event) => { if (state.mutationBusy) event.preventDefault(); });

initialize();

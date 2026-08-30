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
  addPhotoButton: $("#add-photo-button"), libraryMode: $("#library-mode"), libraryDescription: $("#library-description"),
  publicLibraryView: $("#public-library-view"), draftLibraryView: $("#draft-library-view"), draftUploadPanel: $("#draft-upload-panel"),
  draftUpload: $("#draft-upload"), uploadResults: $("#upload-results"), draftStatusFilter: $("#draft-status-filter"),
  draftCount: $("#draft-count"), draftGrid: $("#draft-grid"), draftEmpty: $("#draft-empty"), draftMetadata: $("#draft-metadata"),
  draftMetadataForm: $("#draft-metadata-form"), draftPreview: $("#draft-preview"), draftStatusBadge: $("#draft-status-badge"),
  draftMetadataTitle: $("#draft-metadata-title"), draftMetadataNote: $("#draft-metadata-note"), draftScene: $("#draft-scene"),
  draftTheme: $("#draft-theme"), draftCategory: $("#draft-category"), publicConsent: $("#public-consent"),
  homepageFeatured: $("#homepage-featured"), draftFeedback: $("#draft-feedback"), archiveDraftButton: $("#archive-draft-button"),
  restoreDraftButton: $("#restore-draft-button"), saveDraftButton: $("#save-draft-button"), readyDraftButton: $("#ready-draft-button"),
  stageDraftButton: $("#stage-draft-button"), newThemeButton: $("#new-theme-button"), newThemeForm: $("#new-theme-form"),
  newThemeId: $("#new-theme-id"), newThemeLabel: $("#new-theme-label"), newThemeScene: $("#new-theme-scene"),
  newThemeDescription: $("#new-theme-description"), newThemeFeedback: $("#new-theme-feedback"), saveThemeButton: $("#save-theme-button"),
};

const state = {
  token: "", catalog: null, status: null, scene: "all", theme: "all", search: "", dirtyOnly: false,
  selectedId: 0, candidate: null, candidateUrl: "", candidateValid: false, candidateGeneration: 0,
  mutationBusy: false, draftBusy: false, libraryMode: "public", draftStatus: "all", selectedDraftId: 0,
  toastTimer: 0, deployTimer: 0,
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

const draftStatusCopy = {
  draft: { label: "草稿", note: "仅本机可见，完成分类和授权后才能准备公开。" },
  ready: { label: "待公开", note: "已完成分类与授权，可加入本地网站预览。" },
  published: { label: "已公开", note: "已同步到网站，需要下线时可安全归档。" },
  archived: { label: "已归档", note: "编号和本地资产已保留，可随时恢复。" },
};

function draftCode(id) { return `NB-${String(id).padStart(3, "0")}`; }

function setDraftBusy(busy) {
  state.draftBusy = busy;
  for (const control of [
    elements.addPhotoButton, elements.draftUpload, elements.draftScene, elements.draftTheme, elements.draftCategory,
    elements.publicConsent, elements.homepageFeatured, elements.archiveDraftButton,
    elements.restoreDraftButton, elements.saveDraftButton, elements.readyDraftButton,
    elements.stageDraftButton, elements.saveThemeButton,
  ]) {
    if (control) control.disabled = busy || control.dataset.readonly === "true";
  }
  updateDraftReadiness();
}

function setDraftFeedback(message = "", type = "") {
  elements.draftFeedback.textContent = message;
  elements.draftFeedback.className = `inline-feedback${type ? ` is-${type}` : ""}`;
}

function selectedDraft() {
  return state.catalog?.drafts.find(({ id }) => id === state.selectedDraftId) || null;
}

function draftMetadataValid() {
  return Boolean(elements.draftScene.value
    && elements.draftTheme.value
    && elements.draftCategory.value
    && elements.publicConsent.checked);
}

function updateDraftReadiness() {
  const draft = selectedDraft();
  const editable = draft?.status === "draft" && !state.draftBusy;
  elements.readyDraftButton.disabled = !editable || !draftMetadataValid();
  elements.saveDraftButton.disabled = !editable;
}

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
  elements.catalogCount.textContent = String(state.catalog.items.length);
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
  elements.resultCount.textContent = `${items.length} / ${state.catalog.items.length}`;
  elements.emptyState.hidden = items.length > 0;
}

function setLibraryMode(mode, { focusUpload = false } = {}) {
  state.libraryMode = mode === "drafts" ? "drafts" : "public";
  for (const input of elements.libraryMode.querySelectorAll('input[name="library-mode"]')) {
    input.checked = input.value === state.libraryMode;
  }
  const showingDrafts = state.libraryMode === "drafts";
  elements.publicLibraryView.hidden = showingDrafts;
  elements.draftLibraryView.hidden = !showingDrafts;
  elements.libraryDescription.textContent = showingDrafts
    ? "草稿只保存在本机，可按状态整理、授权和准备公开。"
    : "查看已公开客片，或切换到仅本机可见的草稿。";
  if (state.catalog) {
    elements.resultCount.textContent = showingDrafts
      ? String(filteredDrafts().length)
      : `${filteredItems().length} / ${state.catalog.items.length}`;
  }
  if (showingDrafts && focusUpload) elements.draftUploadPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderDraftClassificationOptions() {
  const sceneValue = elements.draftScene.value;
  const themeValue = elements.draftTheme.value;
  const newThemeSceneValue = elements.newThemeScene.value;
  const scenes = state.catalog.scenes.filter(({ id }) => id !== "all");
  elements.draftScene.replaceChildren(
    new Option("请选择场景", ""),
    ...scenes.map(({ id, label }) => new Option(label, id)),
  );
  elements.draftScene.value = scenes.some(({ id }) => id === sceneValue) ? sceneValue : "";
  const matchingThemes = state.catalog.themes.filter(({ scene }) => !elements.draftScene.value || scene === elements.draftScene.value);
  elements.draftTheme.replaceChildren(
    new Option("请选择主题", ""),
    ...matchingThemes.map(({ id, label }) => new Option(label, id)),
  );
  elements.draftTheme.value = matchingThemes.some(({ id }) => id === themeValue) ? themeValue : "";
  elements.newThemeScene.replaceChildren(...scenes.map(({ id, label }) => new Option(label, id)));
  elements.newThemeScene.value = scenes.some(({ id }) => id === newThemeSceneValue)
    ? newThemeSceneValue
    : (elements.draftScene.value || scenes[0]?.id || "");
}

function filteredDrafts() {
  const drafts = state.catalog?.drafts || [];
  return state.draftStatus === "all" ? drafts : drafts.filter(({ status }) => status === state.draftStatus);
}

function draftCard(draft) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `draft-card${draft.id === state.selectedDraftId ? " is-selected" : ""}`;
  button.dataset.draftId = String(draft.id);
  button.setAttribute("aria-label", `${draftCode(draft.id)}，${draftStatusCopy[draft.status]?.label || draft.status}，打开草稿编辑`);
  const image = document.createElement("img");
  image.src = draft.thumbUrl;
  image.alt = `${draftCode(draft.id)} 本地草稿`;
  image.loading = "lazy";
  const copy = document.createElement("span");
  copy.className = "draft-card-copy";
  const heading = document.createElement("span");
  const code = document.createElement("strong");
  code.textContent = draftCode(draft.id);
  const badge = document.createElement("span");
  badge.className = `draft-status-badge is-${draft.status}`;
  badge.textContent = draftStatusCopy[draft.status]?.label || draft.status;
  heading.append(code, badge);
  const meta = document.createElement("small");
  const theme = state.catalog.themes.find(({ id }) => id === draft.theme)?.label;
  meta.textContent = [theme, draft.category ? "已分类" : "待分类"].filter(Boolean).join(" · ");
  copy.append(heading, meta);
  button.append(image, copy);
  return button;
}

function renderDrafts() {
  const drafts = filteredDrafts();
  elements.draftGrid.replaceChildren(...drafts.map(draftCard));
  elements.draftEmpty.hidden = drafts.length > 0;
  elements.draftCount.textContent = `${drafts.length} 张`;
  if (state.libraryMode === "drafts") elements.resultCount.textContent = String(drafts.length);
  if (state.selectedDraftId && !state.catalog.drafts.some(({ id }) => id === state.selectedDraftId)) {
    state.selectedDraftId = 0;
    elements.draftMetadata.hidden = true;
  }
}

function setDraftEditorControls(draft) {
  const editable = draft.status === "draft";
  for (const control of [elements.draftScene, elements.draftTheme, elements.draftCategory, elements.publicConsent, elements.homepageFeatured]) {
    control.disabled = !editable;
    control.dataset.readonly = String(!editable);
  }
  elements.saveDraftButton.hidden = !editable;
  elements.readyDraftButton.hidden = !editable;
  elements.archiveDraftButton.hidden = draft.status === "archived";
  elements.restoreDraftButton.hidden = draft.status !== "archived" && draft.status !== "ready";
  elements.restoreDraftButton.textContent = draft.status === "ready" ? "返回草稿编辑" : "恢复草稿";
  elements.stageDraftButton.hidden = draft.status !== "ready" || Boolean(draft.stagedAt);
  elements.archiveDraftButton.textContent = draft.status === "published" || draft.stagedAt ? "从网站隐藏" : "归档草稿";
  updateDraftReadiness();
}

function openDraftEditor(id) {
  const draft = state.catalog.drafts.find((item) => item.id === id);
  if (!draft) return;
  state.selectedDraftId = id;
  elements.draftMetadata.hidden = false;
  elements.draftPreview.src = draft.fullUrl;
  elements.draftPreview.alt = `${draftCode(id)} 本地草稿预览`;
  elements.draftMetadataTitle.textContent = draftCode(id);
  elements.draftStatusBadge.className = `draft-status-badge is-${draft.status}`;
  elements.draftStatusBadge.textContent = draftStatusCopy[draft.status]?.label || draft.status;
  elements.draftMetadataNote.textContent = draftStatusCopy[draft.status]?.note || "";
  elements.draftScene.value = draft.scene || "";
  renderDraftClassificationOptions();
  elements.draftTheme.value = draft.theme || "";
  elements.draftCategory.value = draft.category || "";
  elements.publicConsent.checked = draft.approvedForPublicUse === true;
  elements.homepageFeatured.checked = draft.featured === true;
  setDraftFeedback();
  setDraftEditorControls(draft);
  renderDrafts();
  elements.draftMetadata.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

function renderUploadResults(results) {
  elements.uploadResults.replaceChildren(...results.map((result) => {
    const item = document.createElement("li");
    item.className = `upload-result is-${result.status}`;
    const marker = document.createElement("span");
    marker.className = "upload-result-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = result.status === "success" ? "✓" : (result.status === "error" ? "!" : "…");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = result.file;
    const detail = document.createElement("small");
    detail.textContent = result.status === "success"
      ? `已保存为 ${result.code}`
      : (result.status === "error" ? result.error : "等待上传");
    copy.append(name, detail);
    item.append(marker, copy);
    return item;
  }));
}

async function uploadDraftFiles(files) {
  if (!files.length || state.draftBusy) return;
  const results = files.map((file) => ({ file: file.name, status: "pending" }));
  renderUploadResults(results);
  setDraftBusy(true);
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const payload = await requestJson("/api/drafts/upload", {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
        },
        body: file,
      });
      results[index] = { file: file.name, status: "success", code: payload.result.code || draftCode(payload.result.id) };
    } catch (error) {
      results[index] = { file: file.name, status: "error", error: error.message };
    }
    renderUploadResults(results);
  }
  elements.draftUpload.value = "";
  try {
    await refreshData();
    const latest = [...state.catalog.drafts].sort((a, b) => b.id - a.id)[0];
    if (latest && results.some(({ status }) => status === "success")) openDraftEditor(latest.id);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setDraftBusy(false);
  }
}

function draftPatch() {
  return {
    scene: elements.draftScene.value,
    theme: elements.draftTheme.value,
    category: elements.draftCategory.value,
    approvedForPublicUse: elements.publicConsent.checked,
    featured: elements.homepageFeatured.checked,
  };
}

async function saveDraftMetadata({ quiet = false } = {}) {
  const draft = selectedDraft();
  if (!draft || draft.status !== "draft") return false;
  setDraftBusy(true);
  setDraftFeedback("正在保存分类和授权…", "working");
  try {
    await requestJson(`/api/drafts/update?id=${draft.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draftPatch()),
    });
    await refreshData();
    openDraftEditor(draft.id);
    if (!quiet) setDraftFeedback("分类和授权已保存在本机。", "success");
    return true;
  } catch (error) {
    setDraftFeedback(error.message, "error");
    return false;
  } finally {
    setDraftBusy(false);
  }
}

async function prepareSelectedDraft() {
  const draft = selectedDraft();
  if (!draft || draft.status !== "draft" || !draftMetadataValid() || state.draftBusy) return;
  if (!await saveDraftMetadata({ quiet: true })) return;
  setDraftBusy(true);
  setDraftFeedback("正在进入待公开…", "working");
  try {
    await requestJson(`/api/drafts/ready?id=${draft.id}`, { method: "POST" });
    await refreshData();
    openDraftEditor(draft.id);
    setDraftFeedback("已进入待公开。下一步可加入本地网站预览，此时仍不会自动同步。", "success");
  } catch (error) {
    setDraftFeedback(error.message, "error");
  } finally {
    setDraftBusy(false);
  }
}

async function mutateSelectedDraft(path, body, successMessage) {
  const draft = selectedDraft();
  if (!draft || state.draftBusy) return;
  setDraftBusy(true);
  setDraftFeedback("正在处理…", "working");
  try {
    await requestJson(`${path}?id=${draft.id}`, {
      method: "POST",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    await refreshData();
    openDraftEditor(draft.id);
    setDraftFeedback(successMessage, "success");
  } catch (error) {
    setDraftFeedback(error.message, "error");
  } finally {
    setDraftBusy(false);
  }
}

async function archiveSelectedDraft() {
  const draft = selectedDraft();
  if (!draft) return;
  if (draft.status === "published" || draft.stagedAt) {
    await mutateSelectedDraft("/api/public/visibility", { visibility: "archived" }, "已从网站清单隐藏，编号和本地资产保留。");
  } else {
    await mutateSelectedDraft("/api/drafts/archive", null, "草稿已归档，编号和本地资产保留。");
  }
}

async function restoreSelectedDraft() {
  const draft = selectedDraft();
  if (!draft) return;
  if (draft.status === "archived" && (draft.stagedAt || draft.publishedCommit)) {
    await mutateSelectedDraft("/api/public/visibility", { visibility: "published" }, "已恢复到本地网站清单，同步仍需最终确认。");
  } else {
    await mutateSelectedDraft("/api/drafts/restore", null, "已恢复为可编辑草稿。");
  }
}

function toggleNewThemeForm(show) {
  elements.newThemeForm.hidden = !show;
  elements.newThemeButton.setAttribute("aria-expanded", String(show));
  if (show) {
    elements.newThemeScene.value = elements.draftScene.value || elements.newThemeScene.value;
    elements.newThemeId.focus();
  } else {
    elements.newThemeFeedback.textContent = "";
  }
}

async function createDraftTheme() {
  if (state.draftBusy || !elements.newThemeForm.reportValidity()) return;
  setDraftBusy(true);
  elements.newThemeFeedback.textContent = "正在保存新主题…";
  try {
    const body = {
      id: elements.newThemeId.value.trim(),
      label: elements.newThemeLabel.value.trim(),
      scene: elements.newThemeScene.value,
      description: elements.newThemeDescription.value.trim(),
    };
    const payload = await requestJson("/api/draft-themes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    state.catalog = payload.catalog;
    elements.draftScene.value = body.scene;
    renderThemeOptions();
    renderSceneFilters();
    renderDraftClassificationOptions();
    elements.draftTheme.value = body.id;
    elements.newThemeForm.reset();
    toggleNewThemeForm(false);
    renderDrafts();
    updateDraftReadiness();
    showToast(`主题“${body.label}”已加入草稿选择器`, "success");
  } catch (error) {
    elements.newThemeFeedback.textContent = error.message;
    elements.newThemeFeedback.className = "inline-feedback is-error";
  } finally {
    setDraftBusy(false);
  }
}

async function refreshData() {
  const [catalog, status] = await Promise.all([requestJson("/api/catalog"), requestJson("/api/status")]);
  state.catalog = catalog; state.status = status; updateStatusCard(); renderThemeOptions(); renderSceneFilters(); renderGrid();
  renderDraftClassificationOptions(); renderDrafts(); setLibraryMode(state.libraryMode);
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
elements.libraryMode.addEventListener("change", (event) => {
  if (event.target.matches('input[name="library-mode"]')) setLibraryMode(event.target.value);
});
elements.addPhotoButton.addEventListener("click", () => {
  setLibraryMode("drafts", { focusUpload: true });
  elements.draftUpload.click();
});
elements.themeFilter.addEventListener("change", () => { state.theme = elements.themeFilter.value; renderGrid(); });
elements.searchInput.addEventListener("input", () => { state.search = elements.searchInput.value; renderGrid(); });
elements.dirtyOnly.addEventListener("change", () => { state.dirtyOnly = elements.dirtyOnly.checked; renderGrid(); });
elements.photoGrid.addEventListener("click", (event) => {
  if (state.mutationBusy) return;
  const card = event.target.closest("button[data-id]"); if (card) openPhotoDialog(Number(card.dataset.id));
});
elements.currentPhoto.addEventListener("error", () => { elements.currentPhoto.hidden = true; elements.currentPhotoFallback.hidden = false; });
elements.photoFile.addEventListener("change", () => { if (elements.photoFile.files?.[0]) acceptCandidate(elements.photoFile.files[0]); });
elements.draftUpload.addEventListener("change", () => uploadDraftFiles([...elements.draftUpload.files]));
elements.draftStatusFilter.addEventListener("change", () => {
  state.draftStatus = elements.draftStatusFilter.value;
  renderDrafts();
});
elements.draftGrid.addEventListener("click", (event) => {
  const card = event.target.closest("button[data-draft-id]");
  if (card) openDraftEditor(Number(card.dataset.draftId));
});
elements.draftScene.addEventListener("change", () => { renderDraftClassificationOptions(); updateDraftReadiness(); });
for (const control of [elements.draftTheme, elements.draftCategory, elements.publicConsent, elements.homepageFeatured]) {
  control.addEventListener("change", updateDraftReadiness);
}
elements.draftMetadataForm.addEventListener("submit", (event) => { event.preventDefault(); saveDraftMetadata(); });
elements.readyDraftButton.addEventListener("click", prepareSelectedDraft);
elements.archiveDraftButton.addEventListener("click", archiveSelectedDraft);
elements.restoreDraftButton.addEventListener("click", restoreSelectedDraft);
elements.stageDraftButton.addEventListener("click", () => mutateSelectedDraft(
  "/api/drafts/stage",
  null,
  "已加入本地网站预览。请先检查预览，再在独立确认中同步到网站。",
));
elements.newThemeButton.addEventListener("click", () => toggleNewThemeForm(elements.newThemeForm.hidden));
$("#new-theme-close").addEventListener("click", () => toggleNewThemeForm(false));
elements.newThemeForm.addEventListener("submit", (event) => { event.preventDefault(); createDraftTheme(); });
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

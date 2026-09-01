const maturityLabels = {
  reference: "风格参考",
  updating: "正在完善",
  complete: "完整客片组",
};

const sceneLabels = {
  indoor: "内景",
  outdoor: "外景",
};

function assetCode(assetId) {
  return `NB-${String(assetId).padStart(3, "0")}`;
}

function required(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`风格管理缺少界面节点 ${selector}`);
  return element;
}

function button(documentObject, { className = "", text = "", label = "" } = {}) {
  const element = documentObject.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  if (label) element.setAttribute("aria-label", label);
  return element;
}

function sorted(items) {
  return [...items].sort((left, right) => left.order - right.order);
}

function styleIdFromSlot(slotId) {
  return slotId.replace(/-P0[1-9]$/, "");
}

function moveSelection(event, elements, selectedIndex, choose) {
  const keys = new Set(["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"]);
  if (!keys.has(event.key) || !elements.length) return;
  event.preventDefault();
  let nextIndex = selectedIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = elements.length - 1;
  else if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (selectedIndex + 1) % elements.length;
  else nextIndex = (selectedIndex - 1 + elements.length) % elements.length;
  choose(elements[nextIndex], true);
}

export function createStyleMode({ root, requestJson, showToast, openPreview }) {
  if (!root?.querySelector || typeof requestJson !== "function" || typeof showToast !== "function" || typeof openPreview !== "function") {
    throw new Error("风格管理初始化参数无效");
  }
  const documentObject = root.ownerDocument;
  const elements = {
    sceneList: required(root, "#style-scene-list"),
    familyList: required(root, "#style-family-list"),
    styleList: required(root, "#style-list"),
    slotGrid: required(root, "#style-slot-grid"),
    selectedTitle: required(root, "#style-selected-title"),
    selectedId: required(root, "#style-selected-id"),
    maturityLabel: required(root, "#style-maturity-label"),
    maturity: required(root, "#style-maturity"),
    publicConfirm: required(root, "#style-public-confirm"),
    layoutSave: required(root, "#style-layout-save"),
    slotCount: required(root, "#style-slot-count"),
    uniqueAssets: required(root, "#style-unique-assets"),
    copyEditor: required(root, "#style-copy-editor"),
    styleName: required(root, "#style-name"),
    audience: required(root, "#style-audience"),
    description: required(root, "#style-description"),
    visibility: required(root, "#style-visibility"),
    previewButton: required(root, "#style-preview-button"),
    refreshButton: required(root, "#style-refresh-button"),
    loading: required(root, "#style-loading"),
    error: required(root, "#style-error"),
    replaceDialog: required(root, "#style-slot-replace-dialog"),
    replaceClose: required(root, "#style-slot-replace-close"),
    replaceCancel: required(root, "#style-slot-cancel"),
    replaceConfirm: required(root, "#style-slot-confirm"),
    replaceFile: required(root, "#style-slot-file"),
    replaceCurrent: required(root, "#style-slot-current-preview"),
    replaceNew: required(root, "#style-slot-new-preview"),
    replaceCurrentLabel: required(root, "#style-slot-current-label"),
    replaceNewLabel: required(root, "#style-slot-new-label"),
    replaceTitle: required(root, "#style-slot-replace-title"),
    batchOpen: required(root, "#style-batch-open"),
    batchDialog: required(root, "#style-batch-dialog"),
    batchClose: required(root, "#style-batch-close"),
    batchCancel: required(root, "#style-batch-cancel"),
    batchCommit: required(root, "#style-batch-commit"),
    batchFiles: required(root, "#style-batch-files"),
    batchList: required(root, "#style-batch-list"),
    batchStatus: required(root, "#style-batch-status"),
    batchTitle: required(root, "#style-batch-title"),
  };
  const state = {
    library: null,
    scene: "indoor",
    familyId: "",
    styleId: "",
    references: new Map(),
    busy: false,
    loading: false,
    replaceSlotId: "",
    replaceFile: null,
    replaceUrl: "",
    replaceCandidate: null,
    replaceGeneration: 0,
    replaceValid: false,
    replaceOpener: null,
    layoutDrafts: new Map(),
    pointerDrag: null,
    batchId: "",
    batchStyleId: "",
    batchEntries: new Map(),
    batchOrder: [],
    batchOpener: null,
  };

  function activeFamilies() {
    return sorted((state.library?.families || []).filter(({ scene }) => scene === state.scene));
  }

  function activeStyles() {
    return sorted((state.library?.styles || []).filter(({ familyId }) => familyId === state.familyId));
  }

  function selectedStyle() {
    return state.library?.styles.find(({ id }) => id === state.styleId) || null;
  }

  function styleStateFingerprint(style) {
    return JSON.stringify([
      style.maturity,
      style.coverSlotId,
      ...style.slots.flatMap(({ id, assetId, source, updatedAt }) => [id, assetId, source, updatedAt]),
    ]);
  }

  function layoutDraft(style = selectedStyle()) {
    if (!style) return null;
    const currentIds = style.slots.map(({ id }) => id);
    const baseFingerprint = styleStateFingerprint(style);
    let draft = state.layoutDrafts.get(style.id);
    if (!draft || draft.orderedSlotIds.length !== 9
      || draft.orderedSlotIds.some((slotId) => !currentIds.includes(slotId))) {
      draft = {
        orderedSlotIds: currentIds,
        coverSlotId: style.coverSlotId,
        maturity: style.maturity,
        publicConfirmed: false,
        dirty: false,
        baseFingerprint,
      };
      state.layoutDrafts.set(style.id, draft);
    } else if (draft.baseFingerprint !== baseFingerprint) {
      draft.baseFingerprint = baseFingerprint;
      draft.maturity = style.maturity;
      draft.publicConfirmed = false;
      draft.dirty = draft.coverSlotId !== style.coverSlotId
        || draft.orderedSlotIds.some((slotId, index) => style.slots[index]?.id !== slotId);
    }
    return draft;
  }

  function orderedStyleSlots(style, draft = layoutDraft(style)) {
    const byId = new Map(style.slots.map((slot) => [slot.id, slot]));
    return draft.orderedSlotIds.map((slotId) => byId.get(slotId)).filter(Boolean);
  }

  function updateLayoutControls(style, draft) {
    const uploadCount = style.slots.filter(({ source }) => source === "upload").length;
    const referenceOption = elements.maturity.querySelector('option[value="reference"]');
    const updatingOption = elements.maturity.querySelector('option[value="updating"]');
    const completeOption = elements.maturity.querySelector('option[value="complete"]');
    referenceOption.disabled = uploadCount !== 0;
    updatingOption.disabled = uploadCount === 0;
    completeOption.disabled = style.completeEligible !== true;
    elements.maturity.value = draft.maturity;
    elements.maturityLabel.textContent = maturityLabels[draft.maturity] || draft.maturity;
    elements.publicConfirm.disabled = state.busy || draft.maturity !== "complete" || style.completeEligible !== true;
    elements.publicConfirm.checked = draft.publicConfirmed;
    elements.layoutSave.disabled = state.busy || !draft.dirty
      || (draft.maturity === "complete" && !draft.publicConfirmed);
  }

  function reconcileSelection() {
    const scenes = new Set((state.library?.families || []).map(({ scene }) => scene));
    if (!scenes.has(state.scene)) state.scene = scenes.has("indoor") ? "indoor" : [...scenes][0];
    const families = activeFamilies();
    if (!families.some(({ id }) => id === state.familyId)) state.familyId = families[0]?.id || "";
    const styles = activeStyles();
    if (!styles.some(({ id }) => id === state.styleId)) state.styleId = styles[0]?.id || "";
  }

  function setRootState() {
    root.dataset.selectedScene = state.scene;
    root.dataset.selectedFamily = state.familyId;
    root.dataset.selectedStyle = state.styleId;
    root.setAttribute("aria-busy", String(state.loading || state.busy));
  }

  function chooseScene(scene, focus = false) {
    state.scene = scene;
    state.familyId = "";
    state.styleId = "";
    reconcileSelection();
    render();
    loadReferences();
    if (focus) elements.sceneList.querySelector(`[data-style-scene="${scene}"]`)?.focus();
  }

  function chooseFamily(familyId, focus = false) {
    state.familyId = familyId;
    state.styleId = "";
    reconcileSelection();
    render();
    loadReferences();
    if (focus) elements.familyList.querySelector(`[data-style-family-id="${familyId}"]`)?.focus();
  }

  function chooseStyle(styleId, focus = false) {
    state.styleId = styleId;
    reconcileSelection();
    render();
    loadReferences();
    if (focus) elements.styleList.querySelector(`[data-style-id="${styleId}"]`)?.focus();
  }

  function renderScenes() {
    const scenes = [...new Set((state.library?.families || []).map(({ scene }) => scene))];
    elements.sceneList.replaceChildren(...scenes.map((scene) => {
      const selected = scene === state.scene;
      const control = button(documentObject, { text: sceneLabels[scene] || scene, label: `管理${sceneLabels[scene] || scene}风格` });
      control.dataset.styleScene = scene;
      control.setAttribute("role", "tab");
      control.setAttribute("aria-selected", String(selected));
      control.setAttribute("aria-controls", "style-family-list");
      control.tabIndex = selected ? 0 : -1;
      control.addEventListener("click", () => chooseScene(scene));
      return control;
    }));
  }

  function renderFamilies() {
    elements.familyList.replaceChildren(...activeFamilies().map((family) => {
      const selected = family.id === state.familyId;
      const control = button(documentObject, { className: "style-nav-row", label: `${family.label}，打开 11 种风格` });
      control.dataset.styleFamilyId = family.id;
      control.setAttribute("role", "tab");
      control.setAttribute("aria-selected", String(selected));
      control.setAttribute("aria-controls", "style-list");
      control.tabIndex = selected ? 0 : -1;
      const copy = documentObject.createElement("span");
      const title = documentObject.createElement("strong");
      title.textContent = family.label;
      const meta = documentObject.createElement("small");
      meta.textContent = `${family.id} · 11 种风格`;
      copy.append(title, meta);
      const arrow = documentObject.createElement("b");
      arrow.textContent = "›";
      arrow.setAttribute("aria-hidden", "true");
      control.append(copy, arrow);
      control.addEventListener("click", () => chooseFamily(family.id));
      return control;
    }));
  }

  function renderStyles() {
    elements.styleList.replaceChildren(...activeStyles().map((style) => {
      const selected = style.id === state.styleId;
      const control = button(documentObject, { className: "style-nav-row style-choice-row", label: `${style.label}${style.visibility === "hidden" ? "，已隐藏" : ""}` });
      control.dataset.styleId = style.id;
      control.setAttribute("role", "tab");
      control.setAttribute("aria-selected", String(selected));
      control.setAttribute("aria-controls", "style-slot-grid");
      control.tabIndex = selected ? 0 : -1;
      const copy = documentObject.createElement("span");
      const title = documentObject.createElement("strong");
      title.textContent = style.label;
      const meta = documentObject.createElement("small");
      meta.textContent = style.id;
      copy.append(title, meta);
      if (style.visibility === "hidden") {
        const hidden = documentObject.createElement("em");
        hidden.textContent = "已隐藏";
        copy.append(hidden);
      }
      const arrow = documentObject.createElement("b");
      arrow.textContent = "›";
      arrow.setAttribute("aria-hidden", "true");
      control.append(copy, arrow);
      control.addEventListener("click", () => chooseStyle(style.id));
      return control;
    }));
  }

  function slotCard(style, slot, displayPosition, coverSlotId) {
    const isCover = slot.id === coverSlotId;
    const card = documentObject.createElement("article");
    card.className = `style-slot-card${isCover ? " is-cover" : ""}`;
    card.dataset.styleSlotId = slot.id;
    card.dataset.assetId = String(slot.assetId);
    const media = documentObject.createElement("div");
    media.className = "style-slot-media";
    const image = documentObject.createElement("img");
    image.src = `/media/thumb/${slot.assetId}`;
    image.alt = `${style.label}排序第 ${displayPosition} 张`;
    image.width = 480;
    image.height = 640;
    image.loading = "lazy";
    const position = documentObject.createElement("span");
    position.textContent = String(displayPosition).padStart(2, "0");
    if (isCover) {
      const coverBadge = documentObject.createElement("strong");
      coverBadge.textContent = "封面";
      media.append(image, position, coverBadge);
    } else {
      media.append(image, position);
    }

    const body = documentObject.createElement("div");
    body.className = "style-slot-body";
    const heading = documentObject.createElement("div");
    heading.className = "style-slot-heading";
    const ids = documentObject.createElement("span");
    const slotId = documentObject.createElement("strong");
    slotId.textContent = slot.id;
    const code = documentObject.createElement("small");
    code.textContent = assetCode(slot.assetId);
    code.dataset.assetCode = assetCode(slot.assetId);
    ids.append(slotId, code);
    const references = documentObject.createElement("span");
    const referenceCount = state.references.get(slot.assetId);
    references.className = "style-reference-count";
    references.dataset.referenceCount = Number.isInteger(referenceCount) ? String(referenceCount) : "";
    references.textContent = Number.isInteger(referenceCount) ? `${referenceCount} 个引用` : "正在查引用";
    heading.append(ids, references);

    const poseLabel = documentObject.createElement("label");
    poseLabel.className = "style-slot-pose-label";
    const poseText = documentObject.createElement("span");
    poseText.textContent = "姿势标签";
    const pose = documentObject.createElement("input");
    pose.className = "style-slot-pose";
    pose.type = "text";
    pose.value = slot.poseLabel;
    pose.maxLength = 30;
    pose.autocomplete = "off";
    poseLabel.append(poseText, pose);

    const actions = documentObject.createElement("div");
    actions.className = "style-slot-actions";
    const drag = button(documentObject, {
      className: "button button-secondary style-slot-drag",
      text: "排序",
      label: `移动 ${slot.id}，可拖动或使用方向键、Home、End`,
    });
    drag.dataset.dragSlotId = slot.id;
    drag.setAttribute("aria-describedby", "style-layout-note");
    const save = button(documentObject, { className: "button button-secondary style-slot-save", text: "保存标签" });
    const cover = button(documentObject, {
      className: "button button-secondary style-slot-cover",
      text: isCover ? "当前封面" : "设为封面",
      label: `${isCover ? "当前封面" : "设为封面"}，${slot.id}`,
    });
    cover.disabled = isCover;
    const replace = button(documentObject, { className: "button button-primary style-slot-replace", text: "换这一张" });
    const undo = button(documentObject, { className: "button button-danger-subtle style-slot-undo", text: "撤销换图" });
    undo.hidden = slot.source !== "upload";
    save.addEventListener("click", () => saveSlotMeta(slot.id, pose.value));
    cover.addEventListener("click", () => setDraftCover(slot.id, cover));
    replace.addEventListener("click", () => openReplaceDialog(slot, replace));
    undo.addEventListener("click", () => undoSlot(slot.id));
    actions.append(drag, save, cover, replace, undo);
    body.append(heading, poseLabel, actions);
    card.append(media, body);
    return card;
  }

  function renderSelectedStyle() {
    const style = selectedStyle();
    if (!style) {
      elements.slotGrid.replaceChildren();
      return;
    }
    const draft = layoutDraft(style);
    const orderedSlots = orderedStyleSlots(style, draft);
    elements.selectedTitle.textContent = style.label;
    elements.selectedId.textContent = `${sceneLabels[style.scene]} · ${style.familyId} · ${style.id}`;
    elements.slotCount.textContent = `${style.slots.length} 个照片位`;
    elements.uniqueAssets.textContent = `${new Set(style.slots.map(({ assetId }) => assetId)).size} 张独立资产`;
    elements.styleName.value = style.label;
    elements.audience.value = style.audience;
    elements.description.value = style.description;
    elements.visibility.value = style.visibility;
    elements.slotGrid.replaceChildren(...orderedSlots.map((slot, index) =>
      slotCard(style, slot, index + 1, draft.coverSlotId)));
    updateLayoutControls(style, draft);
  }

  function render() {
    if (!state.library) return;
    reconcileSelection();
    renderScenes();
    renderFamilies();
    renderStyles();
    renderSelectedStyle();
    setRootState();
  }

  async function loadReferences() {
    const style = selectedStyle();
    if (!style) return;
    const styleId = style.id;
    const assetIds = [...new Set(style.slots.map(({ assetId }) => assetId))];
    await Promise.all(assetIds.map(async (assetId) => {
      try {
        const payload = await requestJson(`/api/assets/references?id=${assetId}`);
        state.references.set(assetId, payload.count);
      } catch {
        state.references.delete(assetId);
      }
    }));
    if (styleId === state.styleId) renderSelectedStyle();
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);
    root.querySelectorAll("button, input, select, textarea").forEach((control) => {
      if (control === elements.replaceConfirm) control.disabled = state.busy || !state.replaceValid;
      else if (control.classList.contains("style-slot-cover") && control.closest(".is-cover")) control.disabled = true;
      else control.disabled = state.busy;
    });
    const style = selectedStyle();
    if (style) updateLayoutControls(style, layoutDraft(style));
    updateBatchControls();
    setRootState();
  }

  async function refresh() {
    if (state.loading) return state.library;
    state.loading = true;
    elements.loading.hidden = false;
    elements.error.hidden = true;
    setRootState();
    try {
      state.library = await requestJson("/api/style-library");
      reconcileSelection();
      render();
      await loadReferences();
      return state.library;
    } catch (error) {
      elements.error.textContent = error.message;
      elements.error.hidden = false;
      throw error;
    } finally {
      state.loading = false;
      elements.loading.hidden = true;
      setRootState();
    }
  }

  async function activate() {
    root.hidden = false;
    if (!state.library) await refresh();
    else render();
    return state.library;
  }

  async function saveSlotMeta(slotId, poseLabel) {
    setBusy(true);
    try {
      await requestJson("/api/style-slots/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, poseLabel: poseLabel.trim() }),
      });
      await refresh();
      showToast("姿势标签已保存在本机，尚未同步到网站", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function setDraftCover(coverSlotId, focusTarget = null) {
    const style = selectedStyle();
    if (!style) return;
    const draft = layoutDraft(style);
    if (!draft.orderedSlotIds.includes(coverSlotId) || draft.coverSlotId === coverSlotId) return;
    draft.coverSlotId = coverSlotId;
    draft.dirty = true;
    renderSelectedStyle();
    if (focusTarget) root.querySelector(`[data-style-slot-id="${coverSlotId}"] .style-slot-cover`)?.focus({ preventScroll: true });
  }

  function moveDraftSlot(slotId, targetIndex, { focus = true } = {}) {
    const style = selectedStyle();
    const draft = layoutDraft(style);
    if (!style || !draft) return;
    const currentIndex = draft.orderedSlotIds.indexOf(slotId);
    const boundedTarget = Math.max(0, Math.min(draft.orderedSlotIds.length - 1, targetIndex));
    if (currentIndex < 0 || currentIndex === boundedTarget) return;
    draft.orderedSlotIds.splice(currentIndex, 1);
    draft.orderedSlotIds.splice(boundedTarget, 0, slotId);
    draft.dirty = true;
    renderSelectedStyle();
    if (state.pointerDrag?.slotId === slotId) {
      root.querySelector(`[data-style-slot-id="${slotId}"]`)?.classList.add("is-dragging");
    }
    if (focus) root.querySelector(`[data-style-slot-id="${slotId}"] .style-slot-drag`)?.focus({ preventScroll: true });
  }

  async function saveLayout() {
    const style = selectedStyle();
    const draft = layoutDraft(style);
    if (!style || !draft || !draft.dirty) return;
    if (draft.maturity === "complete" && !draft.publicConfirmed) {
      showToast("请先确认 9 张照片均属于本风格且可公开", "error");
      return;
    }
    setBusy(true);
    try {
      await requestJson("/api/styles/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleId: style.id,
          orderedSlotIds: [...draft.orderedSlotIds],
          coverSlotId: draft.coverSlotId,
          maturity: draft.maturity,
        }),
      });
      state.layoutDrafts.delete(style.id);
      await refresh();
      showToast("顺序与封面已保存在本机，尚未同步到网站", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function clearBatchEntries() {
    for (const entry of state.batchEntries.values()) {
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
    state.batchEntries.clear();
    state.batchOrder = [];
    elements.batchFiles.value = "";
    elements.batchList.replaceChildren();
  }

  function updateBatchControls() {
    const ready = Boolean(state.batchId)
      && state.batchOrder.length === 9
      && state.batchOrder.every((position) => state.batchEntries.get(position)?.status === "ready");
    elements.batchCommit.disabled = state.busy || !ready;
    elements.batchCancel.disabled = state.busy;
    elements.batchClose.disabled = state.busy;
    elements.batchFiles.disabled = state.busy;
  }

  function moveBatchPosition(position, delta) {
    const index = state.batchOrder.indexOf(position);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= state.batchOrder.length) return;
    state.batchOrder.splice(index, 1);
    state.batchOrder.splice(nextIndex, 0, position);
    renderBatchEntries();
    elements.batchList.querySelector(`[data-batch-position="${position}"] .style-batch-move`)?.focus({ preventScroll: true });
  }

  function renderBatchEntries() {
    elements.batchList.replaceChildren(...state.batchOrder.map((position, index) => {
      const entry = state.batchEntries.get(position);
      const row = documentObject.createElement("li");
      row.className = "style-batch-row";
      row.dataset.batchPosition = String(position);
      row.dataset.batchStatus = entry.status;
      const preview = documentObject.createElement("img");
      preview.src = entry.objectUrl;
      preview.alt = `整组排序第 ${index + 1} 张`;
      preview.width = 96;
      preview.height = 128;
      const copy = documentObject.createElement("div");
      const title = documentObject.createElement("strong");
      title.textContent = `${String(index + 1).padStart(2, "0")} · ${entry.file.name}`;
      const status = documentObject.createElement("small");
      status.textContent = entry.status === "ready" ? "已通过并暂存"
        : (entry.status === "error" ? entry.error : "正在检查…");
      copy.append(title, status);
      const controls = documentObject.createElement("div");
      controls.className = "style-batch-row-actions";
      const earlier = button(documentObject, {
        className: "button button-secondary style-batch-move",
        text: "前移",
        label: `把暂存第 ${position} 张前移`,
      });
      earlier.disabled = state.busy || index === 0;
      earlier.addEventListener("click", () => moveBatchPosition(position, -1));
      const later = button(documentObject, {
        className: "button button-secondary style-batch-move",
        text: "后移",
        label: `把暂存第 ${position} 张后移`,
      });
      later.disabled = state.busy || index === state.batchOrder.length - 1;
      later.addEventListener("click", () => moveBatchPosition(position, 1));
      controls.append(earlier, later);
      if (entry.status === "error") {
        const retry = documentObject.createElement("label");
        retry.className = "button button-primary style-batch-retry";
        retry.textContent = "重选此张";
        const input = documentObject.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (file) retryBatchPosition(position, file);
        });
        retry.append(input);
        controls.append(retry);
      }
      row.append(preview, copy, controls);
      return row;
    }));
    updateBatchControls();
  }

  async function stageBatchPosition(position, file) {
    const entry = state.batchEntries.get(position);
    if (!entry || !state.batchId) return;
    entry.status = "checking";
    entry.error = "";
    renderBatchEntries();
    try {
      await requestJson(`/api/style-batches/${encodeURIComponent(state.batchId)}/files/${position}`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      entry.status = "ready";
    } catch (error) {
      entry.status = "error";
      entry.error = error.message;
    }
    renderBatchEntries();
  }

  async function retryBatchPosition(position, file) {
    if (state.busy) return;
    const validationError = batchFileValidationError(file);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    const entry = state.batchEntries.get(position);
    if (!entry || entry.status !== "error") return;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entry.file = file;
    entry.objectUrl = URL.createObjectURL(file);
    setBusy(true);
    try {
      await stageBatchPosition(position, file);
      const readyCount = [...state.batchEntries.values()].filter(({ status }) => status === "ready").length;
      elements.batchStatus.textContent = `${readyCount} / 9 张已通过`;
    } finally {
      setBusy(false);
      renderBatchEntries();
    }
  }

  async function discardOpenBatch() {
    if (!state.batchId) return;
    const batchId = state.batchId;
    state.batchId = "";
    await requestJson(`/api/style-batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  }

  function batchFileValidationError(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return "只支持 JPG、PNG 或 WebP 图片";
    }
    if (file.size > 50 * 1024 * 1024) return "图片超过 50 MB，请先导出精修 JPG";
    return "";
  }

  async function acceptBatchFiles(fileList) {
    const files = [...fileList];
    setBusy(true);
    const previousBatchId = state.batchId;
    state.batchId = "";
    clearBatchEntries();
    elements.batchStatus.textContent = "正在建立新的 9 张暂存…";
    try {
      if (previousBatchId) {
        await requestJson(`/api/style-batches/${encodeURIComponent(previousBatchId)}`, { method: "DELETE" });
      }
      if (files.length !== 9) {
        elements.batchStatus.textContent = "请一次选择恰好 9 张照片。旧组已失效。";
        showToast("整组换图必须恰好选择 9 张", "error");
        return;
      }
      files.forEach((file, index) => {
        const position = index + 1;
        const error = batchFileValidationError(file);
        state.batchEntries.set(position, {
          file,
          objectUrl: URL.createObjectURL(file),
          status: error ? "error" : "checking",
          error,
        });
        state.batchOrder.push(position);
      });
      renderBatchEntries();
      const created = await requestJson("/api/style-batches", { method: "POST" });
      state.batchId = created.result.batchId;
      state.batchStyleId = selectedStyle()?.id || "";
      for (let position = 1; position <= 9; position += 1) {
        const entry = state.batchEntries.get(position);
        if (entry.status === "checking") await stageBatchPosition(position, entry.file);
      }
      const readyCount = [...state.batchEntries.values()].filter(({ status }) => status === "ready").length;
      elements.batchStatus.textContent = readyCount === 9
        ? "9 / 9 张已通过，可调整顺序后原子提交。"
        : `${readyCount} / 9 张已通过；请重选标红的照片。`;
    } catch (error) {
      elements.batchStatus.textContent = error.message;
      showToast(error.message, "error");
    } finally {
      setBusy(false);
      renderBatchEntries();
    }
  }

  function openBatchDialog() {
    const style = selectedStyle();
    if (!style) return;
    state.batchStyleId = style.id;
    state.batchOpener = documentObject.activeElement;
    elements.batchTitle.textContent = `整组换 9 张 · ${style.id}`;
    elements.batchStatus.textContent = "还未选择照片。";
    elements.batchDialog.showModal();
    elements.batchFiles.focus({ preventScroll: true });
  }

  async function closeBatchDialog() {
    if (state.busy) return;
    setBusy(true);
    try {
      await discardOpenBatch();
      if (elements.batchDialog.open) elements.batchDialog.close();
      clearBatchEntries();
      elements.batchStatus.textContent = "还未选择照片。";
      state.batchStyleId = "";
      state.batchOpener?.focus?.({ preventScroll: true });
      state.batchOpener = null;
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function commitOpenBatch() {
    if (state.busy || !state.batchId || state.batchOrder.length !== 9) return;
    setBusy(true);
    try {
      await requestJson(`/api/style-batches/${encodeURIComponent(state.batchId)}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleId: state.batchStyleId,
          orderedPositions: [...state.batchOrder],
        }),
      });
      state.batchId = "";
      state.layoutDrafts.delete(state.batchStyleId);
      if (elements.batchDialog.open) elements.batchDialog.close();
      clearBatchEntries();
      await refresh();
      showToast("整组 9 张已原子保存，尚未同步到网站", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
      if (elements.batchDialog.open) renderBatchEntries();
    }
  }

  async function saveStyleMeta() {
    const style = selectedStyle();
    if (!style || !elements.copyEditor.reportValidity()) return;
    setBusy(true);
    try {
      await requestJson("/api/styles/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleId: style.id,
          label: elements.styleName.value.trim(),
          audience: elements.audience.value.trim(),
          description: elements.description.value.trim(),
          visibility: elements.visibility.value,
        }),
      });
      await refresh();
      showToast("风格资料已保存在本机，尚未同步到网站", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function revokeReplaceCandidate(candidate) {
    if (!candidate || candidate.revoked) return;
    candidate.revoked = true;
    URL.revokeObjectURL(candidate.objectUrl);
  }

  function isCurrentReplaceCandidate(candidate) {
    return Boolean(candidate
      && !candidate.revoked
      && state.replaceCandidate === candidate
      && state.replaceGeneration === candidate.generation
      && state.replaceSlotId === candidate.slotId
      && elements.replaceDialog.open
      && state.replaceUrl === candidate.objectUrl);
  }

  function resetReplaceCandidate() {
    state.replaceGeneration += 1;
    revokeReplaceCandidate(state.replaceCandidate);
    state.replaceCandidate = null;
    state.replaceUrl = "";
    state.replaceFile = null;
    state.replaceValid = false;
    elements.replaceFile.value = "";
    elements.replaceNew.hidden = true;
    elements.replaceNew.removeAttribute("src");
    elements.replaceNewLabel.textContent = "还未选图";
    elements.replaceConfirm.disabled = true;
  }

  function openReplaceDialog(slot, opener) {
    resetReplaceCandidate();
    state.replaceSlotId = slot.id;
    state.replaceOpener = opener || documentObject.activeElement;
    elements.replaceTitle.textContent = `只替换 ${slot.id}`;
    elements.replaceCurrent.src = `/media/thumb/${slot.assetId}`;
    elements.replaceCurrent.alt = `${slot.id} 当前图片`;
    elements.replaceCurrentLabel.textContent = assetCode(slot.assetId);
    elements.replaceDialog.showModal();
    elements.replaceFile.focus({ preventScroll: true });
  }

  function closeReplaceDialog() {
    if (state.busy) return;
    if (elements.replaceDialog.open) elements.replaceDialog.close();
    resetReplaceCandidate();
    state.replaceSlotId = "";
    state.replaceOpener?.focus?.({ preventScroll: true });
    state.replaceOpener = null;
  }

  function inspectReplaceCandidate(candidate) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        if (!isCurrentReplaceCandidate(candidate)) {
          revokeReplaceCandidate(candidate);
          resolve(null);
          return;
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight, error: false });
      };
      image.onerror = () => {
        if (!isCurrentReplaceCandidate(candidate)) {
          revokeReplaceCandidate(candidate);
          resolve(null);
          return;
        }
        resolve({ width: 0, height: 0, error: true });
      };
      image.src = candidate.objectUrl;
    });
  }

  async function acceptReplaceFile(file) {
    resetReplaceCandidate();
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("只支持 JPG、PNG 或 WebP 图片", "error");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showToast("图片超过 50 MB，请先导出精修 JPG", "error");
      return;
    }
    if (!elements.replaceDialog.open || !state.replaceSlotId) return;
    const objectUrl = URL.createObjectURL(file);
    const candidate = {
      generation: state.replaceGeneration,
      objectUrl,
      revoked: false,
      slotId: state.replaceSlotId,
    };
    state.replaceCandidate = candidate;
    state.replaceUrl = objectUrl;
    if (!isCurrentReplaceCandidate(candidate)) {
      revokeReplaceCandidate(candidate);
      return;
    }
    const result = await inspectReplaceCandidate(candidate);
    if (!result || !isCurrentReplaceCandidate(candidate)) {
      revokeReplaceCandidate(candidate);
      return;
    }
    if (result.error) {
      revokeReplaceCandidate(candidate);
      state.replaceCandidate = null;
      state.replaceUrl = "";
      showToast("这张图片无法读取，请重新导出 JPG", "error");
      return;
    }
    const ratioOkay = Math.abs(result.width / result.height - 0.75) <= 0.005;
    const sizeOkay = result.width >= 900 && result.height >= 1200;
    if (!ratioOkay || !sizeOkay) {
      revokeReplaceCandidate(candidate);
      state.replaceCandidate = null;
      state.replaceUrl = "";
      showToast(!sizeOkay ? "请使用至少 900×1200 的精修图" : "请先裁成 3:4，系统不会自动裁人", "error");
      return;
    }
    state.replaceFile = file;
    state.replaceValid = true;
    elements.replaceNew.src = objectUrl;
    elements.replaceNew.hidden = false;
    elements.replaceNewLabel.textContent = `${result.width}×${result.height}`;
    elements.replaceConfirm.disabled = state.busy;
  }

  async function replaceSlot(slotId, file) {
    const styleId = styleIdFromSlot(slotId);
    const target = state.library?.styles.find(({ id }) => id === styleId);
    if (target) {
      state.scene = target.scene;
      state.familyId = target.familyId;
      state.styleId = target.id;
    } else {
      const match = styleId.match(/^ST-(IN|OUT)-(0[1-6])-/);
      if (match) {
        state.scene = match[1] === "IN" ? "indoor" : "outdoor";
        state.familyId = `${match[1]}-${match[2]}`;
        state.styleId = styleId;
      }
    }
    setBusy(true);
    try {
      await requestJson(`/api/style-slots/replace?slot=${encodeURIComponent(slotId)}`, {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      await refresh();
      showToast("只替换了当前照片位，其他复用位置不变", "success");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReplace() {
    if (!state.replaceValid || !state.replaceFile || !state.replaceSlotId || !isCurrentReplaceCandidate(state.replaceCandidate)) return;
    try {
      await replaceSlot(state.replaceSlotId, state.replaceFile);
      closeReplaceDialog();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function undoSlot(slotId) {
    const reviewedStyle = selectedStyle();
    const reviewedPoseLabel = reviewedStyle?.slots.find(({ id }) => id === slotId)?.poseLabel || "";
    setBusy(true);
    try {
      await requestJson(`/api/style-slots/undo?slot=${encodeURIComponent(slotId)}`, { method: "POST" });
      if (reviewedPoseLabel) {
        await requestJson("/api/style-slots/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slotId, poseLabel: reviewedPoseLabel }),
        });
      }
      await refresh();
      showToast("已撤销当前照片位的最近一次换图", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  elements.sceneList.addEventListener("keydown", (event) => {
    const controls = [...elements.sceneList.querySelectorAll("[data-style-scene]")];
    moveSelection(event, controls, controls.findIndex(({ dataset }) => dataset.styleScene === state.scene), (control, focus) => chooseScene(control.dataset.styleScene, focus));
  });
  elements.familyList.addEventListener("keydown", (event) => {
    const controls = [...elements.familyList.querySelectorAll("[data-style-family-id]")];
    moveSelection(event, controls, controls.findIndex(({ dataset }) => dataset.styleFamilyId === state.familyId), (control, focus) => chooseFamily(control.dataset.styleFamilyId, focus));
  });
  elements.styleList.addEventListener("keydown", (event) => {
    const controls = [...elements.styleList.querySelectorAll("[data-style-id]")];
    moveSelection(event, controls, controls.findIndex(({ dataset }) => dataset.styleId === state.styleId), (control, focus) => chooseStyle(control.dataset.styleId, focus));
  });
  elements.slotGrid.addEventListener("keydown", (event) => {
    const handle = event.target.closest?.(".style-slot-drag");
    if (!handle) return;
    const keys = new Set(["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Home", "End"]);
    if (!keys.has(event.key)) return;
    const draft = layoutDraft();
    const slotId = handle.dataset.dragSlotId;
    const currentIndex = draft?.orderedSlotIds.indexOf(slotId) ?? -1;
    if (currentIndex < 0) return;
    event.preventDefault();
    let targetIndex = currentIndex;
    if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = draft.orderedSlotIds.length - 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") targetIndex -= 1;
    else targetIndex += 1;
    moveDraftSlot(slotId, targetIndex);
  });
  elements.slotGrid.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest?.(".style-slot-drag");
    if (!handle || state.busy) return;
    event.preventDefault();
    state.pointerDrag = { pointerId: event.pointerId, slotId: handle.dataset.dragSlotId };
    elements.slotGrid.classList.add("is-pointer-sorting");
    handle.closest(".style-slot-card")?.classList.add("is-dragging");
    try {
      elements.slotGrid.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser tests do not create a native active pointer.
    }
  });
  elements.slotGrid.addEventListener("pointermove", (event) => {
    if (!state.pointerDrag || state.pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    let targetCard = documentObject.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-style-slot-id]");
    if (!targetCard || !elements.slotGrid.contains(targetCard)) {
      targetCard = [...elements.slotGrid.querySelectorAll("[data-style-slot-id]")].find((card) => {
        const rect = card.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
    }
    const draft = layoutDraft();
    const targetIndex = draft?.orderedSlotIds.indexOf(targetCard?.dataset.styleSlotId) ?? -1;
    if (targetIndex >= 0) moveDraftSlot(state.pointerDrag.slotId, targetIndex, { focus: false });
  });
  const finishPointerSort = (event) => {
    if (!state.pointerDrag || state.pointerDrag.pointerId !== event.pointerId) return;
    const { slotId, pointerId } = state.pointerDrag;
    state.pointerDrag = null;
    elements.slotGrid.classList.remove("is-pointer-sorting");
    root.querySelectorAll(".style-slot-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
    try {
      if (elements.slotGrid.hasPointerCapture(pointerId)) elements.slotGrid.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may be absent for a cancelled or synthetic pointer.
    }
    root.querySelector(`[data-style-slot-id="${slotId}"] .style-slot-drag`)?.focus({ preventScroll: true });
  };
  elements.slotGrid.addEventListener("pointerup", finishPointerSort);
  elements.slotGrid.addEventListener("pointercancel", finishPointerSort);
  elements.maturity.addEventListener("change", () => {
    const style = selectedStyle();
    const draft = layoutDraft(style);
    if (!style || !draft) return;
    draft.maturity = elements.maturity.value;
    if (draft.maturity !== "complete") draft.publicConfirmed = false;
    draft.dirty = draft.maturity !== style.maturity
      || draft.coverSlotId !== style.coverSlotId
      || draft.orderedSlotIds.some((slotId, index) => style.slots[index]?.id !== slotId);
    updateLayoutControls(style, draft);
  });
  elements.publicConfirm.addEventListener("change", () => {
    const style = selectedStyle();
    const draft = layoutDraft(style);
    if (!style || !draft) return;
    draft.publicConfirmed = elements.publicConfirm.checked;
    updateLayoutControls(style, draft);
  });
  elements.layoutSave.addEventListener("click", saveLayout);
  elements.copyEditor.addEventListener("submit", (event) => {
    event.preventDefault();
    saveStyleMeta();
  });
  elements.previewButton.addEventListener("click", () => {
    const style = selectedStyle();
    if (!style) return;
    openPreview(`/preview/?scene=${encodeURIComponent(style.scene)}&family=${encodeURIComponent(style.familyId)}&style=${encodeURIComponent(style.id)}`);
  });
  elements.refreshButton.addEventListener("click", () => refresh().catch((error) => showToast(error.message, "error")));
  elements.replaceFile.addEventListener("change", () => {
    const file = elements.replaceFile.files?.[0];
    if (file) acceptReplaceFile(file);
  });
  elements.replaceClose.addEventListener("click", closeReplaceDialog);
  elements.replaceCancel.addEventListener("click", closeReplaceDialog);
  elements.replaceConfirm.addEventListener("click", confirmReplace);
  elements.replaceDialog.addEventListener("cancel", (event) => {
    if (state.busy) event.preventDefault();
    else closeReplaceDialog();
  });
  elements.replaceDialog.addEventListener("click", (event) => {
    if (event.target === elements.replaceDialog) closeReplaceDialog();
  });
  elements.batchOpen.addEventListener("click", openBatchDialog);
  elements.batchFiles.addEventListener("change", () => {
    if (elements.batchFiles.files?.length) acceptBatchFiles(elements.batchFiles.files);
  });
  elements.batchClose.addEventListener("click", closeBatchDialog);
  elements.batchCancel.addEventListener("click", closeBatchDialog);
  elements.batchCommit.addEventListener("click", commitOpenBatch);
  elements.batchDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!state.busy) closeBatchDialog();
  });
  elements.batchDialog.addEventListener("click", (event) => {
    if (event.target === elements.batchDialog) closeBatchDialog();
  });

  return {
    activate,
    refresh,
    replaceSlot,
    setBusy,
  };
}

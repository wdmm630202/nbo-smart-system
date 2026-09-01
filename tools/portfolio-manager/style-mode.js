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

  function slotCard(style, slot) {
    const card = documentObject.createElement("article");
    card.className = `style-slot-card${slot.isCover ? " is-cover" : ""}`;
    card.dataset.styleSlotId = slot.id;
    card.dataset.assetId = String(slot.assetId);
    const media = documentObject.createElement("div");
    media.className = "style-slot-media";
    const image = documentObject.createElement("img");
    image.src = `/media/thumb/${slot.assetId}`;
    image.alt = `${style.label}第 ${slot.position} 个照片位`;
    image.width = 480;
    image.height = 640;
    image.loading = "lazy";
    const position = documentObject.createElement("span");
    position.textContent = String(slot.position).padStart(2, "0");
    if (slot.isCover) {
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
    const save = button(documentObject, { className: "button button-secondary style-slot-save", text: "保存标签" });
    const cover = button(documentObject, {
      className: "button button-secondary style-slot-cover",
      text: slot.isCover ? "当前封面" : "设为封面",
      label: `${slot.isCover ? "当前封面" : "设为封面"}，${slot.id}`,
    });
    cover.disabled = slot.isCover;
    const replace = button(documentObject, { className: "button button-primary style-slot-replace", text: "换这一张" });
    const undo = button(documentObject, { className: "button button-danger-subtle style-slot-undo", text: "撤销换图" });
    undo.hidden = slot.source !== "upload";
    save.addEventListener("click", () => saveSlotMeta(slot.id, pose.value));
    cover.addEventListener("click", () => saveLayout(slot.id, elements.maturity.value));
    replace.addEventListener("click", () => openReplaceDialog(slot, replace));
    undo.addEventListener("click", () => undoSlot(slot.id));
    actions.append(save, cover, replace, undo);
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
    elements.selectedTitle.textContent = style.label;
    elements.selectedId.textContent = `${sceneLabels[style.scene]} · ${style.familyId} · ${style.id}`;
    elements.maturityLabel.textContent = maturityLabels[style.maturity] || style.maturity;
    elements.maturity.value = style.maturity;
    elements.slotCount.textContent = `${style.slots.length} 个照片位`;
    elements.uniqueAssets.textContent = `${new Set(style.slots.map(({ assetId }) => assetId)).size} 张独立资产`;
    elements.styleName.value = style.label;
    elements.audience.value = style.audience;
    elements.description.value = style.description;
    elements.visibility.value = style.visibility;
    elements.slotGrid.replaceChildren(...style.slots.map((slot) => slotCard(style, slot)));
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

  async function saveLayout(coverSlotId, maturity) {
    const style = selectedStyle();
    if (!style) return;
    setBusy(true);
    try {
      await requestJson("/api/styles/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleId: style.id,
          orderedSlotIds: style.slots.map(({ id }) => id),
          coverSlotId: coverSlotId || style.coverSlotId,
          maturity,
        }),
      });
      await refresh();
      showToast("风格布局已保存在本机，尚未同步到网站", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false);
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
      if (reviewedStyle) {
        await requestJson("/api/styles/layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            styleId: reviewedStyle.id,
            orderedSlotIds: reviewedStyle.slots.map(({ id }) => id),
            coverSlotId: reviewedStyle.coverSlotId,
            maturity: reviewedStyle.maturity,
          }),
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
  elements.maturity.addEventListener("change", () => saveLayout(selectedStyle()?.coverSlotId || "", elements.maturity.value));
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

  return {
    activate,
    refresh,
    replaceSlot,
    setBusy,
  };
}

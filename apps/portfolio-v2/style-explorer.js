import {
  createExplorerState,
  reduceExplorer,
  serializeExplorerLocation,
} from "./style-explorer-model.js?v=__NBO_BUILD_VERSION__";

const sceneLabels = {
  indoor: "内景",
  outdoor: "外景",
};

function requiredElement(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`风格浏览器缺少 ${selector}`);
  return element;
}

function sorted(items) {
  return [...items].sort((left, right) => left.order - right.order);
}

function bindPressFeedback(element) {
  const press = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    element.classList.add("is-pressing");
  };
  const release = () => element.classList.remove("is-pressing");
  element.addEventListener("pointerdown", press);
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("lostpointercapture", release);
  element.addEventListener("pointerleave", release);
  element.addEventListener("blur", release);
}

function clearImageSources(container) {
  container.querySelectorAll("img").forEach((image) => {
    image.removeAttribute("src");
    image.removeAttribute("srcset");
  });
}

function updateLocation(windowObject, state, method = "replaceState") {
  if (!windowObject?.history || !windowObject.location) return;
  const url = new URL(windowObject.location.href);
  const locationState = serializeExplorerLocation(state);
  for (const key of ["style", "family", "scene"]) {
    const value = locationState.get(key);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  windowObject.history[method]?.({
    ...windowObject.history.state,
    styleExplorer: true,
    styleExplorerView: state.view,
    styleExplorerPoseIndex: state.poseIndex,
  }, "", url);
}

export function createStyleExplorer({
  root,
  library,
  versionPhoto = (path) => path,
  onTrack = () => {},
  onOpenViewer = () => {},
  onSelectionChange = () => {},
}) {
  if (!root?.querySelector || !library?.families || !library?.styles) {
    throw new Error("风格浏览器初始化参数无效");
  }

  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  const featured = requiredElement(root, "#style-featured");
  const sceneTabs = requiredElement(root, "#style-scene-tabs");
  const familyTabs = requiredElement(root, "#style-family-tabs");
  const cardGrid = requiredElement(root, "#style-card-grid");
  const album = requiredElement(root, "#style-album");
  const albumClose = requiredElement(root, "#style-album-close");
  const albumScene = requiredElement(root, "#style-album-scene");
  const albumTitle = requiredElement(root, "#style-album-title");
  const albumDescription = requiredElement(root, "#style-album-description");
  const albumGrid = requiredElement(root, "#style-album-grid");
  const stylesChrome = [...root.children].filter((element) => element !== album);
  let state = createExplorerState(library, new URLSearchParams(windowObject?.location?.search || ""));
  let destroyed = false;
  let lastOpenedStyleId = state.styleId;
  let viewerTriggerSlotId = "";
  const previousScrollRestoration = windowObject?.history?.scrollRestoration;
  if (windowObject?.history && "scrollRestoration" in windowObject.history) {
    windowObject.history.scrollRestoration = "manual";
  }

  const styleById = new Map(library.styles.map((style) => [style.id, style]));

  function focusRenderedTab(id) {
    const tab = documentObject.getElementById(id);
    if (tab && root.contains(tab)) tab.focus({ preventScroll: true });
  }

  function moveTabSelection(event, tablist) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || !tabs.length) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else nextIndex = (currentIndex + 1) % tabs.length;
    const nextId = tabs[nextIndex].id;
    tabs[nextIndex].click();
    focusRenderedTab(nextId);
  }

  function createTab({ id, label, selected, dataset, tablist, onClick }) {
    const button = documentObject.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "style-filter-tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(selected));
    button.setAttribute("aria-controls", "style-card-grid");
    button.tabIndex = selected ? 0 : -1;
    Object.assign(button.dataset, dataset);
    button.textContent = label;
    bindPressFeedback(button);
    button.addEventListener("click", () => {
      const restoreFocus = documentObject.activeElement === button;
      onClick();
      if (restoreFocus) focusRenderedTab(id);
    });
    button.addEventListener("keydown", (event) => moveTabSelection(event, tablist));
    return button;
  }

  function renderSceneTabs() {
    sceneTabs.replaceChildren(...["indoor", "outdoor"].map((scene) => createTab({
      id: `style-scene-tab-${scene}`,
      label: `${sceneLabels[scene]} ${library.counts?.[scene] || library.styles.filter((style) => style.scene === scene).length}`,
      selected: state.scene === scene,
      dataset: { scene },
      tablist: sceneTabs,
      onClick: () => {
        if (state.scene === scene) return;
        state = reduceExplorer(state, { type: "scene", scene }, library);
        render();
        updateLocation(windowObject, state);
        onTrack("style_scene_select", { scene, targetId: scene, targetLabel: sceneLabels[scene] });
        onSelectionChange(state, { type: "scene", scene });
      },
    })));
  }

  function renderFamilyTabs() {
    const families = sorted(library.families.filter((family) => family.scene === state.scene));
    familyTabs.replaceChildren(...families.map((family) => createTab({
      id: `style-family-tab-${family.id}`,
      label: family.label,
      selected: state.familyId === family.id,
      dataset: { familyId: family.id },
      tablist: familyTabs,
      onClick: () => {
        if (state.familyId === family.id) return;
        state = reduceExplorer(state, { type: "family", familyId: family.id }, library);
        render();
        updateLocation(windowObject, state);
        onTrack("style_family_select", {
          scene: state.scene,
          targetId: family.id,
          targetLabel: family.label,
        });
        onSelectionChange(state, { type: "family", familyId: family.id });
      },
    })));
  }

  function renderFallback(imageWrap, image, fallback, style) {
    image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.hidden = true;
    imageWrap.classList.add("has-error");
    imageWrap.classList.remove("is-loading");
    fallback.hidden = false;
    fallback.replaceChildren();
    const mark = documentObject.createElement("b");
    mark.textContent = "NBO";
    const text = documentObject.createElement("span");
    text.textContent = `${style.label}图片暂时无法显示`;
    fallback.append(mark, text);
  }

  function renderStyleCard(style) {
    const cover = style.slots.find((slot) => slot.isCover) || style.slots[0];
    const article = documentObject.createElement("article");
    article.className = "portrait-style-card";
    article.dataset.styleId = style.id;

    const open = documentObject.createElement("button");
    open.className = "portrait-style-card-open";
    open.type = "button";
    open.setAttribute("aria-label", `查看${style.label}，${style.audience}，9个拍摄参考`);
    bindPressFeedback(open);

    const imageWrap = documentObject.createElement("span");
    imageWrap.className = "portrait-style-card-image is-loading";
    const image = documentObject.createElement("img");
    image.width = 480;
    image.height = 640;
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = `${style.label}男士拍摄参考`;
    const fallback = documentObject.createElement("span");
    fallback.className = "portrait-style-card-fallback";
    fallback.hidden = true;
    image.addEventListener("load", () => imageWrap.classList.remove("is-loading"), { once: true });
    image.addEventListener("error", () => renderFallback(imageWrap, image, fallback, style), { once: true });
    imageWrap.append(image, fallback);

    const scene = documentObject.createElement("span");
    scene.className = "portrait-style-scene";
    scene.textContent = sceneLabels[style.scene];

    const copy = documentObject.createElement("span");
    copy.className = "portrait-style-copy";
    const title = documentObject.createElement("strong");
    title.textContent = style.label;
    const divider = documentObject.createElement("i");
    divider.setAttribute("aria-hidden", "true");
    const audience = documentObject.createElement("small");
    audience.textContent = style.audience;
    audience.title = style.audience;
    copy.append(title, divider, audience);
    open.append(imageWrap, scene, copy);
    open.addEventListener("click", () => openStyle(style.id));

    article.append(open);
    image.src = versionPhoto(cover.asset.thumb);
    return article;
  }

  function renderCards() {
    clearImageSources(cardGrid);
    const activeStyles = sorted(library.styles.filter((style) => (
      style.familyId === state.familyId && style.visibility === "published"
    )));
    cardGrid.setAttribute("aria-label", `${sceneLabels[state.scene]}·${library.families.find((family) => family.id === state.familyId)?.label || ""}风格`);
    cardGrid.setAttribute("aria-labelledby", `style-scene-tab-${state.scene} style-family-tab-${state.familyId}`);
    cardGrid.replaceChildren(...activeStyles.map(renderStyleCard));
  }

  function viewerItemsFor(style) {
    return style.slots.map(({ asset }) => asset);
  }

  function viewerContextFor(style) {
    return {
      styleId: style.id,
      slotIds: style.slots.map(({ id }) => id),
    };
  }

  function renderPoseChoice(style, slot) {
    const choice = documentObject.createElement("button");
    choice.type = "button";
    choice.className = "pose-choice";
    choice.dataset.slotId = slot.id;
    choice.setAttribute("aria-label", `想拍${style.label}的${slot.poseLabel}`);
    choice.textContent = "想拍这个姿势";
    bindPressFeedback(choice);
    // Task 8 consumes this explicit request hook and owns persistence/demand state.
    choice.addEventListener("click", () => onSelectionChange(state, {
      type: "pose-choice-request",
      style,
      slot,
    }));
    return choice;
  }

  function renderAlbum(style) {
    if (album.dataset.renderedStyleId === style.id && albumGrid.children.length === 9) return;
    const family = library.families.find((item) => item.id === style.familyId);
    const slots = [...style.slots].sort((left, right) => left.position - right.position);
    album.dataset.renderedStyleId = style.id;
    album.dataset.styleId = style.id;
    albumScene.textContent = `${sceneLabels[style.scene]} · ${family?.label || "风格相册"}`;
    albumTitle.textContent = style.label;
    albumDescription.textContent = `${style.audience} · ${style.description}`;
    albumGrid.replaceChildren(...slots.map((slot, index) => {
      const card = documentObject.createElement("article");
      card.className = `pose-card style-pose-card${index === 0 ? " is-lead" : ""}`;
      card.dataset.slotId = slot.id;
      card.dataset.position = String(slot.position);

      const open = documentObject.createElement("button");
      open.type = "button";
      open.className = "pose-open";
      open.setAttribute("aria-label", `查看${style.label}第${slot.position}个拍摄参考，${slot.poseLabel}`);
      bindPressFeedback(open);

      const imageWrap = documentObject.createElement("span");
      imageWrap.className = "pose-image is-loading";
      const image = documentObject.createElement("img");
      image.width = 480;
      image.height = 640;
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = `${style.label}${slot.poseLabel}`;
      const fallback = documentObject.createElement("span");
      fallback.className = "pose-image-fallback";
      fallback.hidden = true;
      fallback.textContent = `NBO · ${slot.poseLabel}`;
      image.addEventListener("load", () => imageWrap.classList.remove("is-loading"), { once: true });
      image.addEventListener("error", () => {
        image.removeAttribute("src");
        image.hidden = true;
        imageWrap.classList.remove("is-loading");
        fallback.hidden = false;
      }, { once: true });
      imageWrap.append(image, fallback);

      const number = documentObject.createElement("span");
      number.className = "pose-number";
      number.setAttribute("aria-hidden", "true");
      number.textContent = String(slot.position).padStart(2, "0");
      const label = documentObject.createElement("span");
      label.className = "pose-label";
      label.textContent = slot.poseLabel;
      open.append(imageWrap, number, label);
      open.addEventListener("click", () => openPose(index, open));

      card.append(open, renderPoseChoice(style, slot));
      image.src = versionPhoto(slot.asset.thumb);
      return card;
    }));
    album.scrollTop = 0;
    album.querySelector(".style-album-panel")?.scrollTo({ top: 0, behavior: "auto" });
  }

  function setStylesChromeActive(active) {
    stylesChrome.forEach((element) => {
      element.inert = !active;
      if (active) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", "true");
    });
  }

  function presentView() {
    const style = styleById.get(state.styleId);
    const showsAlbum = state.view === "album" || state.view === "viewer";
    root.dataset.view = state.view;
    root.dataset.scene = state.scene;
    root.dataset.familyId = state.familyId;
    root.dataset.styleId = state.styleId;
    root.dataset.poseIndex = String(state.poseIndex);
    if (showsAlbum && style) renderAlbum(style);
    album.hidden = !showsAlbum;
    album.dataset.styleId = showsAlbum ? state.styleId : "";
    setStylesChromeActive(!showsAlbum);
    documentObject.body.classList.toggle("style-album-open", showsAlbum);
  }

  function openCurrentViewer() {
    const style = styleById.get(state.styleId);
    if (!style || state.view !== "viewer") return false;
    onOpenViewer(state.poseIndex, viewerItemsFor(style), viewerContextFor(style));
    return true;
  }

  function openPose(index, trigger) {
    if (state.view !== "album") return false;
    const style = styleById.get(state.styleId);
    if (!style) return false;
    state = reduceExplorer(state, { type: "open-pose", poseIndex: index }, library);
    viewerTriggerSlotId = style.slots[state.poseIndex]?.id || trigger?.closest("[data-slot-id]")?.dataset.slotId || "";
    presentView();
    updateLocation(windowObject, state, "pushState");
    openCurrentViewer();
    onTrack("style_pose_open", {
      scene: style.scene,
      targetId: viewerTriggerSlotId,
      targetLabel: style.slots[state.poseIndex]?.poseLabel || style.label,
    });
    onSelectionChange(state, { type: "open-pose", style, slot: style.slots[state.poseIndex] });
    return true;
  }

  function restorePoseFocus() {
    if (!viewerTriggerSlotId) return;
    windowObject?.requestAnimationFrame?.(() => {
      albumGrid.querySelector(`[data-slot-id="${viewerTriggerSlotId}"] .pose-open`)?.focus({ preventScroll: true });
    });
  }

  function restoreStyleCard(scrollY = state.returnScrollY) {
    const styleId = lastOpenedStyleId;
    windowObject?.requestAnimationFrame?.(() => windowObject.requestAnimationFrame?.(() => {
      cardGrid.querySelector(`[data-style-id="${styleId}"] .portrait-style-card-open`)?.focus({ preventScroll: true });
      const restoreScroll = () => {
        const previousScrollBehavior = documentObject.documentElement.style.scrollBehavior;
        documentObject.documentElement.style.scrollBehavior = "auto";
        windowObject.scrollTo(0, scrollY);
        windowObject.requestAnimationFrame?.(() => {
          documentObject.documentElement.style.scrollBehavior = previousScrollBehavior;
        });
      };
      windowObject.requestAnimationFrame?.(restoreScroll);
      windowObject.setTimeout?.(restoreScroll, 80);
    }));
  }

  function chooseFeatured(style) {
    if (style.scene !== state.scene) state = reduceExplorer(state, { type: "scene", scene: style.scene }, library);
    if (style.familyId !== state.familyId) state = reduceExplorer(state, { type: "family", familyId: style.familyId }, library);
    render();
    updateLocation(windowObject, state);
    const card = cardGrid.querySelector(`[data-style-id="${style.id}"] .portrait-style-card-open`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest", inline: "nearest" });
    onTrack("style_featured_select", {
      scene: style.scene,
      targetId: style.id,
      targetLabel: style.label,
    });
    onSelectionChange(state, { type: "featured", styleId: style.id });
  }

  function renderFeatured() {
    featured.replaceChildren(...library.featuredStyleIds.map((styleId, index) => {
      const style = styleById.get(styleId);
      if (!style) return null;
      const button = documentObject.createElement("button");
      button.type = "button";
      button.className = "style-featured-button";
      button.dataset.styleId = style.id;
      button.setAttribute("aria-label", `南铂精选 ${index + 1}，${style.label}`);
      const number = documentObject.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      const label = documentObject.createElement("strong");
      label.textContent = style.label;
      button.append(number, label);
      bindPressFeedback(button);
      button.addEventListener("click", () => chooseFeatured(style));
      return button;
    }).filter(Boolean));
  }

  function render() {
    if (destroyed) return;
    renderSceneTabs();
    renderFamilyTabs();
    renderCards();
    presentView();
  }

  function openStyle(styleId) {
    const style = styleById.get(styleId);
    if (!style || style.visibility !== "published") return false;
    if (style.scene !== state.scene) state = reduceExplorer(state, { type: "scene", scene: style.scene }, library);
    if (style.familyId !== state.familyId) state = reduceExplorer(state, { type: "family", familyId: style.familyId }, library);
    state = reduceExplorer(state, {
      type: "open-style",
      styleId,
      scrollY: windowObject?.scrollY || 0,
    }, library);
    lastOpenedStyleId = style.id;
    viewerTriggerSlotId = "";
    renderAlbum(style);
    presentView();
    updateLocation(windowObject, state, "pushState");
    windowObject?.requestAnimationFrame?.(() => albumClose.focus({ preventScroll: true }));
    onTrack("style_open", {
      scene: style.scene,
      targetId: style.id,
      targetLabel: style.label,
    });
    onSelectionChange(state, { type: "open-style", style });
    return true;
  }

  function movePose(direction) {
    if (state.view !== "viewer") return null;
    const previousIndex = state.poseIndex;
    state = reduceExplorer(state, { type: "move-pose", direction }, library);
    presentView();
    updateLocation(windowObject, state, "replaceState");
    if (state.poseIndex !== previousIndex) {
      const style = styleById.get(state.styleId);
      onSelectionChange(state, { type: "move-pose", style, slot: style?.slots[state.poseIndex] });
    }
    return state.poseIndex;
  }

  function requestCloseViewer() {
    if (state.view !== "viewer") return false;
    if (windowObject?.history?.state?.styleExplorerView === "viewer") {
      windowObject.history.back();
      return true;
    }
    state = reduceExplorer(state, { type: "back" }, library);
    presentView();
    onSelectionChange(state, { type: "viewer-history-close" });
    restorePoseFocus();
    return true;
  }

  function requestCloseAlbum() {
    if (state.view !== "album") return false;
    if (windowObject?.history?.state?.styleExplorerView === "album") {
      windowObject.history.back();
      return true;
    }
    const scrollY = state.returnScrollY;
    lastOpenedStyleId = state.styleId;
    state = reduceExplorer(state, { type: "back" }, library);
    presentView();
    updateLocation(windowObject, state, "replaceState");
    restoreStyleCard(scrollY);
    onSelectionChange(state, { type: "album-close" });
    return true;
  }

  function restoreFromLocation(event) {
    const previous = state;
    const restored = createExplorerState(library, new URLSearchParams(windowObject?.location?.search || ""));
    const targetView = event?.state?.styleExplorerView || restored.view;
    const sameStyle = restored.styleId && restored.styleId === previous.styleId;

    if (previous.view === "viewer" && targetView !== "viewer" && restored.view === "album" && sameStyle) {
      state = reduceExplorer(previous, { type: "back" }, library);
    } else if (previous.view === "album" && restored.view === "styles") {
      lastOpenedStyleId = previous.styleId;
      state = reduceExplorer(previous, { type: "back" }, library);
    } else {
      state = {
        ...restored,
        returnScrollY: previous.familyId === restored.familyId ? previous.returnScrollY : restored.returnScrollY,
      };
    }

    if (targetView === "viewer" && state.view === "album") {
      const poseIndex = Number.isInteger(event?.state?.styleExplorerPoseIndex)
        ? event.state.styleExplorerPoseIndex : 0;
      state = reduceExplorer(state, { type: "open-pose", poseIndex }, library);
      const style = styleById.get(state.styleId);
      viewerTriggerSlotId = style?.slots[state.poseIndex]?.id || viewerTriggerSlotId;
    }

    const navigationChanged = previous.scene !== state.scene
      || previous.familyId !== state.familyId
      || !cardGrid.children.length;
    if (navigationChanged) {
      renderSceneTabs();
      renderFamilyTabs();
      renderCards();
    }
    presentView();

    if (previous.view === "viewer" && state.view !== "viewer") {
      onSelectionChange(state, { type: "viewer-history-close" });
      restorePoseFocus();
    } else if (state.view === "viewer" && previous.view !== "viewer") {
      openCurrentViewer();
      onSelectionChange(state, { type: "viewer-history-open" });
    } else {
      onSelectionChange(state, { type: "restore" });
    }
    if (previous.view === "album" && state.view === "styles") restoreStyleCard(state.returnScrollY);
    return state;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    windowObject?.removeEventListener("popstate", restoreFromLocation);
    clearImageSources(cardGrid);
    featured.replaceChildren();
    sceneTabs.replaceChildren();
    familyTabs.replaceChildren();
    cardGrid.replaceChildren();
    clearImageSources(albumGrid);
    albumGrid.replaceChildren();
    documentObject.body.classList.remove("style-album-open");
    if (windowObject?.history && previousScrollRestoration) {
      windowObject.history.scrollRestoration = previousScrollRestoration;
    }
  }

  bindPressFeedback(albumClose);
  albumClose.addEventListener("click", requestCloseAlbum);
  renderFeatured();
  render();
  root.hidden = false;
  windowObject?.addEventListener("popstate", restoreFromLocation);

  return {
    openStyle,
    movePose,
    requestCloseViewer,
    restoreFromLocation,
    destroy,
  };
}

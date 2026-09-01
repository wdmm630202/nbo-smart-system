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
  windowObject.history[method]?.({ ...windowObject.history.state, styleExplorer: true }, "", url);
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
  let state = createExplorerState(library, new URLSearchParams(windowObject?.location?.search || ""));
  let destroyed = false;

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
    root.dataset.view = state.view;
    root.dataset.scene = state.scene;
    root.dataset.familyId = state.familyId;
    album.dataset.styleId = state.styleId;
    album.hidden = true;
    renderSceneTabs();
    renderFamilyTabs();
    renderCards();
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
    root.dataset.view = state.view;
    root.dataset.styleId = style.id;
    album.dataset.styleId = style.id;
    updateLocation(windowObject, state, "pushState");
    onTrack("style_open", {
      scene: style.scene,
      targetId: style.id,
      targetLabel: style.label,
    });
    onSelectionChange(state, { type: "open-style", style });
    return true;
  }

  function restoreFromLocation() {
    state = createExplorerState(library, new URLSearchParams(windowObject?.location?.search || ""));
    render();
    onSelectionChange(state, { type: "restore" });
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
  }

  // Task 7 consumes the same callback when the 9-photo album is mounted.
  void onOpenViewer;
  renderFeatured();
  render();
  root.hidden = false;
  windowObject?.addEventListener("popstate", restoreFromLocation);

  return { openStyle, restoreFromLocation, destroy };
}

const defaultScene = "indoor";
const defaultFamilyId = "IN-01";
const allowedViews = new Set(["styles", "album", "viewer"]);

function readLocationValue(locationState, key) {
  if (locationState && typeof locationState.get === "function") return locationState.get(key) || "";
  return locationState?.[key] || "";
}

function findFamily(library, familyId) {
  return library.families.find((family) => family.id === familyId);
}

function findFirstFamily(library, scene) {
  return library.families.find((family) => family.scene === scene);
}

function defaultState(library) {
  const family = findFamily(library, defaultFamilyId) || findFirstFamily(library, defaultScene);
  if (!family) throw new Error("风格库缺少默认内景大类");
  return {
    scene: family.scene,
    familyId: family.id,
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  };
}

function assertLibrary(library) {
  if (!library || !Array.isArray(library.families) || !Array.isArray(library.styles)) {
    throw new Error("风格库格式无效");
  }
}

function requireFamilyInScene(library, familyId, scene) {
  const family = findFamily(library, familyId);
  if (!family || family.scene !== scene) throw new Error(`风格大类 ${familyId} 不属于当前场景`);
  return family;
}

function requireStyleInFamily(library, styleId, familyId, scene) {
  const style = library.styles.find((item) => item.id === styleId);
  if (!style || style.familyId !== familyId || style.scene !== scene || style.visibility !== "published") {
    throw new Error(`风格 ${styleId} 不属于当前大类、场景或未公开`);
  }
  return style;
}

function clampPoseIndex(poseIndex) {
  return Math.max(0, Math.min(8, poseIndex));
}

export function createExplorerState(library, locationState) {
  assertLibrary(library);
  const fallback = defaultState(library);
  const requestedScene = readLocationValue(locationState, "scene");
  const requestedFamilyId = readLocationValue(locationState, "family");
  const requestedStyleId = readLocationValue(locationState, "style");
  const style = requestedStyleId && library.styles.find((item) => item.id === requestedStyleId);
  const requestedFamily = requestedFamilyId && findFamily(library, requestedFamilyId);

  if (requestedStyleId && !style) return fallback;
  if (style && style.visibility !== "published") {
    const styleFamily = findFamily(library, style.familyId);
    if (!styleFamily || styleFamily.scene !== style.scene) return fallback;
    return { ...fallback, scene: style.scene, familyId: styleFamily.id };
  }
  if (requestedFamilyId && !requestedFamily) return fallback;

  const family = requestedFamily || (style && findFamily(library, style.familyId))
    || findFirstFamily(library, requestedScene || fallback.scene);
  const scene = requestedScene || family?.scene;
  if (!family || family.scene !== scene || (style && (style.scene !== scene || style.familyId !== family.id))) {
    return fallback;
  }
  if (!style || style.visibility !== "published") return { ...fallback, scene, familyId: family.id };

  return {
    scene,
    familyId: family.id,
    styleId: style.id,
    poseIndex: 0,
    view: "album",
    returnScrollY: 0,
  };
}

export function reduceExplorer(state, action, library) {
  assertLibrary(library);
  if (!state || !allowedViews.has(state.view)) throw new Error("风格浏览状态无效");
  if (!action || typeof action.type !== "string") throw new Error("未知风格交互");

  if (action.type === "scene") {
    const family = findFirstFamily(library, action.scene);
    if (!family) throw new Error(`场景 ${action.scene} 无效`);
    return { ...state, scene: action.scene, familyId: family.id, styleId: "", poseIndex: 0, view: "styles" };
  }
  if (action.type === "family") {
    requireFamilyInScene(library, action.familyId, state.scene);
    return { ...state, familyId: action.familyId, styleId: "", poseIndex: 0, view: "styles" };
  }
  if (action.type === "open-style") {
    requireStyleInFamily(library, action.styleId, state.familyId, state.scene);
    return {
      ...state,
      styleId: action.styleId,
      poseIndex: 0,
      view: "album",
      returnScrollY: Number.isFinite(action.scrollY) ? action.scrollY : 0,
    };
  }
  if (action.type === "open-pose") {
    if (state.view !== "album") throw new Error("只能从风格相册打开姿势查看器");
    if (!Number.isInteger(action.poseIndex)) throw new Error("姿势编号无效");
    return { ...state, poseIndex: clampPoseIndex(action.poseIndex), view: "viewer" };
  }
  if (action.type === "move-pose") {
    if (state.view !== "viewer" || !Number.isInteger(action.direction)) throw new Error("姿势切换无效");
    return { ...state, poseIndex: clampPoseIndex(state.poseIndex + action.direction) };
  }
  if (action.type === "back") {
    if (state.view === "viewer") return { ...state, poseIndex: 0, view: "album" };
    if (state.view === "album") return { ...state, styleId: "", poseIndex: 0, view: "styles" };
    return { ...state, poseIndex: 0, view: "styles" };
  }
  throw new Error(`未知风格交互 ${action.type}`);
}

export function serializeExplorerLocation(state) {
  if (!state || !allowedViews.has(state.view)) throw new Error("风格浏览状态无效");
  return new URLSearchParams([
    ["style", state.styleId],
    ["family", state.familyId],
    ["scene", state.scene],
  ]);
}

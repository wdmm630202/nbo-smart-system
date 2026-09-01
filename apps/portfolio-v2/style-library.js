const catalogKeys = new Set(["schemaVersion", "families", "styles", "featuredStyleIds"]);
const familyKeys = new Set(["id", "scene", "label", "description", "order"]);
const styleKeys = new Set([
  "id",
  "familyId",
  "scene",
  "label",
  "audience",
  "description",
  "legacyThemeIds",
  "order",
  "visibility",
]);
const assignmentDocumentKeys = new Set(["schemaVersion", "assignments"]);
const assignmentKeys = new Set(["slots", "coverPosition", "maturity", "updatedAt"]);
const slotAssignmentKeys = new Set(["assetId", "poseLabel", "source", "updatedAt"]);
const styleIdPattern = /^ST-(IN|OUT)-(0[1-6])-(0[1-9]|1[01])$/;
const familyIdPattern = /^(IN|OUT)-0[1-6]$/;
const validScenes = new Set(["indoor", "outdoor"]);
const validVisibility = new Set(["published", "archived"]);
const validMaturity = new Set(["reference", "updating", "complete"]);

function assertRecord(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label}格式无效`);
}

function assertAllowedKeys(value, allowedKeys, label) {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`${label}不允许字段 ${unknownKey}`);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}字段格式无效`);
  return value.trim();
}

function normalizeTimestamp(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label}字段格式无效`);
  }
  return value;
}

function scenePrefix(scene) {
  return scene === "indoor" ? "IN" : "OUT";
}

function validateAsset(asset, assetId) {
  assertRecord(asset, `公共资产 ${assetId}`);
  if (!Number.isInteger(asset.id) || asset.id !== assetId) throw new Error(`公共资产 ${assetId} 编号无效`);
  if (!validScenes.has(asset.scene)) throw new Error(`公共资产 ${assetId} 场景字段格式无效`);
  requireText(asset.theme, `公共资产 ${assetId} 主题`);
  requireText(asset.thumb, `公共资产 ${assetId} 缩略图`);
  requireText(asset.full, `公共资产 ${assetId} 原图`);
  return asset;
}

export function styleSlotId(styleId, position) {
  if (!styleIdPattern.test(styleId)) throw new Error("风格编号无效");
  if (!Number.isInteger(position) || position < 1 || position > 9) throw new Error("照片位必须在 1–9 之间");
  return `${styleId}-P${String(position).padStart(2, "0")}`;
}

export function normalizeStyleCatalog(value) {
  assertRecord(value, "风格目录");
  assertAllowedKeys(value, catalogKeys, "风格目录顶层");
  if (value.schemaVersion !== 1 || !Array.isArray(value.families) || !Array.isArray(value.styles)) {
    throw new Error("风格目录格式无效");
  }
  if (value.families.length !== 12) throw new Error("风格目录必须包含 12 个大类");
  if (value.styles.length !== 132) throw new Error("风格目录必须包含 132 个风格");
  if (!Array.isArray(value.featuredStyleIds)) throw new Error("风格目录格式无效");

  const familyIds = new Set();
  const familyOrders = { indoor: new Set(), outdoor: new Set() };
  const families = value.families.map((family) => {
    assertRecord(family, "风格大类");
    assertAllowedKeys(family, familyKeys, "风格大类");
    const id = requireText(family.id, "风格大类编号");
    const match = id.match(familyIdPattern);
    if (!match || familyIds.has(id)) throw new Error(`风格大类编号 ${id} 无效或重复`);
    if (!validScenes.has(family.scene) || scenePrefix(family.scene) !== match[1]) {
      throw new Error(`风格大类 ${id} 场景字段格式无效`);
    }
    if (!Number.isInteger(family.order) || family.order < 1 || family.order > 6 || familyOrders[family.scene].has(family.order)) {
      throw new Error(`风格大类 ${id} 排序字段格式无效`);
    }
    familyIds.add(id);
    familyOrders[family.scene].add(family.order);
    return {
      id,
      scene: family.scene,
      label: requireText(family.label, `风格大类 ${id} 名称`),
      description: requireText(family.description, `风格大类 ${id} 描述`),
      order: family.order,
    };
  });
  if (families.filter(({ scene }) => scene === "indoor").length !== 6
    || families.filter(({ scene }) => scene === "outdoor").length !== 6) {
    throw new Error("风格目录必须包含内外景各 6 个大类");
  }

  const familyById = new Map(families.map((family) => [family.id, family]));
  const styleIds = new Set();
  const stylesByFamily = new Map(families.map(({ id }) => [id, []]));
  const styleOrders = new Map(families.map(({ id }) => [id, new Set()]));
  const styles = value.styles.map((style) => {
    assertRecord(style, "风格");
    assertAllowedKeys(style, styleKeys, "风格");
    const id = requireText(style.id, "风格编号");
    const match = id.match(styleIdPattern);
    if (!match || styleIds.has(id)) throw new Error(`风格编号 ${id} 无效或重复`);
    const familyId = requireText(style.familyId, `风格 ${id} 大类`);
    const family = familyById.get(familyId);
    if (!family || family.scene !== style.scene || familyId !== `${match[1]}-${match[2]}`) {
      throw new Error(`风格 ${id} 大类或场景无效`);
    }
    if (!validScenes.has(style.scene) || scenePrefix(style.scene) !== match[1]) {
      throw new Error(`风格 ${id} 场景字段格式无效`);
    }
    if (!Number.isInteger(style.order) || style.order < 1 || style.order > 11 || styleOrders.get(familyId).has(style.order)) {
      throw new Error(`风格 ${id} 排序字段格式无效`);
    }
    if (!Array.isArray(style.legacyThemeIds) || style.legacyThemeIds.some((themeId) => typeof themeId !== "string" || !themeId.trim())
      || new Set(style.legacyThemeIds).size !== style.legacyThemeIds.length) {
      throw new Error(`风格 ${id} 历史主题字段格式无效`);
    }
    if (!validVisibility.has(style.visibility)) throw new Error(`风格 ${id} 可见性无效`);
    styleIds.add(id);
    styleOrders.get(familyId).add(style.order);
    stylesByFamily.get(familyId).push(id);
    return {
      id,
      familyId,
      scene: style.scene,
      label: requireText(style.label, `风格 ${id} 名称`),
      audience: requireText(style.audience, `风格 ${id} 人群`),
      description: requireText(style.description, `风格 ${id} 描述`),
      legacyThemeIds: [...style.legacyThemeIds],
      order: style.order,
      visibility: style.visibility,
    };
  });
  if (styles.filter(({ scene }) => scene === "indoor").length !== 66
    || styles.filter(({ scene }) => scene === "outdoor").length !== 66
    || [...stylesByFamily.values()].some((ids) => ids.length !== 11)) {
    throw new Error("风格目录必须包含内外景各 66 个风格且每个大类 11 个风格");
  }

  if (value.featuredStyleIds.length !== 8 || new Set(value.featuredStyleIds).size !== 8
    || value.featuredStyleIds.some((id) => typeof id !== "string" || !styleIds.has(id))) {
    throw new Error("风格目录必须包含 8 个不重复的精选风格");
  }
  const featuredScenes = value.featuredStyleIds.map((id) => styles.find((style) => style.id === id).scene);
  if (featuredScenes.filter((scene) => scene === "indoor").length < 3
    || featuredScenes.filter((scene) => scene === "outdoor").length < 3) {
    throw new Error("精选风格至少包含 3 个内景和 3 个外景");
  }

  return {
    schemaVersion: 1,
    families,
    styles,
    featuredStyleIds: [...value.featuredStyleIds],
  };
}

export function normalizeStyleAssignments(value, catalog, assetMap) {
  assertRecord(value, "照片位清单");
  assertAllowedKeys(value, assignmentDocumentKeys, "照片位清单顶层");
  if (value.schemaVersion !== 1) throw new Error("照片位清单格式无效");
  assertRecord(value.assignments, "照片位分配");
  if (!(assetMap instanceof Map)) throw new Error("公共资产索引格式无效");

  const normalizedCatalog = normalizeStyleCatalog(catalog);
  const styleById = new Map(normalizedCatalog.styles.map((style) => [style.id, style]));
  const assignmentIds = Object.keys(value.assignments);
  if (assignmentIds.length !== styleById.size || assignmentIds.some((id) => !styleById.has(id))) {
    throw new Error("照片位分配必须覆盖全部 132 个风格");
  }

  const assignments = Object.fromEntries(normalizedCatalog.styles.map((style) => {
    const assignment = value.assignments[style.id];
    assertRecord(assignment, `风格 ${style.id} 照片位分配`);
    assertAllowedKeys(assignment, assignmentKeys, `风格 ${style.id} 照片位分配`);
    if (!Array.isArray(assignment.slots) || assignment.slots.length !== 9) {
      throw new Error(`风格 ${style.id} 必须包含 9 个照片位`);
    }
    if (!Number.isInteger(assignment.coverPosition) || assignment.coverPosition < 1 || assignment.coverPosition > 9) {
      throw new Error(`风格 ${style.id} 封面位置无效`);
    }
    if (!validMaturity.has(assignment.maturity)) throw new Error(`风格 ${style.id} 成熟度无效`);
    const updatedAt = normalizeTimestamp(assignment.updatedAt, `风格 ${style.id} 更新时间`);
    const assetIds = new Set();
    const slots = assignment.slots.map((slot, index) => {
      assertRecord(slot, `风格 ${style.id} 照片位 ${index + 1}`);
      assertAllowedKeys(slot, slotAssignmentKeys, `风格 ${style.id} 照片位 ${index + 1}`);
      if (!Number.isInteger(slot.assetId)) throw new Error(`风格 ${style.id} 照片位 ${index + 1} 资产编号无效`);
      const asset = assetMap.get(slot.assetId);
      if (!asset) throw new Error(`风格 ${style.id} 照片位 ${index + 1} 公共资产不存在`);
      validateAsset(asset, slot.assetId);
      if (asset.scene !== style.scene) throw new Error(`风格 ${style.id} 照片位 ${index + 1} 资产场景不一致`);
      if (assetIds.has(slot.assetId)) throw new Error(`风格 ${style.id} 必须使用 9 个不重复资产`);
      if (slot.source !== "seed" && slot.source !== "upload") throw new Error(`风格 ${style.id} 照片位 ${index + 1} 来源无效`);
      const slotUpdatedAt = normalizeTimestamp(slot.updatedAt, `风格 ${style.id} 照片位 ${index + 1} 更新时间`);
      if (slot.source !== "upload" && slotUpdatedAt !== null) {
        throw new Error(`风格 ${style.id} 照片位 ${index + 1} 只有 upload 来源可以设置更新时间`);
      }
      assetIds.add(slot.assetId);
      return {
        assetId: slot.assetId,
        poseLabel: requireText(slot.poseLabel, `风格 ${style.id} 照片位 ${index + 1} poseLabel`),
        source: slot.source,
        updatedAt: slotUpdatedAt,
      };
    });
    return [style.id, {
      slots,
      coverPosition: assignment.coverPosition,
      maturity: assignment.maturity,
      updatedAt,
    }];
  }));

  return { schemaVersion: 1, assignments };
}

export function buildStyleLibrary({ catalog, assignments, assets }) {
  if (!Array.isArray(assets)) throw new Error("公共资产列表格式无效");
  const normalizedCatalog = normalizeStyleCatalog(catalog);
  for (const asset of assets) {
    assertRecord(asset, "公共资产");
    if (!Number.isInteger(asset.id)) throw new Error("公共资产编号无效");
    validateAsset(asset, asset.id);
  }
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  if (assetMap.size !== assets.length) throw new Error("公共资产编号重复或无效");
  const normalizedAssignments = normalizeStyleAssignments(assignments, normalizedCatalog, assetMap);
  const slots = normalizedCatalog.styles.flatMap((style) =>
    normalizedAssignments.assignments[style.id].slots.map((assignment, index) => ({
      id: styleSlotId(style.id, index + 1),
      styleId: style.id,
      position: index + 1,
      assetId: assignment.assetId,
      asset: assetMap.get(assignment.assetId),
      poseLabel: assignment.poseLabel,
      source: assignment.source,
      updatedAt: assignment.updatedAt,
      isCover: normalizedAssignments.assignments[style.id].coverPosition === index + 1,
    })),
  );
  return {
    families: normalizedCatalog.families,
    featuredStyleIds: normalizedCatalog.featuredStyleIds,
    styles: normalizedCatalog.styles.map((style) => ({
      ...style,
      ...normalizedAssignments.assignments[style.id],
      slots: slots.filter((slot) => slot.styleId === style.id),
    })),
    slots,
    counts: {
      styles: normalizedCatalog.styles.length,
      publishedStyles: normalizedCatalog.styles.filter(({ visibility }) => visibility === "published").length,
      indoor: normalizedCatalog.styles.filter(({ scene }) => scene === "indoor").length,
      outdoor: normalizedCatalog.styles.filter(({ scene }) => scene === "outdoor").length,
      slots: slots.length,
      assets: assetMap.size,
    },
  };
}

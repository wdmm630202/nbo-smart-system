import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  buildPortfolioItems,
  emptyPortfolioAdditions,
  normalizePortfolioAdditions,
  portfolioCatalog,
} from "../apps/portfolio-v2/catalog.js";
import {
  normalizeStyleAssignments,
  normalizeStyleCatalog,
  styleSlotId,
} from "../apps/portfolio-v2/style-library.js";
import {
  probeImage,
  renderPhotoDerivatives,
  slotCode,
  slotFilename,
  validateIncomingImage,
} from "./portfolio-photo-lib.mjs";

const uploadLimit = 50 * 1024 * 1024;
const allowedImageCodecs = new Set(["mjpeg", "jpeg", "png", "webp"]);
const mutableStyleVisibilities = new Set(["published", "hidden"]);
const validMaturities = new Set(["reference", "updating", "complete"]);

function timestampName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-style-${process.pid}-${randomBytes(5).toString("hex")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function normalizeStoreCatalog(value) {
  const validationValue = clone(value);
  if (Array.isArray(validationValue.styles)) {
    for (const style of validationValue.styles) {
      if (style?.visibility === "hidden") style.visibility = "archived";
    }
  }
  const normalized = normalizeStyleCatalog(validationValue);
  const visibilityById = new Map((value.styles || []).map((style) => [style.id, style.visibility]));
  return {
    ...normalized,
    styles: normalized.styles.map((style) => ({
      ...style,
      visibility: visibilityById.get(style.id) === "hidden" ? "hidden" : style.visibility,
    })),
  };
}

function validationCatalog(catalog) {
  return {
    ...catalog,
    styles: catalog.styles.map((style) => ({
      ...style,
      visibility: style.visibility === "hidden" ? "archived" : style.visibility,
    })),
  };
}

function publicAsset(id, photo) {
  const base = slotFilename(id);
  return {
    ...photo,
    id,
    thumb: `../portfolio/assets/photos/thumbs/${base}.webp`,
    full: `../portfolio/assets/photos/full/${base}.jpg`,
  };
}

function buildAssets(additions) {
  const legacy = buildPortfolioItems(portfolioCatalog, emptyPortfolioAdditions)
    .map((photo) => publicAsset(photo.id, photo));
  const additionsById = new Map(additions.photos.map((photo) => [photo.id, photo]));
  const added = additions.photos.map((photo) => publicAsset(photo.id, photo));
  const assets = [...legacy, ...added];
  const assetById = Object.fromEntries(assets.map((asset) => [asset.id, asset]));
  return {
    assets,
    assetById,
    assetIds: [...new Set([
      ...Array.from({ length: portfolioCatalog.photoCount }, (_, index) => index + 1),
      ...additionsById.keys(),
    ])].sort((left, right) => left - right),
  };
}

function requireExactKeys(value, keys, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label}格式无效`);
  const allowed = new Set(keys);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw new Error(`${label}不允许字段 ${extra}`);
  const missing = keys.find((key) => !(key in value));
  if (missing) throw new Error(`${label}缺少字段 ${missing}`);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}格式无效`);
  return value.trim();
}

export function createPortfolioStyleStore({ rootDir, photoRoot, additionsPath, catalogPath, assignmentsPath }) {
  for (const [label, value] of Object.entries({ rootDir, photoRoot, additionsPath, catalogPath, assignmentsPath })) {
    if (typeof value !== "string" || !value) throw new Error(`${label}路径无效`);
  }
  const transactionRoot = join(rootDir, ".local/portfolio-style-transactions");
  const allowedManifestPaths = new Set([
    resolve(additionsPath),
    resolve(catalogPath),
    resolve(assignmentsPath),
  ]);
  let mutationTail = Promise.resolve();

  function assertAllowedTarget(path) {
    const target = resolve(path);
    if (allowedManifestPaths.has(target)) return;
    const photoPath = relative(resolve(photoRoot), target).split(sep).join("/");
    const match = photoPath.match(/^(?:full\/photo-(\d{3,})\.jpg|thumbs\/photo-(\d{3,})\.webp)$/);
    const assetId = Number(match?.[1] || match?.[2]);
    if (!match || !Number.isSafeInteger(assetId) || assetId <= portfolioCatalog.photoCount) {
      throw new Error("风格事务记录包含越界或历史资产路径");
    }
  }

  function assertJournalOutput(output) {
    if (!output || Array.isArray(output) || typeof output !== "object") {
      throw new Error("风格事务输出记录无效");
    }
    if (!/^[a-z][a-z0-9-]*$/.test(output.key)
      || !["write", "delete"].includes(output.action)
      || !["file", "missing", "directory", "other"].includes(output.beforeKind)
      || typeof output.target !== "string") {
      throw new Error("风格事务输出记录无效");
    }
    assertAllowedTarget(output.target);
    if (output.temporaryPath) {
      const target = resolve(output.target);
      const temporary = resolve(output.temporaryPath);
      if (dirname(temporary) !== dirname(target)
        || !basename(temporary).startsWith(`${basename(target)}.tmp-style-`)) {
        throw new Error("风格事务临时路径越界");
      }
    }
  }

  async function snapshotOutput(transactionDir, output, token) {
    assertAllowedTarget(output.target);
    const beforePath = join(transactionDir, "before", output.key);
    let beforeKind = "missing";
    try {
      const info = await stat(output.target);
      beforeKind = info.isFile() ? "file" : (info.isDirectory() ? "directory" : "other");
      if (beforeKind === "file") await copyFile(output.target, beforePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let temporaryPath = "";
    if (output.action === "write") {
      await mkdir(dirname(output.target), { recursive: true });
      temporaryPath = `${output.target}.tmp-style-${token}`;
      if (output.sourcePath) await copyFile(output.sourcePath, temporaryPath);
      else await writeFile(temporaryPath, output.content);
    }
    return {
      action: output.action,
      beforeKind,
      key: output.key,
      target: output.target,
      temporaryPath,
    };
  }

  async function restoreOutputs(transactionDir, outputs) {
    const errors = [];
    for (const output of [...outputs].reverse()) {
      try {
        assertJournalOutput(output);
        if (output.beforeKind === "file") {
          const restorePath = `${output.target}.tmp-style-restore-${randomBytes(5).toString("hex")}`;
          await copyFile(join(transactionDir, "before", output.key), restorePath);
          await rename(restorePath, output.target);
        } else if (output.beforeKind === "missing") {
          await rm(output.target, { force: true });
        }
        if (output.temporaryPath) await rm(output.temporaryPath, { force: true });
      } catch (error) {
        errors.push(`${output.key}: ${error.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join("；"));
  }

  async function cleanupPreparedOutputs(outputs) {
    for (const output of outputs) assertJournalOutput(output);
    await Promise.all(outputs
      .filter((output) => output.temporaryPath)
      .map((output) => rm(output.temporaryPath, { force: true }).catch(() => {})));
  }

  async function recoverTransactions() {
    let entries = [];
    try {
      entries = (await readdir(transactionRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const transactionDir = join(transactionRoot, entry);
      const metaPath = join(transactionDir, "meta.json");
      let meta;
      try {
        meta = await readJson(metaPath);
      } catch {
        // Undo deliberately skips corrupt history. A valid journal is written
        // atomically before any public output is touched.
        continue;
      }
      if (!Array.isArray(meta.outputs)) continue;
      if (["prepared", "committing", "rolling-back"].includes(meta.status)) {
        try {
          if (meta.status === "prepared") await cleanupPreparedOutputs(meta.outputs);
          else await restoreOutputs(transactionDir, meta.outputs);
          await writeJsonAtomic(metaPath, {
            ...meta,
            status: "rolled-back",
            recoveredAt: new Date().toISOString(),
          });
        } catch (error) {
          throw new Error(`风格事务自动恢复失败：${transactionDir}；${error.message}`);
        }
      }
    }
  }

  async function commitTransaction({ operation, context = {}, outputs }) {
    const token = `${timestampName()}-${randomBytes(5).toString("hex")}`;
    const transactionDir = join(transactionRoot, token);
    const metaPath = join(transactionDir, "meta.json");
    await mkdir(join(transactionDir, "before"), { recursive: true });
    const prepared = [];
    let meta = {
      schemaVersion: 1,
      operation,
      status: "preparing",
      createdAt: new Date().toISOString(),
      ...context,
      outputs: prepared,
    };
    try {
      for (const output of outputs) prepared.push(await snapshotOutput(transactionDir, output, token));
      meta = { ...meta, status: "prepared", outputs: prepared };
      await writeJsonAtomic(metaPath, meta);
      meta = { ...meta, status: "committing" };
      await writeJsonAtomic(metaPath, meta);
      for (const output of prepared) {
        if (output.action === "write") await rename(output.temporaryPath, output.target);
        else if (output.action === "delete") await rm(output.target, { force: true });
      }
      meta = { ...meta, status: "committed", committedAt: new Date().toISOString() };
      await writeJsonAtomic(metaPath, meta);
      return meta;
    } catch (error) {
      try {
        if (prepared.length) {
          await writeJsonAtomic(metaPath, { ...meta, status: "rolling-back", error: error.message }).catch(() => {});
          await restoreOutputs(transactionDir, prepared);
        }
        await writeJsonAtomic(metaPath, {
          ...meta,
          outputs: prepared,
          status: "rolled-back",
          error: error.message,
          rolledBackAt: new Date().toISOString(),
        });
      } catch (rollbackError) {
        throw new Error(`${error.message}；事务回滚失败：${rollbackError.message}`);
      }
      throw error;
    }
  }

  async function readState() {
    await recoverTransactions();
    const [rawCatalog, rawAssignments, rawAdditions] = await Promise.all([
      readJson(catalogPath),
      readJson(assignmentsPath),
      readJson(additionsPath),
    ]);
    const catalog = normalizeStoreCatalog(rawCatalog);
    const additions = normalizePortfolioAdditions(rawAdditions);
    const { assets, assetById, assetIds } = buildAssets(additions);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const assignments = normalizeStyleAssignments(rawAssignments, validationCatalog(catalog), assetMap);
    const slotById = {};
    const slots = [];
    const styles = catalog.styles.map((style) => {
      const layout = assignments.assignments[style.id];
      const styleSlots = layout.slots.map((slot, index) => {
        const value = {
          ...slot,
          id: styleSlotId(style.id, index + 1),
          styleId: style.id,
          position: index + 1,
          isCover: layout.coverPosition === index + 1,
          asset: assetById[slot.assetId],
          style,
        };
        slots.push(value);
        slotById[value.id] = value;
        return value;
      });
      return { ...style, ...layout, slots: styleSlots };
    });
    return {
      additions,
      assignments,
      catalog,
      assets,
      assetById,
      assetIds,
      assetCount: assetIds.length,
      families: catalog.families,
      styles,
      slots,
      slotById,
      counts: {
        styles: styles.length,
        slots: slots.length,
        assets: assetIds.length,
        indoor: styles.filter((style) => style.scene === "indoor").length,
        outdoor: styles.filter((style) => style.scene === "outdoor").length,
        publishedStyles: styles.filter((style) => style.visibility === "published").length,
      },
    };
  }

  async function prepareNewAsset(assetId, inputPath) {
    const sourceStat = await stat(inputPath);
    if (!sourceStat.isFile() || sourceStat.size < 1) throw new Error("请选择有效的图片文件");
    if (sourceStat.size > uploadLimit) throw new Error("图片超过 50 MB，请先导出精修 JPG");
    const sourceInfo = await probeImage(inputPath);
    if (!allowedImageCodecs.has(sourceInfo.codec)) throw new Error("只支持 JPG、PNG 或 WebP 图片");
    validateIncomingImage(sourceInfo);
    const directory = await mkdtemp(join(tmpdir(), `nanbo-style-${slotFilename(assetId)}-`));
    const generated = {
      full: join(directory, "full.jpg"),
      thumb: join(directory, "thumb.webp"),
    };
    try {
      await renderPhotoDerivatives(inputPath, generated);
      const [fullInfo, thumbInfo] = await Promise.all([
        probeImage(generated.full),
        probeImage(generated.thumb),
      ]);
      if (fullInfo.width !== 1080 || fullInfo.height !== 1440
        || thumbInfo.width !== 480 || thumbInfo.height !== 640) {
        throw new Error("生成图片尺寸校验失败，公开清单未修改");
      }
      return { directory, generated, sourceInfo };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  function enqueueMutation(work) {
    const result = mutationTail.then(work, work);
    mutationTail = result.catch(() => {});
    return result;
  }

  async function replaceSlot(input) {
    requireExactKeys(input, ["slotId", "inputPath", "originalName"], "替换照片位");
    const slotId = requireText(input.slotId, "照片位编号");
    const inputPath = requireText(input.inputPath, "上传文件路径");
    const originalName = requireText(input.originalName, "原始文件名");
    return enqueueMutation(async () => {
      const state = await readState();
      const slot = state.slotById[slotId];
      if (!slot) throw new Error("照片位不存在");
      const assetId = Math.max(...state.assetIds) + 1;
      const prepared = await prepareNewAsset(assetId, inputPath);
      try {
        const now = new Date().toISOString();
        const assignments = clone(state.assignments);
        const targetLayout = assignments.assignments[slot.styleId];
        const previousAssignment = clone(targetLayout.slots[slot.position - 1]);
        const previousLayoutUpdatedAt = targetLayout.updatedAt;
        targetLayout.slots[slot.position - 1] = {
          ...previousAssignment,
          assetId,
          source: "upload",
          updatedAt: now,
        };
        targetLayout.updatedAt = now;
        const baseAsset = state.assetById[slot.assetId];
        const additions = clone(state.additions);
        additions.photos.push({
          id: assetId,
          scene: slot.style.scene,
          theme: baseAsset.theme,
          category: baseAsset.category,
          title: slot.style.label,
          styleTitle: baseAsset.styleTitle,
          featured: false,
          visibility: "published",
          publishedAt: now,
        });
        const normalizedAdditions = normalizePortfolioAdditions(additions);
        const fullTarget = join(photoRoot, "full", `${slotFilename(assetId)}.jpg`);
        const thumbTarget = join(photoRoot, "thumbs", `${slotFilename(assetId)}.webp`);
        await commitTransaction({
          operation: "replace-slot",
          context: {
            slotId,
            assetId,
            previousAssetId: slot.assetId,
            previousAssignment,
            previousLayoutUpdatedAt,
            originalName,
          },
          outputs: [
            { key: "full", action: "write", target: fullTarget, sourcePath: prepared.generated.full },
            { key: "thumb", action: "write", target: thumbTarget, sourcePath: prepared.generated.thumb },
            { key: "additions", action: "write", target: additionsPath, content: `${JSON.stringify(normalizedAdditions, null, 2)}\n` },
            { key: "assignments", action: "write", target: assignmentsPath, content: `${JSON.stringify(assignments, null, 2)}\n` },
          ],
        });
        return { assetId, code: slotCode(assetId), slotId };
      } finally {
        await rm(prepared.directory, { recursive: true, force: true });
      }
    });
  }

  function hasCompletePreviousAssignment(meta, state, slot) {
    const assignment = meta.previousAssignment;
    if (!assignment || Array.isArray(assignment) || typeof assignment !== "object") return false;
    const keys = Object.keys(assignment).sort();
    if (keys.join(",") !== "assetId,poseLabel,source,updatedAt") return false;
    if (!Number.isInteger(meta.previousAssetId) || assignment.assetId !== meta.previousAssetId) return false;
    const previousAsset = state.assetById[assignment.assetId];
    if (!previousAsset || previousAsset.scene !== slot.style.scene) return false;
    if (typeof assignment.poseLabel !== "string" || !assignment.poseLabel.trim()) return false;
    if (!new Set(["seed", "upload"]).has(assignment.source)) return false;
    const validUpdatedAt = assignment.updatedAt === null
      || (typeof assignment.updatedAt === "string" && !Number.isNaN(Date.parse(assignment.updatedAt)));
    if (!validUpdatedAt || (assignment.source === "seed" && assignment.updatedAt !== null)) return false;
    return meta.previousLayoutUpdatedAt === null
      || (typeof meta.previousLayoutUpdatedAt === "string" && !Number.isNaN(Date.parse(meta.previousLayoutUpdatedAt)));
  }

  async function availableReplacementHistory(slotId, currentAssetId, state, slot) {
    let entries = [];
    try {
      entries = (await readdir(transactionRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const consumed = new Set();
    const history = [];
    for (const entry of entries) {
      try {
        const meta = await readJson(join(transactionRoot, entry, "meta.json"));
        if (meta.status !== "committed") continue;
        if (meta.operation === "undo-slot" && typeof meta.sourceTransaction === "string") {
          consumed.add(meta.sourceTransaction);
        }
        history.push({ entry, meta });
      } catch {
        // Match legacy undo: a corrupt newest entry must not hide an older,
        // complete replacement.
      }
    }
    for (const item of history) {
      const { entry, meta } = item;
      if (meta.operation !== "replace-slot" || meta.slotId !== slotId || consumed.has(entry)) continue;
      const addition = state.additions.photos.find((photo) => photo.id === meta.assetId);
      if (!Number.isInteger(meta.assetId) || meta.assetId <= portfolioCatalog.photoCount
        || !addition || addition.visibility !== "published" || meta.assetId !== currentAssetId
        || !hasCompletePreviousAssignment(meta, state, slot)) continue;
      const fullPath = join(photoRoot, "full", `${slotFilename(meta.assetId)}.jpg`);
      const thumbPath = join(photoRoot, "thumbs", `${slotFilename(meta.assetId)}.webp`);
      try {
        const [fullInfo, thumbInfo] = await Promise.all([stat(fullPath), stat(thumbPath)]);
        if (!fullInfo.isFile() || !thumbInfo.isFile()) continue;
      } catch {
        continue;
      }
      return { entry, meta, fullPath, thumbPath };
    }
    return null;
  }

  async function undoSlot(slotIdValue) {
    const slotId = requireText(slotIdValue, "照片位编号");
    return enqueueMutation(async () => {
      const state = await readState();
      const slot = state.slotById[slotId];
      if (!slot) throw new Error("照片位不存在");
      const history = await availableReplacementHistory(slotId, slot.assetId, state, slot);
      if (!history) throw new Error(`${slotId} 没有更早的可用备份`);

      const assignments = clone(state.assignments);
      const targetLayout = assignments.assignments[slot.styleId];
      targetLayout.slots[slot.position - 1] = clone(history.meta.previousAssignment);
      targetLayout.updatedAt = history.meta.previousLayoutUpdatedAt ?? null;
      const remainingSlotReference = Object.values(assignments.assignments)
        .some((layout) => layout.slots.some((assignment) => assignment.assetId === history.meta.assetId));
      const otherCatalogReference = state.additions.themes
        .some((theme) => Number(theme.coverPhotoId) === history.meta.assetId);
      const removeAsset = !remainingSlotReference && !otherCatalogReference;
      const additions = clone(state.additions);
      if (removeAsset) {
        additions.photos = additions.photos.filter((photo) => photo.id !== history.meta.assetId);
      }
      const normalizedAdditions = normalizePortfolioAdditions(additions);
      const outputs = [];
      if (removeAsset) {
        outputs.push(
          { key: "full", action: "delete", target: history.fullPath },
          { key: "thumb", action: "delete", target: history.thumbPath },
        );
      }
      outputs.push(
        { key: "additions", action: "write", target: additionsPath, content: `${JSON.stringify(normalizedAdditions, null, 2)}\n` },
        { key: "assignments", action: "write", target: assignmentsPath, content: `${JSON.stringify(assignments, null, 2)}\n` },
      );
      await commitTransaction({
        operation: "undo-slot",
        context: {
          sourceTransaction: history.entry,
          slotId,
          assetId: history.meta.assetId,
          restoredAssetId: history.meta.previousAssetId,
          removedAssetId: removeAsset ? history.meta.assetId : null,
        },
        outputs,
      });
      return {
        slotId,
        restoredAssetId: history.meta.previousAssetId,
        removedAssetId: removeAsset ? history.meta.assetId : null,
      };
    });
  }

  function manifestOutputs(catalog, assignments) {
    return [
      { key: "catalog", action: "write", target: catalogPath, content: `${JSON.stringify(catalog, null, 2)}\n` },
      { key: "assignments", action: "write", target: assignmentsPath, content: `${JSON.stringify(assignments, null, 2)}\n` },
    ];
  }

  async function updateLayout(input) {
    requireExactKeys(input, ["styleId", "orderedSlotIds", "coverSlotId", "maturity"], "风格布局");
    const styleId = requireText(input.styleId, "风格编号");
    const coverSlotId = requireText(input.coverSlotId, "封面照片位");
    if (!Array.isArray(input.orderedSlotIds) || input.orderedSlotIds.length !== 9
      || input.orderedSlotIds.some((slotId) => typeof slotId !== "string")
      || new Set(input.orderedSlotIds).size !== 9) {
      throw new Error("风格布局必须提供 9 个不重复的完整照片位");
    }
    if (!validMaturities.has(input.maturity)) throw new Error("风格成熟度无效");
    return enqueueMutation(async () => {
      const state = await readState();
      const style = state.styles.find((item) => item.id === styleId);
      if (!style) throw new Error("风格不存在");
      const currentIds = new Set(style.slots.map((slot) => slot.id));
      if (input.orderedSlotIds.some((slotId) => !currentIds.has(slotId)) || !currentIds.has(coverSlotId)) {
        throw new Error("风格布局必须完整使用该风格的 9 个照片位");
      }
      const assignments = clone(state.assignments);
      const layout = assignments.assignments[styleId];
      const currentById = new Map(style.slots.map((slot) => [
        slot.id,
        state.assignments.assignments[styleId].slots[slot.position - 1],
      ]));
      layout.slots = input.orderedSlotIds.map((slotId) => clone(currentById.get(slotId)));
      layout.coverPosition = input.orderedSlotIds.indexOf(coverSlotId) + 1;
      layout.maturity = input.maturity;
      layout.updatedAt = new Date().toISOString();
      normalizeStyleAssignments(assignments, validationCatalog(state.catalog), new Map(state.assets.map((asset) => [asset.id, asset])));
      await commitTransaction({
        operation: "update-layout",
        context: { styleId },
        outputs: manifestOutputs(state.catalog, assignments),
      });
      return { styleId, coverPosition: layout.coverPosition, maturity: layout.maturity };
    });
  }

  async function updateStyleMeta(input) {
    requireExactKeys(input, ["styleId", "label", "audience", "description", "visibility"], "风格资料");
    const styleId = requireText(input.styleId, "风格编号");
    const label = requireText(input.label, "风格名称");
    const audience = requireText(input.audience, "适合人群");
    const description = requireText(input.description, "风格说明");
    if (!mutableStyleVisibilities.has(input.visibility)) throw new Error("风格可见性只能是 published 或 hidden");
    return enqueueMutation(async () => {
      const state = await readState();
      const catalog = clone(state.catalog);
      const index = catalog.styles.findIndex((style) => style.id === styleId);
      if (index < 0) throw new Error("风格不存在");
      catalog.styles[index] = {
        ...catalog.styles[index],
        label,
        audience,
        description,
        visibility: input.visibility,
      };
      const normalizedCatalog = normalizeStoreCatalog(catalog);
      await commitTransaction({
        operation: "update-style-meta",
        context: { styleId },
        outputs: manifestOutputs(normalizedCatalog, state.assignments),
      });
      return { styleId, label, audience, description, visibility: input.visibility };
    });
  }

  async function updateSlotMeta(input) {
    requireExactKeys(input, ["slotId", "poseLabel"], "照片位资料");
    const slotId = requireText(input.slotId, "照片位编号");
    const poseLabel = requireText(input.poseLabel, "姿势标签");
    return enqueueMutation(async () => {
      const state = await readState();
      const slot = state.slotById[slotId];
      if (!slot) throw new Error("照片位不存在");
      const assignments = clone(state.assignments);
      const current = assignments.assignments[slot.styleId].slots[slot.position - 1];
      assignments.assignments[slot.styleId].slots[slot.position - 1] = {
        ...current,
        poseLabel,
      };
      normalizeStyleAssignments(assignments, validationCatalog(state.catalog), new Map(state.assets.map((asset) => [asset.id, asset])));
      await commitTransaction({
        operation: "update-slot-meta",
        context: { slotId },
        outputs: manifestOutputs(state.catalog, assignments),
      });
      return { slotId, poseLabel };
    });
  }

  return {
    read: readState,
    replaceSlot,
    undoSlot,
    updateLayout,
    updateStyleMeta,
    updateSlotMeta,
  };
}

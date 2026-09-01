import { randomBytes, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  buildPortfolioItems,
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
const lockHeartbeatMs = 1_000;
const lockStaleMs = 15_000;
const defaultLockWaitTimeoutMs = 30_000;
const defaultBatchTtlMs = 24 * 60 * 60 * 1_000;
const batchIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

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
  const assets = buildPortfolioItems(portfolioCatalog, additions)
    .map((photo) => publicAsset(photo.id, photo));
  const assetById = Object.fromEntries(assets.map((asset) => [asset.id, asset]));
  return {
    assets,
    assetById,
    assetIds: [...new Set([
      ...Array.from({ length: portfolioCatalog.photoCount }, (_, index) => index + 1),
      ...additions.photos.map(({ id }) => id),
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

function sourceDerivedMaturity(slots) {
  const uploaded = slots.filter(({ source }) => source === "upload").length;
  return uploaded === 0 ? "reference" : "updating";
}

export function createPortfolioStyleStore({
  rootDir,
  photoRoot,
  additionsPath,
  catalogPath,
  assignmentsPath,
  lockWaitTimeoutMs = defaultLockWaitTimeoutMs,
  batchTtlMs = defaultBatchTtlMs,
}) {
  for (const [label, value] of Object.entries({ rootDir, photoRoot, additionsPath, catalogPath, assignmentsPath })) {
    if (typeof value !== "string" || !value) throw new Error(`${label}路径无效`);
  }
  if (!Number.isInteger(lockWaitTimeoutMs) || lockWaitTimeoutMs < 1) {
    throw new Error("风格存储锁等待时间无效");
  }
  if (!Number.isInteger(batchTtlMs) || batchTtlMs < 1) throw new Error("整组暂存有效期无效");
  const resolvedRootDir = resolve(rootDir);
  const configuredPaths = { photoRoot, additionsPath, catalogPath, assignmentsPath };
  for (const [label, path] of Object.entries(configuredPaths)) {
    const target = resolve(path);
    if (target !== resolvedRootDir && !target.startsWith(`${resolvedRootDir}${sep}`)) {
      throw new Error(`${label}路径越界 rootDir`);
    }
  }
  const localStateRoot = join(resolvedRootDir, ".local");
  const transactionRoot = join(localStateRoot, "portfolio-style-transactions");
  const batchRoot = join(localStateRoot, "portfolio-style-batches");
  const storeLockPath = join(localStateRoot, "portfolio-style-store.lock");
  const lockOwnerPath = join(storeLockPath, "owner.json");
  const allowedManifestPaths = new Set([
    resolve(additionsPath),
    resolve(catalogPath),
    resolve(assignmentsPath),
  ]);
  let operationTail = Promise.resolve();
  let activeLockOwner = null;

  async function canonicalPathThroughExistingAncestor(path, label) {
    let cursor = resolve(path);
    const missingParts = [];
    while (true) {
      let exists = false;
      try {
        await lstat(cursor);
        exists = true;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw new Error(`${label}无法安全解析：${error.message}`);
        }
      }
      if (exists) {
        try {
          return resolve(await realpath(cursor), ...missingParts);
        } catch (error) {
          throw new Error(`${label}存在断开或无法解析的符号链接：${error.message}`);
        }
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error(`${label}没有可验证的现存父目录`);
      missingParts.unshift(basename(cursor));
      cursor = parent;
    }
  }

  async function assertInsideRealRoot(path, label) {
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      canonicalPathThroughExistingAncestor(resolvedRootDir, "rootDir"),
      canonicalPathThroughExistingAncestor(path, label),
    ]);
    if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${sep}`)) {
      throw new Error(`${label}通过符号链接越界 rootDir`);
    }
    return canonicalTarget;
  }

  async function assertConfiguredPathsSafe() {
    await Promise.all([
      ...Object.entries(configuredPaths)
        .map(([label, path]) => assertInsideRealRoot(path, label)),
      assertInsideRealRoot(localStateRoot, "本地状态目录"),
      assertInsideRealRoot(transactionRoot, "事务目录"),
      assertInsideRealRoot(batchRoot, "整组暂存目录"),
      assertInsideRealRoot(storeLockPath, "风格存储锁"),
    ]);
  }

  async function ownerProcessIsAlive(pid) {
    if (!Number.isInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== "ESRCH";
    }
  }

  async function lockSnapshot() {
    await Promise.all([
      assertInsideRealRoot(storeLockPath, "风格存储锁"),
      assertInsideRealRoot(lockOwnerPath, "风格存储锁 owner"),
    ]);
    let directoryInfo;
    try {
      directoryInfo = await stat(storeLockPath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    let raw = "";
    let owner = null;
    try {
      raw = await readFile(lockOwnerPath, "utf8");
      owner = JSON.parse(raw);
    } catch {
      // A creator may have made the lock directory but not owner.json yet.
    }
    const heartbeatTime = Date.parse(owner?.heartbeatAt || "");
    const createdTime = Date.parse(owner?.createdAt || "");
    const age = Number.isFinite(heartbeatTime)
      ? Date.now() - heartbeatTime
      : Date.now() - directoryInfo.mtimeMs;
    const validOwner = owner?.schemaVersion === 1
      && Number.isInteger(owner.pid)
      && owner.pid > 0
      && typeof owner.token === "string"
      && /^[a-f0-9]{24}$/.test(owner.token)
      && typeof owner.host === "string"
      && owner.host.length > 0
      && Number.isFinite(createdTime)
      && Number.isFinite(heartbeatTime)
      && heartbeatTime >= createdTime;
    const localOwner = validOwner && owner.host === hostname();
    const alive = localOwner
      ? await ownerProcessIsAlive(owner.pid)
      : false;
    return {
      age,
      owner,
      raw,
      stale: validOwner
        ? (localOwner ? (!alive || age > lockStaleMs) : age > lockStaleMs)
        : age > lockStaleMs,
    };
  }

  async function recoverStaleLock() {
    const snapshot = await lockSnapshot();
    if (!snapshot || !snapshot.stale) return !snapshot;
    const quarantine = `${storeLockPath}.stale-${process.pid}-${randomBytes(5).toString("hex")}`;
    await assertInsideRealRoot(quarantine, "陈旧锁隔离目录");
    try {
      await rename(storeLockPath, quarantine);
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    }
    let movedRaw = "";
    try {
      const movedOwnerPath = join(quarantine, "owner.json");
      await assertInsideRealRoot(movedOwnerPath, "陈旧锁 owner");
      movedRaw = await readFile(movedOwnerPath, "utf8");
    } catch {
      // Invalid owner data remains stale when the directory itself is old.
    }
    if (movedRaw !== snapshot.raw) {
      try {
        await Promise.all([
          assertInsideRealRoot(quarantine, "陈旧锁隔离目录"),
          assertInsideRealRoot(storeLockPath, "风格存储锁"),
        ]);
        await rename(quarantine, storeLockPath);
      } catch (error) {
        throw new Error(`风格存储锁所有权变化，无法安全恢复：${error.message}`);
      }
      return false;
    }
    await assertInsideRealRoot(quarantine, "陈旧锁隔离目录");
    await rm(quarantine, { recursive: true, force: true });
    return true;
  }

  async function acquireStoreLock() {
    await assertConfiguredPathsSafe();
    await mkdir(localStateRoot, { recursive: true });
    await assertInsideRealRoot(localStateRoot, "本地状态目录");
    const deadline = Date.now() + lockWaitTimeoutMs;
    const token = randomBytes(12).toString("hex");
    while (true) {
      try {
        await assertInsideRealRoot(storeLockPath, "风格存储锁");
        await mkdir(storeLockPath);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (await recoverStaleLock()) continue;
        if (Date.now() >= deadline) throw new Error("等待风格存储锁超时，未强行覆盖正在进行的操作");
        await delay(15 + Math.floor(Math.random() * 20));
        continue;
      }

      const owner = {
        schemaVersion: 1,
        pid: process.pid,
        host: hostname(),
        token,
        createdAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      };
      try {
        await assertInsideRealRoot(lockOwnerPath, "风格存储锁 owner");
        await writeJsonAtomic(lockOwnerPath, owner);
      } catch (error) {
        await assertInsideRealRoot(storeLockPath, "风格存储锁")
          .then(() => rm(storeLockPath, { recursive: true, force: true }))
          .catch(() => {});
        throw error;
      }
      activeLockOwner = owner;
      let heartbeatWriting = Promise.resolve();
      const heartbeat = setInterval(() => {
        heartbeatWriting = heartbeatWriting.then(async () => {
          await assertInsideRealRoot(lockOwnerPath, "风格存储锁 owner");
          const current = await readJson(lockOwnerPath);
          if (current.token !== token || current.pid !== process.pid) {
            throw new Error("风格存储锁所有权已变化");
          }
          owner.heartbeatAt = new Date().toISOString();
          await writeJsonAtomic(lockOwnerPath, owner);
        }).catch(() => {});
      }, lockHeartbeatMs);
      heartbeat.unref();

      return async () => {
        clearInterval(heartbeat);
        await heartbeatWriting;
        let current;
        try {
          await assertInsideRealRoot(lockOwnerPath, "风格存储锁 owner");
          current = await readJson(lockOwnerPath);
        } catch (error) {
          activeLockOwner = null;
          throw new Error(`风格存储锁记录丢失：${error.message}`);
        }
        if (current.token !== token || current.pid !== process.pid) {
          activeLockOwner = null;
          throw new Error("风格存储锁所有权不匹配，未删除他人锁");
        }
        await assertInsideRealRoot(storeLockPath, "风格存储锁");
        await rm(storeLockPath, { recursive: true, force: true });
        activeLockOwner = null;
      };
    }
  }

  function enqueueOperation(work) {
    const execute = async () => {
      const release = await acquireStoreLock();
      try {
        await assertConfiguredPathsSafe();
        return await work();
      } finally {
        await release();
      }
    };
    const result = operationTail.then(execute, execute);
    operationTail = result.catch(() => {});
    return result;
  }

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

  async function assertJournalOutputPaths(transactionDir, output) {
    assertJournalOutput(output);
    const paths = [
      [transactionDir, "事务记录目录"],
      [join(transactionDir, "before", output.key), `事务备份 ${output.key}`],
      [output.target, `事务目标 ${output.key}`],
    ];
    if (output.temporaryPath) paths.push([output.temporaryPath, `事务临时文件 ${output.key}`]);
    await Promise.all(paths.map(([path, label]) => assertInsideRealRoot(path, label)));
  }

  async function snapshotOutput(transactionDir, output, token) {
    assertAllowedTarget(output.target);
    const beforePath = join(transactionDir, "before", output.key);
    await Promise.all([
      assertInsideRealRoot(transactionDir, "事务记录目录"),
      assertInsideRealRoot(beforePath, `事务备份 ${output.key}`),
      assertInsideRealRoot(output.target, `事务目标 ${output.key}`),
    ]);
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
      await assertInsideRealRoot(dirname(output.target), `事务目标父目录 ${output.key}`);
      await mkdir(dirname(output.target), { recursive: true });
      temporaryPath = `${output.target}.tmp-style-${token}`;
      await Promise.all([
        assertInsideRealRoot(output.target, `事务目标 ${output.key}`),
        assertInsideRealRoot(temporaryPath, `事务临时文件 ${output.key}`),
      ]);
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

  async function noFollowKind(path, label) {
    await assertInsideRealRoot(path, label);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`${label}不能是符号链接`);
      if (info.isFile()) return { info, kind: "file" };
      if (info.isDirectory()) return { info, kind: "directory" };
      return { info, kind: "other" };
    } catch (error) {
      if (error.code === "ENOENT") return { info: null, kind: "missing" };
      throw error;
    }
  }

  async function removeSafeRecoveryFiles(paths) {
    for (const path of paths.filter(Boolean)) {
      await assertInsideRealRoot(path, "事务恢复临时文件");
      await rm(path, { force: true }).catch(() => {});
    }
  }

  async function prepareOutputRestoration(transactionDir, outputs) {
    const restoreToken = randomBytes(8).toString("hex");
    const plans = [];
    const keys = new Set();
    const targets = new Set();
    for (const output of outputs) {
      await assertJournalOutputPaths(transactionDir, output);
      const target = resolve(output.target);
      if (keys.has(output.key) || targets.has(target)) throw new Error("风格事务恢复输出重复");
      keys.add(output.key);
      targets.add(target);
      if (output.action === "write" && (typeof output.temporaryPath !== "string" || !output.temporaryPath)) {
        throw new Error(`事务输出 ${output.key} 缺少写入临时文件`);
      }
      if (output.action === "delete" && output.temporaryPath !== "") {
        throw new Error(`事务输出 ${output.key} 删除语义无效`);
      }
      const backupPath = join(transactionDir, "before", output.key);
      const [backupState, targetState, temporaryState] = await Promise.all([
        noFollowKind(backupPath, `事务备份 ${output.key}`),
        noFollowKind(output.target, `事务目标 ${output.key}`),
        output.temporaryPath
          ? noFollowKind(output.temporaryPath, `事务临时文件 ${output.key}`)
          : Promise.resolve({ info: null, kind: "missing" }),
      ]);
      if (output.beforeKind === "file" && backupState.kind !== "file") {
        throw new Error(`事务备份 ${output.key} 必须是存在、可读的普通文件`);
      }
      if (output.beforeKind !== "file" && backupState.kind !== "missing") {
        throw new Error(`事务备份 ${output.key} 与 ${output.beforeKind} 记录不匹配`);
      }
      if (!["missing", "file"].includes(temporaryState.kind)) {
        throw new Error(`事务临时文件 ${output.key} 必须是普通文件或不存在`);
      }
      if (["file", "missing"].includes(output.beforeKind)
        && !["file", "missing"].includes(targetState.kind)) {
        throw new Error(`事务目标 ${output.key} 状态与 ${output.beforeKind} 记录不匹配`);
      }
      if (["directory", "other"].includes(output.beforeKind) && targetState.kind !== output.beforeKind) {
        throw new Error(`事务目标 ${output.key} 必须保持 ${output.beforeKind} 状态`);
      }
      if (output.action === "delete" && output.beforeKind === "missing" && targetState.kind !== "missing") {
        throw new Error(`事务目标 ${output.key} 与删除前 missing 语义不匹配`);
      }
      plans.push({
        backupPath,
        output,
        restorePath: output.beforeKind === "file"
          ? `${output.target}.tmp-style-restore-${restoreToken}`
          : "",
        rollbackPath: ["file", "missing"].includes(output.beforeKind) && targetState.kind === "file"
          ? `${output.target}.tmp-style-recovery-backup-${restoreToken}`
          : "",
        targetKind: targetState.kind,
      });
    }

    const preparedPaths = [];
    try {
      for (const plan of plans) {
        for (const path of [plan.restorePath, plan.rollbackPath].filter(Boolean)) {
          await assertInsideRealRoot(path, `事务恢复临时文件 ${plan.output.key}`);
        }
        if (plan.restorePath) {
          await copyFile(plan.backupPath, plan.restorePath);
          preparedPaths.push(plan.restorePath);
          const [backupInfo, restoreState] = await Promise.all([
            stat(plan.backupPath),
            noFollowKind(plan.restorePath, `事务恢复临时文件 ${plan.output.key}`),
          ]);
          if (restoreState.kind !== "file" || restoreState.info.size !== backupInfo.size) {
            throw new Error(`事务备份 ${plan.output.key} 复制验证失败`);
          }
        }
        if (plan.rollbackPath) {
          await copyFile(plan.output.target, plan.rollbackPath);
          preparedPaths.push(plan.rollbackPath);
          const [targetInfo, rollbackState] = await Promise.all([
            stat(plan.output.target),
            noFollowKind(plan.rollbackPath, `事务恢复回滚文件 ${plan.output.key}`),
          ]);
          if (rollbackState.kind !== "file" || rollbackState.info.size !== targetInfo.size) {
            throw new Error(`事务目标 ${plan.output.key} 回滚备份验证失败`);
          }
        }
      }
      return plans;
    } catch (error) {
      await removeSafeRecoveryFiles(preparedPaths);
      throw error;
    }
  }

  async function rollbackRestoration(appliedPlans) {
    const errors = [];
    for (const plan of [...appliedPlans].reverse()) {
      try {
        await assertInsideRealRoot(plan.output.target, `事务目标 ${plan.output.key}`);
        if (plan.targetKind === "file") {
          await assertInsideRealRoot(plan.rollbackPath, `事务恢复回滚文件 ${plan.output.key}`);
          await rename(plan.rollbackPath, plan.output.target);
        } else if (plan.targetKind === "missing") {
          await rm(plan.output.target, { force: true });
        }
      } catch (error) {
        errors.push(`${plan.output.key}: ${error.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join("；"));
  }

  async function restoreOutputs(transactionDir, outputs) {
    const plans = await prepareOutputRestoration(transactionDir, outputs);
    const appliedPlans = [];
    try {
      for (const plan of [...plans].reverse()) {
        if (plan.output.beforeKind === "file") {
          await Promise.all([
            assertInsideRealRoot(plan.restorePath, `事务恢复临时文件 ${plan.output.key}`),
            assertInsideRealRoot(plan.output.target, `事务目标 ${plan.output.key}`),
          ]);
          await rename(plan.restorePath, plan.output.target);
          appliedPlans.push(plan);
        } else if (plan.output.beforeKind === "missing" && plan.targetKind !== "missing") {
          await assertInsideRealRoot(plan.output.target, `事务目标 ${plan.output.key}`);
          await rm(plan.output.target, { force: true });
          appliedPlans.push(plan);
        }
      }
    } catch (error) {
      try {
        await rollbackRestoration(appliedPlans);
      } catch (rollbackError) {
        throw new Error(`${error.message}；恢复提交回滚失败：${rollbackError.message}`);
      } finally {
        await removeSafeRecoveryFiles(plans.flatMap((plan) => [plan.restorePath, plan.rollbackPath]));
      }
      throw error;
    }
    await removeSafeRecoveryFiles(plans.flatMap((plan) => [
      plan.restorePath,
      plan.rollbackPath,
      plan.output.temporaryPath,
    ]));
  }

  async function cleanupPreparedOutputs(outputs) {
    for (const output of outputs) {
      assertJournalOutput(output);
      if (output.temporaryPath) {
        await assertInsideRealRoot(output.temporaryPath, `事务临时文件 ${output.key}`);
      }
    }
    await Promise.all(outputs.filter((output) => output.temporaryPath)
      .map((output) => rm(output.temporaryPath, { force: true }).catch(() => {})));
  }

  async function recoverTransactions() {
    if (!activeLockOwner) throw new Error("风格事务恢复必须先持有存储锁");
    await assertInsideRealRoot(transactionRoot, "事务目录");
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
      await Promise.all([
        assertInsideRealRoot(transactionDir, "事务记录目录"),
        assertInsideRealRoot(metaPath, "事务记录"),
      ]);
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
          await assertInsideRealRoot(metaPath, "事务记录");
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
    if (!activeLockOwner) throw new Error("风格事务提交必须先持有存储锁");
    const token = `${timestampName()}-${randomBytes(5).toString("hex")}`;
    const transactionDir = join(transactionRoot, token);
    const metaPath = join(transactionDir, "meta.json");
    await Promise.all([
      assertInsideRealRoot(transactionRoot, "事务目录"),
      assertInsideRealRoot(transactionDir, "事务记录目录"),
      assertInsideRealRoot(metaPath, "事务记录"),
    ]);
    await mkdir(join(transactionDir, "before"), { recursive: true });
    await Promise.all([
      assertInsideRealRoot(transactionDir, "事务记录目录"),
      assertInsideRealRoot(join(transactionDir, "before"), "事务备份目录"),
    ]);
    const prepared = [];
    let meta = {
      schemaVersion: 1,
      operation,
      status: "preparing",
      createdAt: new Date().toISOString(),
      ownerPid: activeLockOwner.pid,
      ownerToken: activeLockOwner.token,
      ...context,
      outputs: prepared,
    };
    try {
      for (const output of outputs) prepared.push(await snapshotOutput(transactionDir, output, token));
      meta = { ...meta, status: "prepared", outputs: prepared };
      await assertInsideRealRoot(metaPath, "事务记录");
      await writeJsonAtomic(metaPath, meta);
      meta = { ...meta, status: "committing" };
      await assertInsideRealRoot(metaPath, "事务记录");
      await writeJsonAtomic(metaPath, meta);
      for (const output of prepared) {
        await assertJournalOutputPaths(transactionDir, output);
        if (output.action === "write") await rename(output.temporaryPath, output.target);
        else if (output.action === "delete") await rm(output.target, { force: true });
      }
      meta = { ...meta, status: "committed", committedAt: new Date().toISOString() };
      await assertInsideRealRoot(metaPath, "事务记录");
      await writeJsonAtomic(metaPath, meta);
      return meta;
    } catch (error) {
      try {
        if (prepared.length) {
          await assertInsideRealRoot(metaPath, "事务记录");
          await writeJsonAtomic(metaPath, { ...meta, status: "rolling-back", error: error.message }).catch(() => {});
          await restoreOutputs(transactionDir, prepared);
        }
        await assertInsideRealRoot(metaPath, "事务记录");
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

  async function readStateUnlocked() {
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
    const origins = await assetOriginStyleIds();
    const publicAdditionIds = new Set(additions.photos
      .filter(({ visibility }) => visibility === "published")
      .map(({ id }) => id));
    for (const style of styles) {
      const assetIdsForStyle = style.slots.map(({ assetId }) => assetId);
      style.completeEligible = style.slots.every(({ source }) => source === "upload")
        && new Set(assetIdsForStyle).size === 9
        && assetIdsForStyle.every((assetId) => publicAdditionIds.has(assetId) && origins.get(assetId) === style.id);
    }
    return {
      additions,
      assignments,
      catalog,
      assets,
      assetById,
      assetIds,
      assetCount: assets.length,
      families: catalog.families,
      styles,
      slots,
      slotById,
      counts: {
        styles: styles.length,
        slots: slots.length,
        assets: assets.length,
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

  function requireBatchId(value) {
    const batchId = requireText(value, "整组暂存编号");
    if (!batchIdPattern.test(batchId)) throw new Error("整组暂存编号无效");
    return batchId;
  }

  function requireBatchPosition(value) {
    if (!Number.isInteger(value) || value < 1 || value > 9) throw new Error("整组照片位置必须在 1–9 之间");
    return value;
  }

  async function ensureBatchRoot() {
    await mkdir(batchRoot, { recursive: true });
    const info = await lstat(batchRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("整组暂存目录不能是符号链接");
    await assertInsideRealRoot(batchRoot, "整组暂存目录");
    return realpath(batchRoot);
  }

  function batchPaths(batchId) {
    const directory = join(batchRoot, batchId);
    return { directory, metaPath: join(directory, "meta.json") };
  }

  function batchAssetPaths(directory, position) {
    const suffix = String(position).padStart(2, "0");
    return {
      full: join(directory, `position-${suffix}.jpg`),
      thumb: join(directory, `position-${suffix}.webp`),
    };
  }

  async function assertBatchDirectory(batchId, { allowMissing = false } = {}) {
    const canonicalBatchRoot = await ensureBatchRoot();
    const paths = batchPaths(batchId);
    await Promise.all([
      assertInsideRealRoot(paths.directory, "整组暂存批次"),
      assertInsideRealRoot(paths.metaPath, "整组暂存记录"),
    ]);
    let info;
    try {
      info = await lstat(paths.directory);
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") return null;
      if (error.code === "ENOENT") throw new Error(`整组暂存 ${batchId} 不存在或已处理`);
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("整组暂存批次不能是符号链接");
    const canonicalDirectory = await realpath(paths.directory);
    if (dirname(canonicalDirectory) !== canonicalBatchRoot) throw new Error("整组暂存批次 realpath 越界");
    return paths;
  }

  function normalizeBatchMeta(value, batchId) {
    requireExactKeys(value, ["schemaVersion", "batchId", "createdAt", "expiresAt", "positions"], "整组暂存记录");
    if (value.schemaVersion !== 1 || value.batchId !== batchId) throw new Error("整组暂存记录无效");
    const createdAt = Date.parse(value.createdAt);
    const expiresAt = Date.parse(value.expiresAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
      throw new Error("整组暂存时间记录无效");
    }
    if (!value.positions || Array.isArray(value.positions) || typeof value.positions !== "object") {
      throw new Error("整组暂存照片记录无效");
    }
    const positions = {};
    for (const [key, entry] of Object.entries(value.positions)) {
      const position = Number(key);
      requireBatchPosition(position);
      requireExactKeys(entry, ["width", "height", "codec", "stagedAt"], `整组第 ${position} 张记录`);
      if (!Number.isInteger(entry.width) || !Number.isInteger(entry.height)
        || !allowedImageCodecs.has(entry.codec) || Number.isNaN(Date.parse(entry.stagedAt))) {
        throw new Error(`整组第 ${position} 张记录无效`);
      }
      positions[position] = { ...entry };
    }
    return { ...value, positions, createdAt: value.createdAt, expiresAt: value.expiresAt };
  }

  async function removeBatchDirectory(batchId) {
    const paths = await assertBatchDirectory(batchId, { allowMissing: true });
    if (!paths) return false;
    await rm(paths.directory, { recursive: true, force: true });
    return true;
  }

  async function purgeExpiredBatches(now = Date.now()) {
    await ensureBatchRoot();
    const entries = await readdir(batchRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!batchIdPattern.test(entry.name)) continue;
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("整组暂存批次不能是符号链接");
      const paths = await assertBatchDirectory(entry.name);
      const meta = normalizeBatchMeta(await readJson(paths.metaPath), entry.name);
      if (Date.parse(meta.expiresAt) <= now) await removeBatchDirectory(entry.name);
    }
  }

  async function loadBatch(batchId) {
    await purgeExpiredBatches();
    const paths = await assertBatchDirectory(batchId);
    const meta = normalizeBatchMeta(await readJson(paths.metaPath), batchId);
    if (Date.parse(meta.expiresAt) <= Date.now()) {
      await removeBatchDirectory(batchId);
      throw new Error(`整组暂存 ${batchId} 已过期`);
    }
    return { ...paths, meta };
  }

  async function createBatch() {
    return enqueueOperation(async () => {
      await recoverTransactions();
      await purgeExpiredBatches();
      while (true) {
        const batchId = randomUUID();
        const paths = batchPaths(batchId);
        try {
          await mkdir(paths.directory);
        } catch (error) {
          if (error.code === "EEXIST") continue;
          throw error;
        }
        try {
          await assertBatchDirectory(batchId);
          const createdAt = new Date();
          await writeJsonAtomic(paths.metaPath, {
            schemaVersion: 1,
            batchId,
            createdAt: createdAt.toISOString(),
            expiresAt: new Date(createdAt.getTime() + batchTtlMs).toISOString(),
            positions: {},
          });
          return batchId;
        } catch (error) {
          await assertInsideRealRoot(paths.directory, "整组暂存批次")
            .then(() => rm(paths.directory, { recursive: true, force: true }))
            .catch(() => {});
          throw error;
        }
      }
    });
  }

  async function stageBatchFile(batchIdValue, positionValue, inputPathValue) {
    const batchId = requireBatchId(batchIdValue);
    const position = requireBatchPosition(positionValue);
    const inputPath = requireText(inputPathValue, "上传文件路径");
    return enqueueOperation(async () => {
      const batch = await loadBatch(batchId);
      if (batch.meta.positions[position]) throw new Error(`整组第 ${position} 张已经暂存，不能重复写入`);
      const targets = batchAssetPaths(batch.directory, position);
      for (const [kind, target] of Object.entries(targets)) {
        await assertInsideRealRoot(target, `整组第 ${position} 张${kind}`);
        const targetState = await noFollowKind(target, `整组第 ${position} 张${kind}`);
        if (targetState.kind !== "missing") throw new Error(`整组第 ${position} 张已经暂存`);
      }
      const prepared = await prepareNewAsset(portfolioCatalog.photoCount + position, inputPath);
      const token = randomBytes(6).toString("hex");
      const temporary = {
        full: `${targets.full}.tmp-style-batch-${token}`,
        thumb: `${targets.thumb}.tmp-style-batch-${token}`,
      };
      try {
        await Promise.all(Object.entries(temporary).map(([kind, path]) =>
          assertInsideRealRoot(path, `整组第 ${position} 张${kind}临时文件`)));
        await Promise.all([
          copyFile(prepared.generated.full, temporary.full),
          copyFile(prepared.generated.thumb, temporary.thumb),
        ]);
        await rename(temporary.full, targets.full);
        await rename(temporary.thumb, targets.thumb);
        const nextMeta = clone(batch.meta);
        nextMeta.positions[position] = {
          width: prepared.sourceInfo.width,
          height: prepared.sourceInfo.height,
          codec: prepared.sourceInfo.codec,
          stagedAt: new Date().toISOString(),
        };
        await writeJsonAtomic(batch.metaPath, nextMeta);
        return { batchId, position };
      } catch (error) {
        await Promise.all([
          ...Object.values(temporary).map((path) => rm(path, { force: true }).catch(() => {})),
          ...Object.values(targets).map((path) => rm(path, { force: true }).catch(() => {})),
        ]);
        throw error;
      } finally {
        await rm(prepared.directory, { recursive: true, force: true });
      }
    });
  }

  function requireOrderedPositions(value) {
    if (!Array.isArray(value) || value.length !== 9
      || value.some((position) => !Number.isInteger(position) || position < 1 || position > 9)
      || new Set(value).size !== 9) {
      throw new Error("整组顺序必须完整包含 1–9 且不重复");
    }
    return [...value];
  }

  async function committedBatchMeta(batchId) {
    let entries = [];
    try {
      entries = await readdir(transactionRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))) {
      try {
        const meta = await readJson(join(transactionRoot, entry.name, "meta.json"));
        if (meta.operation === "replace-style-batch" && meta.status === "committed" && meta.batchId === batchId) return meta;
      } catch {
        // A malformed unrelated history entry cannot make a batch reusable.
      }
    }
    return null;
  }

  async function commitBatch(input) {
    requireExactKeys(input, ["batchId", "styleId", "orderedPositions"], "整组提交");
    const batchId = requireBatchId(input.batchId);
    const styleId = requireText(input.styleId, "风格编号");
    const orderedPositions = requireOrderedPositions(input.orderedPositions);
    return enqueueOperation(async () => {
      const state = await readStateUnlocked();
      if (await committedBatchMeta(batchId)) throw new Error(`整组暂存 ${batchId} 已处理`);
      const batch = await loadBatch(batchId);
      for (let position = 1; position <= 9; position += 1) {
        if (!batch.meta.positions[position]) throw new Error(`整组暂存缺少第 ${position} 张`);
      }
      const style = state.styles.find((item) => item.id === styleId);
      if (!style) throw new Error("风格不存在");
      const firstAssetId = Math.max(...state.assetIds) + 1;
      const assetIds = Array.from({ length: 9 }, (_, index) => firstAssetId + index);
      const now = new Date().toISOString();
      const additions = clone(state.additions);
      const stagedPaths = {};
      for (let position = 1; position <= 9; position += 1) {
        const paths = batchAssetPaths(batch.directory, position);
        const states = await Promise.all([
          noFollowKind(paths.full, `整组第 ${position} 张高清图`),
          noFollowKind(paths.thumb, `整组第 ${position} 张缩略图`),
        ]);
        if (states.some(({ kind }) => kind !== "file")) throw new Error(`整组暂存缺少第 ${position} 张`);
        stagedPaths[position] = paths;
        const sourceSlot = style.slots[position - 1];
        const baseAsset = state.assetById[sourceSlot.assetId];
        additions.photos.push({
          id: assetIds[position - 1],
          scene: style.scene,
          theme: baseAsset.theme,
          category: baseAsset.category,
          title: style.label,
          styleTitle: baseAsset.styleTitle,
          featured: false,
          visibility: "published",
          publishedAt: now,
        });
      }
      const normalizedAdditions = normalizePortfolioAdditions(additions);
      const assignments = clone(state.assignments);
      const layout = assignments.assignments[styleId];
      layout.slots = orderedPositions.map((position, index) => ({
        ...layout.slots[index],
        assetId: assetIds[position - 1],
        source: "upload",
        updatedAt: now,
      }));
      layout.maturity = "updating";
      layout.updatedAt = now;
      normalizeStyleAssignments(assignments, validationCatalog(state.catalog), new Map([
        ...state.assets.map((asset) => [asset.id, asset]),
        ...normalizedAdditions.photos.slice(-9).map((photo) => [photo.id, publicAsset(photo.id, photo)]),
      ]));
      const outputs = [];
      for (let position = 1; position <= 9; position += 1) {
        const assetId = assetIds[position - 1];
        const filename = slotFilename(assetId);
        outputs.push(
          { key: `full-${position}`, action: "write", target: join(photoRoot, "full", `${filename}.jpg`), sourcePath: stagedPaths[position].full },
          { key: `thumb-${position}`, action: "write", target: join(photoRoot, "thumbs", `${filename}.webp`), sourcePath: stagedPaths[position].thumb },
        );
      }
      outputs.push(
        { key: "additions", action: "write", target: additionsPath, content: `${JSON.stringify(normalizedAdditions, null, 2)}\n` },
        { key: "assignments", action: "write", target: assignmentsPath, content: `${JSON.stringify(assignments, null, 2)}\n` },
      );
      await commitTransaction({
        operation: "replace-style-batch",
        context: { batchId, styleId, assetIds, orderedPositions },
        outputs,
      });
      await removeBatchDirectory(batchId);
      return { batchId, styleId, assetIds };
    });
  }

  async function discardBatch(batchIdValue) {
    const batchId = requireBatchId(batchIdValue);
    return enqueueOperation(async () => ({ batchId, discarded: await removeBatchDirectory(batchId) }));
  }

  async function replaceSlot(input) {
    requireExactKeys(input, ["slotId", "inputPath", "originalName"], "替换照片位");
    const slotId = requireText(input.slotId, "照片位编号");
    const inputPath = requireText(input.inputPath, "上传文件路径");
    const originalName = requireText(input.originalName, "原始文件名");
    return enqueueOperation(async () => {
      const state = await readStateUnlocked();
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
        targetLayout.maturity = sourceDerivedMaturity(targetLayout.slots);
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

  function hasStructuredPreviousAssignment(meta) {
    const assignment = meta.previousAssignment;
    if (!assignment || Array.isArray(assignment) || typeof assignment !== "object") return false;
    const keys = Object.keys(assignment).sort();
    if (keys.join(",") !== "assetId,poseLabel,source,updatedAt") return false;
    if (!Number.isInteger(meta.previousAssetId) || assignment.assetId !== meta.previousAssetId) return false;
    if (typeof assignment.poseLabel !== "string" || !assignment.poseLabel.trim()) return false;
    if (!new Set(["seed", "upload"]).has(assignment.source)) return false;
    const validUpdatedAt = assignment.updatedAt === null
      || (typeof assignment.updatedAt === "string" && !Number.isNaN(Date.parse(assignment.updatedAt)));
    if (!validUpdatedAt || (assignment.source === "seed" && assignment.updatedAt !== null)) return false;
    return meta.previousLayoutUpdatedAt === null
      || (typeof meta.previousLayoutUpdatedAt === "string" && !Number.isNaN(Date.parse(meta.previousLayoutUpdatedAt)));
  }

  function hasCompletePreviousAssignment(meta, state, slot) {
    if (!hasStructuredPreviousAssignment(meta)) return false;
    const previousAsset = state.assetById[meta.previousAssignment.assetId];
    return previousAsset?.scene === slot.style.scene;
  }

  function hasCommittedEnvelope(meta, operation) {
    return meta?.schemaVersion === 1
      && meta.operation === operation
      && meta.status === "committed"
      && typeof meta.createdAt === "string"
      && !Number.isNaN(Date.parse(meta.createdAt))
      && typeof meta.committedAt === "string"
      && !Number.isNaN(Date.parse(meta.committedAt))
      && Date.parse(meta.committedAt) >= Date.parse(meta.createdAt)
      && Number.isInteger(meta.ownerPid)
      && meta.ownerPid > 0
      && typeof meta.ownerToken === "string"
      && /^[a-f0-9]{24}$/.test(meta.ownerToken);
  }

  function hasExpectedCommittedOutputs(entry, outputs, expected) {
    if (!Array.isArray(outputs) || outputs.length !== expected.length) return false;
    const byKey = new Map();
    try {
      for (const output of outputs) {
        assertJournalOutput(output);
        if (byKey.has(output.key)) return false;
        byKey.set(output.key, output);
      }
    } catch {
      return false;
    }
    return expected.every((specification) => {
      const output = byKey.get(specification.key);
      if (!output
        || output.action !== specification.action
        || resolve(output.target) !== resolve(specification.target)) return false;
      if (output.action === "write") {
        if (typeof output.temporaryPath !== "string" || !output.temporaryPath) return false;
        return resolve(output.temporaryPath) === resolve(`${output.target}.tmp-style-${entry}`);
      }
      return output.temporaryPath === "";
    });
  }

  function hasCompleteReplacementRecord(entry, meta) {
    if (!hasCommittedEnvelope(meta, "replace-slot")
      || typeof meta.slotId !== "string"
      || !Number.isInteger(meta.assetId)
      || meta.assetId <= portfolioCatalog.photoCount
      || !Number.isInteger(meta.previousAssetId)
      || meta.previousAssetId < 1
      || !hasStructuredPreviousAssignment(meta)
      || typeof meta.originalName !== "string"
      || !meta.originalName.trim()) return false;
    const base = slotFilename(meta.assetId);
    return hasExpectedCommittedOutputs(entry, meta.outputs, [
      { key: "full", action: "write", target: join(photoRoot, "full", `${base}.jpg`) },
      { key: "thumb", action: "write", target: join(photoRoot, "thumbs", `${base}.webp`) },
      { key: "additions", action: "write", target: additionsPath },
      { key: "assignments", action: "write", target: assignmentsPath },
    ]);
  }

  function hasCompleteBatchRecord(entry, meta) {
    if (!hasCommittedEnvelope(meta, "replace-style-batch")
      || !batchIdPattern.test(meta.batchId || "")
      || !/^ST-(?:IN|OUT)-0[1-6]-(?:0[1-9]|1[01])$/.test(meta.styleId || "")
      || !Array.isArray(meta.assetIds)
      || meta.assetIds.length !== 9
      || new Set(meta.assetIds).size !== 9
      || meta.assetIds.some((assetId, index) => !Number.isInteger(assetId)
        || assetId <= portfolioCatalog.photoCount
        || (index > 0 && assetId !== meta.assetIds[index - 1] + 1))) return false;
    try {
      requireOrderedPositions(meta.orderedPositions);
    } catch {
      return false;
    }
    const expected = [];
    meta.assetIds.forEach((assetId, index) => {
      const position = index + 1;
      const base = slotFilename(assetId);
      expected.push(
        { key: `full-${position}`, action: "write", target: join(photoRoot, "full", `${base}.jpg`) },
        { key: `thumb-${position}`, action: "write", target: join(photoRoot, "thumbs", `${base}.webp`) },
      );
    });
    expected.push(
      { key: "additions", action: "write", target: additionsPath },
      { key: "assignments", action: "write", target: assignmentsPath },
    );
    return hasExpectedCommittedOutputs(entry, meta.outputs, expected);
  }

  async function assetOriginStyleIds() {
    await assertInsideRealRoot(transactionRoot, "事务目录");
    let entries = [];
    try {
      entries = (await readdir(transactionRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if (error.code === "ENOENT") return new Map();
      throw error;
    }
    const origins = new Map();
    for (const entry of entries) {
      try {
        const meta = await readJson(join(transactionRoot, entry, "meta.json"));
        if (hasCompleteReplacementRecord(entry, meta)) {
          origins.set(meta.assetId, meta.slotId.replace(/-P0[1-9]$/, ""));
        } else if (hasCompleteBatchRecord(entry, meta)) {
          meta.assetIds.forEach((assetId) => origins.set(assetId, meta.styleId));
        }
      } catch {
        // Invalid or unrelated history cannot prove a public maturity claim.
      }
    }
    return origins;
  }

  async function assertRequestedMaturity(state, style, requestedMaturity) {
    const uploadedSlots = style.slots.filter(({ source }) => source === "upload");
    if (uploadedSlots.length === 0) {
      if (requestedMaturity !== "reference") throw new Error("没有 upload 来源时成熟度只能是风格参考");
      return;
    }
    if (uploadedSlots.length < 9) {
      if (requestedMaturity !== "updating") throw new Error("不足 9 张 upload 照片时只能标记正在完善");
      return;
    }
    if (requestedMaturity === "updating") return;
    if (requestedMaturity !== "complete") throw new Error("全部换图后成熟度只能是正在完善或完整客片组");
    const assetIds = uploadedSlots.map(({ assetId }) => assetId);
    if (new Set(assetIds).size !== 9) throw new Error("完整客片组必须使用 9 个不重复资产");
    const additionsById = new Map(state.additions.photos.map((photo) => [photo.id, photo]));
    if (assetIds.some((assetId) => additionsById.get(assetId)?.visibility !== "published")) {
      throw new Error("完整客片组的 9 张照片必须均已确认可公开");
    }
    const origins = await assetOriginStyleIds();
    if (assetIds.some((assetId) => origins.get(assetId) !== style.id)) {
      throw new Error("完整客片组的 9 张照片必须全部为本风格创建，不能只根据 NB 编号判定");
    }
  }

  function hasCompleteUndoRecord(entry, meta, source) {
    if (!hasCommittedEnvelope(meta, "undo-slot")
      || typeof meta.sourceTransaction !== "string"
      || !source
      || !hasCompleteReplacementRecord(meta.sourceTransaction, source.meta)
      || Date.parse(meta.createdAt) < Date.parse(source.meta.committedAt)
      || meta.slotId !== source.meta.slotId
      || meta.assetId !== source.meta.assetId
      || meta.restoredAssetId !== source.meta.previousAssetId
      || ![null, meta.assetId].includes(meta.removedAssetId)) return false;
    const expected = [];
    if (meta.removedAssetId === meta.assetId) {
      const base = slotFilename(meta.assetId);
      expected.push(
        { key: "full", action: "delete", target: join(photoRoot, "full", `${base}.jpg`) },
        { key: "thumb", action: "delete", target: join(photoRoot, "thumbs", `${base}.webp`) },
      );
    }
    expected.push(
      { key: "additions", action: "write", target: additionsPath },
      { key: "assignments", action: "write", target: assignmentsPath },
    );
    return hasExpectedCommittedOutputs(entry, meta.outputs, expected);
  }

  async function availableReplacementHistory(slotId, currentAssetId, state, slot) {
    await assertInsideRealRoot(transactionRoot, "事务目录");
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
    const history = [];
    for (const entry of entries) {
      const transactionDir = join(transactionRoot, entry);
      const metaPath = join(transactionDir, "meta.json");
      await Promise.all([
        assertInsideRealRoot(transactionDir, "事务记录目录"),
        assertInsideRealRoot(metaPath, "事务记录"),
      ]);
      try {
        const meta = await readJson(metaPath);
        if (meta.status !== "committed") continue;
        history.push({ entry, meta });
      } catch {
        // Match legacy undo: a corrupt newest entry must not hide an older,
        // complete replacement.
      }
    }
    const byEntry = new Map(history.map((item) => [item.entry, item]));
    const consumed = new Set(history
      .filter(({ entry, meta }) => meta.operation === "undo-slot"
        && hasCompleteUndoRecord(entry, meta, byEntry.get(meta.sourceTransaction)))
      .map(({ meta }) => meta.sourceTransaction));
    for (const item of history) {
      const { entry, meta } = item;
      if (!hasCompleteReplacementRecord(entry, meta) || meta.slotId !== slotId || consumed.has(entry)) continue;
      const addition = state.additions.photos.find((photo) => photo.id === meta.assetId);
      if (!Number.isInteger(meta.assetId) || meta.assetId <= portfolioCatalog.photoCount
        || !addition || addition.visibility !== "published" || meta.assetId !== currentAssetId
        || !hasCompletePreviousAssignment(meta, state, slot)) continue;
      const fullPath = join(photoRoot, "full", `${slotFilename(meta.assetId)}.jpg`);
      const thumbPath = join(photoRoot, "thumbs", `${slotFilename(meta.assetId)}.webp`);
      await Promise.all([
        assertInsideRealRoot(fullPath, "撤销高清图"),
        assertInsideRealRoot(thumbPath, "撤销缩略图"),
      ]);
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
    return enqueueOperation(async () => {
      const state = await readStateUnlocked();
      const slot = state.slotById[slotId];
      if (!slot) throw new Error("照片位不存在");
      const history = await availableReplacementHistory(slotId, slot.assetId, state, slot);
      if (!history) throw new Error(`${slotId} 没有更早的可用备份`);

      const assignments = clone(state.assignments);
      const targetLayout = assignments.assignments[slot.styleId];
      targetLayout.slots[slot.position - 1] = clone(history.meta.previousAssignment);
      targetLayout.maturity = sourceDerivedMaturity(targetLayout.slots);
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
    return enqueueOperation(async () => {
      const state = await readStateUnlocked();
      const style = state.styles.find((item) => item.id === styleId);
      if (!style) throw new Error("风格不存在");
      const currentIds = new Set(style.slots.map((slot) => slot.id));
      if (input.orderedSlotIds.some((slotId) => !currentIds.has(slotId)) || !currentIds.has(coverSlotId)) {
        throw new Error("风格布局必须完整使用该风格的 9 个照片位");
      }
      await assertRequestedMaturity(state, style, input.maturity);
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
    return enqueueOperation(async () => {
      const state = await readStateUnlocked();
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
    return enqueueOperation(async () => {
      const state = await readStateUnlocked();
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
    commitBatch,
    createBatch,
    discardBatch,
    read: () => enqueueOperation(readStateUnlocked),
    replaceSlot,
    stageBatchFile,
    undoSlot,
    updateLayout,
    updateStyleMeta,
    updateSlotMeta,
  };
}

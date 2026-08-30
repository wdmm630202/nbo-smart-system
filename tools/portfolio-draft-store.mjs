import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { root } from "./portfolio-photo-lib.mjs";

export const DRAFT_SCHEMA_VERSION = 1;
export const draftRoot = join(root, ".local/portfolio-drafts");

const allowedPatchKeys = new Set([
  "scene",
  "theme",
  "category",
  "approvedForPublicUse",
  "status",
  "updatedAt",
  "featured",
]);

const transitions = {
  draft: new Set(["ready", "archived"]),
  ready: new Set(["draft", "published", "archived"]),
  published: new Set(["archived"]),
  archived: new Set(["draft"]),
};

const initialState = () => ({ schemaVersion: DRAFT_SCHEMA_VERSION, photos: [], themes: [] });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error("草稿编号无效");
  return id;
}

function timestamp(value = new Date().toISOString()) {
  return typeof value === "string" && value ? value : new Date().toISOString();
}

function requireReadyMetadata(photo) {
  if (!photo.scene || !photo.theme || !photo.category || photo.approvedForPublicUse !== true) {
    throw new Error("进入待公开前必须填写场景、主题、风格和公开授权");
  }
}

function assertTransition(photo, nextStatus) {
  if (!transitions[photo.status]?.has(nextStatus)) {
    throw new Error(`草稿状态 ${photo.status} 不能转换为 ${nextStatus}`);
  }
  if (nextStatus === "ready") requireReadyMetadata(photo);
}

function findPhoto(state, id) {
  const photo = state.photos.find((item) => item.id === normalizeId(id));
  if (!photo) throw new Error(`找不到草稿 NB-${String(id).padStart(3, "0")}`);
  return photo;
}

export function createDraftStore({ rootDir = draftRoot, legacyMaxId = 158 } = {}) {
  const manifestPath = join(rootDir, "manifest.json");
  const reservedIds = new Set();
  let mutationQueue = Promise.resolve();

  async function readState() {
    try {
      const state = JSON.parse(await readFile(manifestPath, "utf8"));
      if (state?.schemaVersion !== DRAFT_SCHEMA_VERSION || !Array.isArray(state.photos) || !Array.isArray(state.themes)) {
        throw new Error("草稿清单格式无效");
      }
      return state;
    } catch (error) {
      if (error?.code === "ENOENT") return initialState();
      throw error;
    }
  }

  async function write(state) {
    const temporary = `${manifestPath}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
    await mkdir(rootDir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, manifestPath);
  }

  function enqueueMutation(operation) {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  async function read() {
    return clone(await readState());
  }

  function allocateId(publicIds = []) {
    return enqueueMutation(async () => {
      const state = await readState();
      const used = new Set([
        ...state.photos.map(({ id }) => normalizeId(id)),
        ...publicIds.map((id) => normalizeId(id)),
        ...reservedIds,
      ]);
      let nextId = normalizeId(legacyMaxId) + 1;
      while (used.has(nextId)) nextId += 1;
      reservedIds.add(nextId);
      return nextId;
    });
  }

  function addPhoto(input = {}) {
    return enqueueMutation(async () => {
      const state = await readState();
      const id = normalizeId(input.id);
      if (id <= legacyMaxId) throw new Error(`草稿编号 NB-${String(id).padStart(3, "0")} 与历史编号冲突`);
      if (state.photos.some((photo) => photo.id === id)) throw new Error(`草稿编号 NB-${String(id).padStart(3, "0")} 已存在`);
      if (typeof input.uuid !== "string" || !input.uuid || typeof input.originalName !== "string" || !input.originalName) {
        throw new Error("草稿必须包含 uuid 和原始文件名");
      }
      const now = new Date().toISOString();
      const photo = {
        id,
        uuid: input.uuid,
        originalName: input.originalName,
        status: "draft",
        approvedForPublicUse: input.approvedForPublicUse === true,
        featured: input.featured === true,
        createdAt: timestamp(input.createdAt || now),
        updatedAt: timestamp(input.updatedAt || now),
      };
      for (const key of ["originalPath", "fullPath", "thumbPath", "scene", "theme", "category"]) {
        if (typeof input[key] === "string" && input[key]) photo[key] = input[key];
      }
      state.photos.push(photo);
      await write(state);
      return clone(photo);
    });
  }

  function updatePhoto(id, patch = {}) {
    return enqueueMutation(async () => {
      const keys = Object.keys(patch);
      const invalidKey = keys.find((key) => !allowedPatchKeys.has(key));
      if (invalidKey) throw new Error(`不允许更新草稿字段 ${invalidKey}`);
      const state = await readState();
      const photo = findPhoto(state, id);
      const next = { ...photo };
      for (const key of keys) {
        if (key !== "status") next[key] = patch[key];
      }
      if (keys.includes("status")) {
        assertTransition(next, patch.status);
        next.status = patch.status;
      }
      if (next.status === "ready") requireReadyMetadata(next);
      next.updatedAt = timestamp(patch.updatedAt);
      Object.assign(photo, next);
      await write(state);
      return clone(photo);
    });
  }

  function transitionPhoto(id, nextStatus) {
    return enqueueMutation(async () => {
      const state = await readState();
      const photo = findPhoto(state, id);
      assertTransition(photo, nextStatus);
      photo.status = nextStatus;
      photo.updatedAt = new Date().toISOString();
      await write(state);
      return clone(photo);
    });
  }

  function addTheme(input = {}) {
    return enqueueMutation(async () => {
      if (typeof input.id !== "string" || !input.id || typeof input.label !== "string" || !input.label
        || typeof input.scene !== "string" || !input.scene || typeof input.description !== "string" || !input.description) {
        throw new Error("草稿主题缺少必要字段");
      }
      const state = await readState();
      if (state.themes.some((theme) => theme.id === input.id)) throw new Error(`草稿主题 ${input.id} 已存在`);
      const now = new Date().toISOString();
      const theme = {
        id: input.id,
        label: input.label,
        scene: input.scene,
        description: input.description,
        createdAt: timestamp(input.createdAt || now),
        updatedAt: timestamp(input.updatedAt || now),
      };
      state.themes.push(theme);
      await write(state);
      return clone(theme);
    });
  }

  function markStaged(id, at) {
    return enqueueMutation(async () => {
      const state = await readState();
      const photo = findPhoto(state, id);
      if (photo.status !== "ready") throw new Error("只有待公开草稿可以标记为已暂存");
      photo.stagedAt = timestamp(at);
      photo.updatedAt = photo.stagedAt;
      await write(state);
      return clone(photo);
    });
  }

  function markPublished(ids, commit) {
    return enqueueMutation(async () => {
      if (!Array.isArray(ids) || !ids.length || typeof commit !== "string" || !commit) {
        throw new Error("发布草稿需要编号和提交记录");
      }
      const state = await readState();
      const photos = ids.map((id) => findPhoto(state, id));
      if (new Set(photos.map((photo) => photo.id)).size !== photos.length) throw new Error("发布草稿编号重复");
      for (const photo of photos) {
        const restoringPublishedPhoto = photo.status === "archived" && typeof photo.publishedCommit === "string" && photo.publishedCommit;
        if (photo.status !== "ready" && !restoringPublishedPhoto) {
          throw new Error("只有待公开草稿或已发布后归档的草稿可以标记为已发布");
        }
        requireReadyMetadata(photo);
      }
      const now = new Date().toISOString();
      for (const photo of photos) {
        photo.status = "published";
        photo.publishedCommit = commit;
        photo.updatedAt = now;
      }
      await write(state);
      return clone(photos);
    });
  }

  return {
    read,
    allocateId,
    addPhoto,
    updatePhoto,
    transitionPhoto,
    addTheme,
    markStaged,
    markPublished,
  };
}

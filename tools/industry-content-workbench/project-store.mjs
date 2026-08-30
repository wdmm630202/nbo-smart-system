import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { STAGE_IDS, STAGE_LABELS, STAGE_STATUSES } from "./constants.mjs";

const projectIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
const supportedPlatforms = new Set(["xiaohongshu", "douyin", "both"]);

function validateProject(project) {
  if (!projectIdPattern.test(String(project.projectId || ""))) throw new Error("项目标识只能使用小写字母、数字和短横线");
  if (!String(project.title || "").trim()) throw new Error("项目标题不能为空");
  if (!supportedPlatforms.has(project.platform)) throw new Error("发布平台无效");
  if (!STAGE_IDS.includes(project.currentStage)) throw new Error("当前阶段无效");
  if (!Array.isArray(project.stages) || project.stages.length !== STAGE_IDS.length) throw new Error("项目必须包含六个阶段");
  for (const [index, stage] of project.stages.entries()) {
    if (stage.id !== STAGE_IDS[index]) throw new Error("项目阶段顺序无效");
    if (!STAGE_STATUSES.includes(stage.status)) throw new Error(`阶段状态无效：${stage.id}`);
  }
  return project;
}

export function createEpisode(input, { now = () => new Date().toISOString() } = {}) {
  const createdAt = now();
  const projectId = input.projectId || `episode-${createdAt.slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  return validateProject({
    schemaVersion: 1,
    projectId,
    title: String(input.title || "").trim(),
    platform: input.platform || "both",
    targetDurationSeconds: Number(input.targetDurationSeconds || 27),
    createdAt,
    updatedAt: createdAt,
    currentStage: "evidence",
    stages: STAGE_IDS.map((id, index) => ({
      id,
      label: STAGE_LABELS[id],
      status: index === 0 ? "needs_review" : "pending",
      error: null,
    })),
    approvals: { script: false, voice: false, preview: false },
    evidence: [],
    claims: [],
    nanboClaimIds: [],
    script: { narration: "", captions: [] },
    voice: { path: null, durationSeconds: null, userApproved: false },
    storyboard: [],
    mediaAssets: [],
    outputs: { preview: null, final: null, subtitles: null },
    qa: { ok: false, errors: [], warnings: [] },
  });
}

async function atomicJson(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function createProjectStore({ rootDir, now = () => new Date().toISOString() }) {
  if (!rootDir) throw new Error("缺少工作台运行目录");
  const projectsDir = join(rootDir, "projects");

  async function ensureRoot() {
    await Promise.all([
      mkdir(projectsDir, { recursive: true, mode: 0o700 }),
      mkdir(join(rootDir, "library"), { recursive: true, mode: 0o700 }),
      mkdir(join(rootDir, "cache"), { recursive: true, mode: 0o700 }),
      mkdir(join(rootDir, "exports"), { recursive: true, mode: 0o700 }),
    ]);
  }

  function projectPath(projectId) {
    if (!projectIdPattern.test(String(projectId || ""))) throw new Error("项目标识无效");
    return join(projectsDir, projectId, "project.json");
  }

  async function createProject(input) {
    await ensureRoot();
    const project = createEpisode(input, { now });
    const directory = join(projectsDir, project.projectId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    await Promise.all([
      mkdir(join(directory, "voice"), { mode: 0o700 }),
      mkdir(join(directory, "preview"), { mode: 0o700 }),
      mkdir(join(directory, "work"), { mode: 0o700 }),
    ]);
    await atomicJson(projectPath(project.projectId), project);
    return structuredClone(project);
  }

  async function readProject(projectId) {
    const project = JSON.parse(await readFile(projectPath(projectId), "utf8"));
    return structuredClone(validateProject(project));
  }

  async function updateProject(projectId, mutate) {
    const current = await readProject(projectId);
    const next = await mutate(structuredClone(current));
    next.updatedAt = now();
    validateProject(next);
    await atomicJson(projectPath(projectId), next);
    return structuredClone(next);
  }

  async function listProjects() {
    await ensureRoot();
    const entries = await readdir(projectsDir, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectIdPattern.test(entry.name)) continue;
      try {
        projects.push(await readProject(entry.name));
      } catch {
        // A malformed directory is ignored here and remains available for manual recovery.
      }
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  return { rootDir, createProject, readProject, updateProject, listProjects };
}

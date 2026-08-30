import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { STAGE_IDS } from "../tools/industry-content-workbench/constants.mjs";
import { createProjectStore } from "../tools/industry-content-workbench/project-store.mjs";

const fixedNow = () => "2026-08-31T00:00:00.000Z";

async function withStore(run) {
  const rootDir = await mkdtemp(join(tmpdir(), "nbo-content-project-"));
  try {
    await run(createProjectStore({ rootDir, now: fixedNow }), rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("新建项目包含六个固定阶段并使用稳定标识", async () => {
  await withStore(async (store) => {
    const project = await store.createProject({
      projectId: "episode-001",
      title: "低价摄影的真实价格",
      platform: "xiaohongshu",
    });

    assert.equal(project.projectId, "episode-001");
    assert.equal(project.currentStage, "evidence");
    assert.deepEqual(project.stages.map(({ id }) => id), STAGE_IDS);
    assert.deepEqual(project.stages.map(({ status }) => status), [
      "needs_review",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    assert.deepEqual(project.approvals, { script: false, voice: false, preview: false });
  });
});

test("账本更新后可从磁盘恢复且不遗留临时文件", async () => {
  await withStore(async (store, rootDir) => {
    await store.createProject({ projectId: "episode-002", title: "底片透明", platform: "douyin" });
    await store.updateProject("episode-002", (project) => ({
      ...project,
      currentStage: "script",
      stages: project.stages.map((stage) => stage.id === "evidence" ? { ...stage, status: "completed" } : stage),
    }));

    const recovered = await store.readProject("episode-002");
    assert.equal(recovered.currentStage, "script");
    assert.equal(recovered.stages[0].status, "completed");
    const onDisk = JSON.parse(await readFile(join(rootDir, "projects", "episode-002", "project.json"), "utf8"));
    assert.equal(onDisk.currentStage, "script");
    await assert.rejects(readFile(join(rootDir, "projects", "episode-002", "project.json.tmp"), "utf8"), /ENOENT/);
  });
});

test("非法标识和无效阶段不会写入账本", async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.createProject({ projectId: "../outside", title: "不安全", platform: "xiaohongshu" }),
      /项目标识/,
    );
    const created = await store.createProject({ projectId: "episode-003", title: "正常", platform: "xiaohongshu" });
    await assert.rejects(
      store.updateProject(created.projectId, (project) => ({ ...project, currentStage: "publish" })),
      /当前阶段/,
    );
  });
});

test("项目列表按最后更新时间降序返回", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "nbo-content-project-"));
  let timestamp = 0;
  const now = () => new Date(Date.UTC(2026, 7, 31, 0, 0, timestamp++)).toISOString();
  try {
    const store = createProjectStore({ rootDir, now });
    await store.createProject({ projectId: "episode-a", title: "A", platform: "xiaohongshu" });
    await store.createProject({ projectId: "episode-b", title: "B", platform: "douyin" });
    assert.deepEqual((await store.listProjects()).map(({ projectId }) => projectId), ["episode-b", "episode-a"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

const stageCopy = {
  evidence: {
    number: "01", kicker: "FACT CHECK", title: "选题与证据",
    description: "先把行业说法和可追溯来源分开，再进入正式文案。",
    boundary: "投诉只作为公开反映，不直接写成已证实事实；不点名攻击具体商家。",
    action: "准备证据研究任务",
  },
  script: {
    number: "02", kicker: "NARRATIVE", title: "文案",
    description: "冷静讲规则，用明确事实替代夸张冲突。",
    boundary: "只有通过证据门禁的行业说法和已确认的南铂事实能进入正式文案。",
    action: "保存并确认文案",
  },
  voice: {
    number: "03", kicker: "VOICE", title: "旁白",
    description: "一次生成完整自然旁白，试听后再锁定。",
    boundary: "不默认克隆他人声音；没有实际试听，不标记旁白通过。",
    action: "准备旁白任务",
  },
  storyboard: {
    number: "04", kicker: "VISUAL PLAN", title: "分镜与素材",
    description: "按语义节拍匹配真实过程素材，缺素材就明确标记。",
    boundary: "原始素材只读；不使用未授权客片，不用无关画面凑时长。",
    action: "选择本地素材",
  },
  qa: {
    number: "05", kicker: "QUALITY GATE", title: "字幕与质检",
    description: "检查事实、时间轴、安全区、黑帧、静音和个人信息。",
    boundary: "自动扫描通过不等于成片通过，仍需实际观看和试听。",
    action: "运行自动质检",
  },
  export: {
    number: "06", kicker: "DELIVERY", title: "导出",
    description: "成片、字幕、证据、素材清单和质检报告成套交付。",
    boundary: "MP4 不冒充可编辑工程；工作台不自动发布或改变投放。",
    action: "查看导出清单",
  },
};

const state = { token: null, projects: [], currentProject: null, visibleStage: "evidence" };
const elements = Object.fromEntries([
  "project-list", "project-heading", "project-summary", "progress-value", "stage-number", "stage-kicker",
  "stage-title", "stage-description", "stage-boundary", "stage-content", "primary-action", "copy-task",
  "status-region", "new-project-button", "new-project-form", "new-project-title", "cancel-new-project",
].map((id) => [id, document.getElementById(id)]));

function announce(message, type = "status") {
  elements["status-region"].textContent = message;
  elements["status-region"].dataset.type = type;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("content-type", "application/json");
  if (options.method && options.method !== "GET") headers.set("x-nanbo-token", state.token);
  const response = await fetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "工作台请求失败");
  return body;
}

function statusLabel(status) {
  return { pending: "待处理", running: "处理中", needs_review: "待确认", completed: "已完成", failed: "需处理" }[status] || "待处理";
}

function renderProjects() {
  elements["project-list"].replaceChildren();
  if (!state.projects.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "还没有项目。点击右上角“新建一期”。";
    elements["project-list"].append(empty);
    return;
  }
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-item";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-current", String(project.projectId === state.currentProject?.projectId));
    const title = document.createElement("strong");
    title.textContent = project.title;
    const platform = document.createElement("small");
    platform.textContent = project.platform === "both" ? "小红书 + 抖音" : project.platform;
    const stage = document.createElement("em");
    stage.textContent = stageCopy[project.currentStage]?.number || "01";
    button.append(title, platform, stage);
    button.addEventListener("click", () => selectProject(project));
    elements["project-list"].append(button);
  }
}

function renderHeader() {
  const project = state.currentProject;
  elements["project-heading"].textContent = project?.title || "先创建一期内容";
  elements["project-summary"].textContent = project
    ? `目标 ${project.targetDurationSeconds} 秒 · ${project.platform === "both" ? "小红书与抖音" : project.platform}`
    : "从选题证据开始，工作台会保存每一步。";
  const completed = project?.stages.filter(({ status }) => status === "completed").length || 0;
  elements["progress-value"].textContent = `${Math.round((completed / 6) * 100)}%`;
}

function fieldMarkup(project, stage) {
  if (!project) return '<div class="empty-state"><strong>先新建一期</strong><p>项目创建后，六个步骤会自动保存并可随时继续。</p></div>';
  if (stage === "evidence") return `<div class="field-grid">
    <div class="field field-wide"><label for="topic-title">本期主题</label><input id="topic-title" value=""></div>
    <div class="field"><label for="target-platform">平台</label><select id="target-platform"><option value="both">小红书 + 抖音</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option></select></div>
    <div class="field"><label for="target-duration">目标时长</label><input id="target-duration" type="number" min="20" max="60" step="1"></div>
    <div class="info-row field-wide"><span>事实门禁</span><strong>${project.evidence.length ? `${project.evidence.length} 条来源待复核` : "还没有来源"}</strong></div>
  </div>`;
  if (stage === "script") return `<div class="field"><label for="narration">正式旁白文案</label><textarea id="narration" placeholder="通过证据门禁后，在这里形成完整口播。"></textarea></div>
    <div class="info-row"><span>已确认南铂事实</span><strong>268拍摄2套 · 全部原片全送 · 不推销加精修</strong></div>`;
  if (stage === "voice") return `<div class="check-stack">
    <div class="check-item"><i>1</i><span>完整文案已锁定</span><small>${project.approvals.script ? "已确认" : "未确认"}</small></div>
    <div class="check-item"><i>2</i><span>自然 AI 旁白</span><small>${project.voice.path ? "已生成" : "待生成"}</small></div>
    <div class="check-item"><i>3</i><span>实际试听</span><small>${project.voice.userApproved ? "已确认" : "必须人工确认"}</small></div>
  </div>`;
  if (stage === "storyboard") return `<div class="info-row"><span>参考风格</span><strong>南铂证据型行业解说 v1</strong></div>
    <div class="info-row"><span>本地素材</span><strong>${project.mediaAssets.length ? `${project.mediaAssets.length} 个已索引` : "尚未选择"}</strong></div>
    <div class="info-row"><span>出镜方式</span><strong>不出镜 · 真实过程 + 动效</strong></div>`;
  if (stage === "qa") return `<div class="check-stack">
    ${["证据门禁", "南铂承诺白名单", "字幕时间轴", "竖屏安全区", "黑帧与静音", "个人信息遮挡"].map((label) => `<div class="check-item"><i>·</i><span>${label}</span><small>待扫描</small></div>`).join("")}
  </div>`;
  return `<div class="check-stack">
    ${["1080×1920 成片 MP4", "字幕文件", "小红书与抖音发布文案", "证据来源报告", "素材使用清单", "项目账本与质检报告"].map((label) => `<div class="check-item"><i>·</i><span>${label}</span><small>待生成</small></div>`).join("")}
    <div class="info-row"><span>外部剪辑器工程</span><strong>未生成，不作可编辑工程承诺</strong></div>
  </div>`;
}

function hydrateStageFields() {
  const project = state.currentProject;
  if (!project) return;
  const title = document.getElementById("topic-title");
  const platform = document.getElementById("target-platform");
  const duration = document.getElementById("target-duration");
  const narration = document.getElementById("narration");
  if (title) title.value = project.title;
  if (platform) platform.value = project.platform;
  if (duration) duration.value = project.targetDurationSeconds;
  if (narration) narration.value = project.script.narration || "";
}

function renderStage() {
  const copy = stageCopy[state.visibleStage];
  elements["stage-number"].textContent = copy.number;
  elements["stage-kicker"].textContent = copy.kicker;
  elements["stage-title"].textContent = copy.title;
  elements["stage-description"].textContent = copy.description;
  elements["stage-boundary"].textContent = copy.boundary;
  elements["primary-action"].textContent = copy.action;
  elements["primary-action"].disabled = !state.currentProject;
  elements["copy-task"].disabled = !state.currentProject;
  elements["stage-content"].innerHTML = fieldMarkup(state.currentProject, state.visibleStage);
  hydrateStageFields();
  for (const button of document.querySelectorAll(".stage-rail button")) {
    const active = button.dataset.stage === state.visibleStage;
    if (active) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
    const projectStage = state.currentProject?.stages.find(({ id }) => id === button.dataset.stage);
    button.querySelector("em").textContent = active ? "当前查看" : statusLabel(projectStage?.status);
  }
}

function render() {
  renderProjects();
  renderHeader();
  renderStage();
}

function selectProject(project) {
  state.currentProject = project;
  state.visibleStage = project.currentStage;
  render();
  announce(`已打开“${project.title}”，从${stageCopy[project.currentStage].title}继续。`);
}

async function updateCurrent(patch) {
  const updated = await api(`/api/projects/${state.currentProject.projectId}`, { method: "PATCH", body: JSON.stringify(patch) });
  state.currentProject = updated;
  state.projects = state.projects.map((project) => project.projectId === updated.projectId ? updated : project);
  render();
  return updated;
}

function buildCodexTask() {
  const project = state.currentProject;
  const stage = stageCopy[state.visibleStage];
  return `继续南铂行业内容项目“${project.title}”的“${stage.title}”阶段。读取本机工作台项目账本，遵守事实门禁、隐私边界和不自动发布规则。完成当前阶段所需产物并更新账本；涉及正式文案、旁白试听或最终预览的放行点，保留人工确认。`;
}

async function copyTask() {
  await navigator.clipboard.writeText(buildCodexTask());
  announce(`“${stageCopy[state.visibleStage].title}”任务已复制给 Codex。`);
}

async function handlePrimaryAction() {
  const project = state.currentProject;
  if (!project) return;
  try {
    if (state.visibleStage === "evidence") {
      await updateCurrent({
        title: document.getElementById("topic-title").value.trim(),
        platform: document.getElementById("target-platform").value,
        targetDurationSeconds: Number(document.getElementById("target-duration").value),
      });
      await copyTask();
      return;
    }
    if (state.visibleStage === "script") {
      const narration = document.getElementById("narration").value.trim();
      if (!narration) throw new Error("请先填写正式旁白文案");
      await updateCurrent({ script: { ...project.script, narration }, approvals: { ...project.approvals, script: true } });
      announce("文案已保存在本机并标记为已确认。", "completion");
      return;
    }
    if (state.visibleStage === "storyboard") {
      const result = await api("/api/select-path", { method: "POST", body: JSON.stringify({ kind: "folder" }) });
      if (!result.selectedPath) return announce("已取消选择，没有修改素材库。", "warning");
      await updateCurrent({ mediaAssets: result.assets });
      announce(`已只读索引 ${result.assets.length} 个素材文件。`, "completion");
      return;
    }
    if (state.visibleStage === "voice") {
      await copyTask();
      return;
    }
    announce(state.visibleStage === "qa" ? "质检适配器会在首条成片生成后运行。" : "导出清单已显示；只有真实生成的文件才会标记完成。", "warning");
  } catch (error) {
    announce(error.message, "error");
  }
}

for (const button of document.querySelectorAll(".stage-rail button")) {
  button.addEventListener("click", () => {
    state.visibleStage = button.dataset.stage;
    renderStage();
    announce(`正在查看${stageCopy[state.visibleStage].title}。`);
  });
}

elements["new-project-button"].addEventListener("click", () => {
  elements["new-project-form"].hidden = false;
  elements["new-project-title"].focus();
});
elements["cancel-new-project"].addEventListener("click", () => { elements["new-project-form"].hidden = true; });
elements["new-project-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const project = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title: elements["new-project-title"].value.trim(), platform: "both", targetDurationSeconds: 30 }),
    });
    state.projects.unshift(project);
    elements["new-project-form"].reset();
    elements["new-project-form"].hidden = true;
    selectProject(project);
    announce("新项目已创建并保存在本机。", "completion");
  } catch (error) { announce(error.message, "error"); }
});
elements["copy-task"].addEventListener("click", () => copyTask().catch((error) => announce(error.message, "error")));
elements["primary-action"].addEventListener("click", handlePrimaryAction);

try {
  const bootstrap = await api("/api/bootstrap");
  state.token = bootstrap.token;
  state.projects = bootstrap.projects;
  if (state.projects.length) {
    state.currentProject = state.projects[0];
    state.visibleStage = state.currentProject.currentStage;
  }
  render();
} catch (error) {
  announce(`无法连接本机工作台：${error.message}`, "error");
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const extensionStorage = globalThis.chrome?.storage?.local;
const extensionPermissions = globalThis.chrome?.permissions;

const state = {
  reference: null,
  portrait: null,
  analysis: null,
  prompt: "",
  negative: "",
  generated: "",
  pendingReferenceUrl: "",
  settings: {
    apiKey: "",
    analysisModel: "gpt-5.4-mini",
    baseUrl: "https://api.openai.com/v1"
  },
  history: []
};

const transferLabels = {
  lighting: "灯光方向、软硬关系与明暗层次",
  color: "整体色调、色彩对比与氛围",
  composition: "画面构图、景别、裁切与镜头关系",
  background: "环境、背景层次与空间质感",
  pose: "人物姿势、肢体方向与视线",
  wardrobe: "服装轮廓、材质与搭配方式"
};

const modeCopy = {
  faithful: {
    title: "保真优先",
    instruction: "以本人写真为不可替换的人物主源。保持原始五官几何、脸型、年龄感、发际线、发型主体、体型比例、肤色、毛孔、细纹、痣与真实皮肤纹理；只迁移参考图的视觉效果。尽量不改变人物原有姿势和服装结构。",
    boundary: "这一路径最适合保留真实客片质感，但构图和姿势的变化幅度会更小。"
  },
  balanced: {
    title: "平衡模式",
    instruction: "保持本人身份、五官比例、年龄感、肤色和自然皮肤纹理，同时允许为接近参考图而适度调整景别、身体朝向、姿势和服装细节。",
    boundary: "姿势和裁切会更接近参考图，局部皮肤可能被重新生成。"
  },
  effect: {
    title: "效果优先",
    instruction: "优先复刻参考图的构图、姿势、光影、服装与氛围，并尽量保持本人身份可识别、肤色自然和皮肤不过度磨平。",
    boundary: "此模式会明显重绘人物，不能视为原始皮肤像素保留。"
  }
};

async function storageGet(keys) {
  if (extensionStorage) return extensionStorage.get(keys);
  const result = {};
  for (const key of keys) {
    try { result[key] = JSON.parse(localStorage.getItem(key)); }
    catch { result[key] = localStorage.getItem(key); }
  }
  return result;
}

async function storageSet(values) {
  if (extensionStorage) return extensionStorage.set(values);
  for (const [key, value] of Object.entries(values)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

async function storageRemove(keys) {
  if (extensionStorage) return extensionStorage.remove(keys);
  for (const key of keys) localStorage.removeItem(key);
}

function showToast(message, duration = 2400) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

function currentMode() {
  return $("input[name='mode']:checked")?.value || "faithful";
}

function selectedTransfers() {
  return $$("input[name='transfer']:checked").map((input) => input.value);
}

function updateTruthNote() {
  const mode = modeCopy[currentMode()];
  $("#truthNote span").textContent = mode.boundary;
}

function updateActions() {
  const hasImages = Boolean(state.reference?.dataUrl && state.portrait?.dataUrl);
  $("#generateButton").disabled = !(hasImages && state.prompt);
}

function setPreview(kind, image) {
  const preview = $(`#${kind}Preview`);
  const wrap = preview.closest(".preview-wrap");
  const status = $(`#${kind}Status`);
  preview.src = image.dataUrl;
  wrap.classList.add("has-image");
  status.textContent = kind === "reference" ? "参考图已就绪" : "人物源图已就绪";
  status.classList.add("ready");
  updateActions();
}

function fileToOptimizedImage(file, options = {}) {
  const maxDimension = options.maxDimension || 2048;
  const quality = options.quality || 0.94;

  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("请选择 JPG、PNG 或 WebP 图片。"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("无法识别这张图片。"));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("图片压缩失败。"));
            return;
          }
          const normalizedFile = new File([blob], `${file.name?.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
          resolve({
            dataUrl,
            file: normalizedFile,
            width,
            height,
            originalName: file.name || "图片"
          });
        }, "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function acceptImage(kind, file) {
  try {
    const image = await fileToOptimizedImage(file, {
      maxDimension: kind === "portrait" ? 2560 : 2048,
      quality: kind === "portrait" ? 0.96 : 0.92
    });
    state[kind] = image;
    setPreview(kind, image);
    showToast(kind === "reference" ? "参考效果图已加入" : "本人写真已加入");
  } catch (error) {
    showToast(error.message || "图片处理失败");
  }
}

function setupDropzone(kind) {
  const input = $(`#${kind}Input`);
  const dropzone = $(`#${kind}Dropzone`);
  input.addEventListener("change", () => input.files?.[0] && acceptImage(kind, input.files[0]));

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    });
  }
  dropzone.addEventListener("drop", (event) => {
    const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
    if (file) acceptImage(kind, file);
  });
}

function buildBasePrompt(analysis = null) {
  const mode = modeCopy[currentMode()];
  const transfers = selectedTransfers();
  const notes = $("#notesInput").value.trim();
  const transferText = transfers.length
    ? transfers.map((key) => transferLabels[key]).join("；")
    : "只提取整体摄影氛围，不复制参考人物";

  const discovered = analysis?.edit_prompt || analysis?.editPrompt || "请根据输入图 2 自动识别其摄影语言，并把可迁移的视觉效果应用到输入图 1。";
  const analysisSummary = analysis?.summary ? `\n参考效果分析：${analysis.summary}` : "";

  return `任务：把输入图 2 的摄影效果迁移到输入图 1，生成一张真实、可交付的商业人像写真。\n\n输入图定义：\n- 输入图 1：本人写真，是唯一的人物身份、五官、体型、肤色和皮肤质感来源。\n- 输入图 2：参考效果图，只用来学习经过选择的视觉效果；绝不复制参考图人物的脸、年龄、种族或皮肤。\n\n当前模式：${mode.title}\n${mode.instruction}\n\n需要迁移：${transferText}。${analysisSummary}\n视觉执行：${discovered}\n\n人物保真硬约束：\n1. 保持输入图 1 的人物身份与面部几何，包括脸型、眼睛、鼻子、嘴唇、耳朵、眉形和发际线。\n2. 保持真实年龄感、自然肤色、毛孔、细纹、痣、轻微肤色差异与原始皮肤纹理；禁止塑料皮、蜡像皮、陶瓷皮和过度磨皮。\n3. 不擅自瘦脸、大眼、增高鼻梁、改变下颌、改变身材比例或替换人物。\n4. 保持摄影质感，不生成插画、3D、CG、游戏角色或明显 AI 面孔。\n5. 手部、牙齿、眼神、发丝与衣物边缘必须自然，避免重影、融合和多余肢体。\n${notes ? `\n补充要求：${notes}\n` : ""}\n输出要求：真实摄影、细节清楚、自然皮肤、商业人像品质；优先竖版构图，不添加文字、水印、边框或标志。`;
}

function buildNegativePrompt(analysis = null) {
  const extra = analysis?.negative_prompt || analysis?.negativePrompt || "";
  return [
    "换脸、陌生人脸、五官漂移、年龄改变、脸型改变、发际线改变",
    "塑料皮、蜡像皮、陶瓷皮、过度磨皮、过度锐化、假毛孔、AI 皮肤",
    "动漫、插画、3D、CG、游戏建模感、假人感",
    "畸形手、额外手指、多余肢体、五官重影、发丝融合、衣物融化",
    "不自然高光、肤色断层、光线方向矛盾、背景穿帮、文字、水印、标志",
    extra
  ].filter(Boolean).join("；");
}

function templateAnalysis() {
  const transfers = selectedTransfers();
  const mode = modeCopy[currentMode()];
  return {
    summary: `已建立“${mode.title}”复刻方案。当前未调用视觉模型，因此这是一份基于所选项目生成的安全模板。`,
    composition: transfers.includes("composition") ? "按参考图迁移景别、留白与人物位置，但优先避免破坏本人五官。" : "保持本人写真原构图。",
    lighting: transfers.includes("lighting") ? "按参考图迁移主光方向、光比和阴影层次。" : "保持本人写真原有光线。",
    color: transfers.includes("color") ? "按参考图迁移综合色调与冷暖关系，肤色保持自然。" : "保持本人写真原色调。",
    background: transfers.includes("background") ? "参考图环境可替换，人物边缘与发丝需保持干净。" : "保持本人写真背景。",
    edit_prompt: "读取参考图的镜头、光影、色彩、场景和材质语言，只把被勾选的部分迁移到本人写真。",
    negative_prompt: "不要复制参考人物的脸、年龄、肤色、身材或身份特征。",
    warnings: [mode.boundary],
    isTemplate: true
  };
}

function createAnalysisItem(label, text) {
  const item = document.createElement("div");
  item.className = "analysis-item";
  const title = document.createElement("span");
  const body = document.createElement("p");
  title.textContent = label;
  body.textContent = text || "模型未返回这一项";
  item.append(title, body);
  return item;
}

function renderAnalysis(analysis) {
  const grid = $("#analysisGrid");
  grid.replaceChildren(
    createAnalysisItem("构图与镜头", analysis.composition),
    createAnalysisItem("灯光关系", analysis.lighting),
    createAnalysisItem("色调与肤色", analysis.color),
    createAnalysisItem("背景与材质", analysis.background)
  );

  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
  const warningBox = $("#warningBox");
  warningBox.textContent = warnings.join(" ");
  warningBox.classList.toggle("hidden", warnings.length === 0);

  state.analysis = analysis;
  state.prompt = buildBasePrompt(analysis);
  state.negative = buildNegativePrompt(analysis);
  $("#promptOutput").textContent = state.prompt;
  $("#negativeOutput").textContent = state.negative;
  $("#resultCard").classList.remove("hidden");
  updateActions();
}

function switchTab(name) {
  $$(".result-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== name));
  $("#resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function requireImages() {
  if (state.reference && state.portrait) return true;
  showToast("请先放入参考效果图和本人写真");
  return false;
}

function hasApiKey() {
  if (state.settings.apiKey) return true;
  $("#settingsDialog").showModal();
  showToast("AI 分析和生成需要先填写自己的 API Key", 3200);
  return false;
}

function analysisRequestPrompt() {
  const mode = modeCopy[currentMode()];
  const transferText = selectedTransfers().map((key) => transferLabels[key]).join("；");
  const notes = $("#notesInput").value.trim();
  return `你是专业商业人像摄影与图像编辑指导师。请分析两张输入图：第一张是本人写真，第二张是参考效果图。目标不是换脸，而是把参考效果迁移到真实本人写真。\n\n模式：${mode.title}。${mode.instruction}\n只迁移这些内容：${transferText || "整体氛围"}。\n${notes ? `补充要求：${notes}` : ""}\n\n必须严格区分：人物身份和真实皮肤来自第一张图；镜头、灯光、色调、构图、背景等可迁移元素来自第二张图。禁止把第二张图人物的五官、年龄、种族、肤色或身体特征带到第一张图。\n\n只返回一个 JSON 对象，不要 Markdown，不要代码块。字段必须为：\n{\n  "summary": "一段中文总结",\n  "composition": "构图、景别、镜头与姿势分析",\n  "lighting": "主光方向、软硬、光比和阴影分析",\n  "color": "综合色调、肤色保护和后期质感分析",\n  "background": "背景、空间、材质与可替换内容分析",\n  "edit_prompt": "一段适合图像编辑模型执行的中文视觉说明，不重复人物保真硬约束",\n  "negative_prompt": "针对这两张图最需要避免的问题",\n  "warnings": ["如果参考图与本人写真存在会导致身份或皮肤漂移的冲突，在这里说明"]\n}`;
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型返回内容无法解析，请再试一次。 ");
  }
}

async function callResponses(payload) {
  const base = state.settings.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${state.settings.apiKey}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `接口请求失败（${response.status}）`;
    throw new Error(message);
  }
  return data;
}

async function analyzeImages() {
  if (!requireImages() || !hasApiKey()) return;
  const button = $("#analyzeButton");
  button.classList.add("loading");
  button.disabled = true;
  showToast("正在读取参考图的光线、构图和色调……", 3600);

  try {
    const response = await callResponses({
      model: state.settings.analysisModel || "gpt-5.4-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: analysisRequestPrompt() },
          { type: "input_image", image_url: state.portrait.dataUrl, detail: "high" },
          { type: "input_image", image_url: state.reference.dataUrl, detail: "high" }
        ]
      }]
    });
    const analysis = parseModelJson(extractOutputText(response));
    renderAnalysis(analysis);
    await saveHistory("AI 已分析", analysis);
    switchTab("summary");
    showToast("参考效果分析完成");
  } catch (error) {
    showToast(error.message || "AI 分析失败", 5200);
  } finally {
    button.classList.remove("loading");
    button.disabled = false;
  }
}

function imageGenerationPrompt() {
  return `${state.prompt}\n\n现在直接生成一张完成度高的竖版商业写真。不要输出解释，不要添加拼图、对比图或文字。`;
}

async function generateImage() {
  if (!requireImages() || !state.prompt || !hasApiKey()) return;
  const button = $("#generateButton");
  button.disabled = true;
  button.textContent = "正在生成，请稍候…";
  switchTab("image");
  $("#generatedPlaceholder").classList.remove("hidden");
  $("#generatedPlaceholder").textContent = "正在保持五官与皮肤质感，并迁移参考效果……";

  try {
    const response = await callResponses({
      model: state.settings.analysisModel || "gpt-5.4-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: imageGenerationPrompt() },
          { type: "input_image", image_url: state.portrait.dataUrl, detail: "high" },
          { type: "input_image", image_url: state.reference.dataUrl, detail: "high" }
        ]
      }],
      tools: [{ type: "image_generation" }]
    });

    const imageCall = (response.output || []).find((item) => item.type === "image_generation_call" && item.result);
    if (!imageCall) {
      throw new Error(extractOutputText(response) || "模型没有返回图片，请调整要求后重试。 ");
    }

    state.generated = `data:image/png;base64,${imageCall.result}`;
    $("#generatedImage").src = state.generated;
    $("#generatedImage").classList.add("visible");
    $("#generatedPlaceholder").classList.add("hidden");
    $("#imageActions").classList.remove("hidden");
    await saveHistory("已生成效果图", state.analysis || templateAnalysis());
    showToast("写真效果图已生成，请放大检查脸、皮肤和手部");
  } catch (error) {
    $("#generatedPlaceholder").textContent = error.message || "生成失败，请检查模型设置后重试。";
    showToast(error.message || "生成失败", 5200);
  } finally {
    button.textContent = "生成写真效果图";
    button.disabled = false;
  }
}

async function saveHistory(status, analysis) {
  const item = {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
    status,
    mode: modeCopy[currentMode()].title,
    summary: analysis.summary || "写真复刻方案",
    prompt: state.prompt,
    negative: state.negative
  };
  state.history = [item, ...state.history].slice(0, 12);
  await storageSet({ nboHistory: state.history });
}

function renderHistory() {
  const list = $("#historyList");
  list.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "还没有本地历史";
    list.append(empty);
    return;
  }
  for (const item of state.history) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "history-item";
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    title.textContent = `${item.mode} · ${item.status}`;
    meta.textContent = `${new Date(item.createdAt).toLocaleString("zh-CN")} · ${item.summary}`;
    card.append(title, meta);
    card.addEventListener("click", () => {
      state.prompt = item.prompt;
      state.negative = item.negative;
      $("#promptOutput").textContent = state.prompt;
      $("#negativeOutput").textContent = state.negative;
      $("#resultCard").classList.remove("hidden");
      $("#historyDialog").close();
      switchTab("prompt");
      updateActions();
    });
    list.append(card);
  }
}

async function importRemoteReference() {
  const url = state.pendingReferenceUrl;
  if (!url) return;
  try {
    const origin = new URL(url).origin;
    if (extensionPermissions) {
      const granted = await extensionPermissions.request({ origins: [`${origin}/*`] });
      if (!granted) throw new Error("没有获得读取这张网页图片的权限。 ");
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`网页图片读取失败（${response.status}）`);
    const blob = await response.blob();
    await acceptImage("reference", new File([blob], "网页参考图", { type: blob.type || "image/jpeg" }));
    $("#loadRemoteButton").classList.add("hidden");
    await storageRemove(["pendingReferenceUrl", "pendingReferenceAt"]);
  } catch (error) {
    showToast(`${error.message || "网页图片读取失败"} 可先保存图片，再手动上传。`, 5200);
  }
}

async function loadStoredState() {
  const stored = await storageGet(["nboSettings", "nboHistory", "pendingReferenceUrl", "pendingReferenceAt"]);
  if (stored.nboSettings) state.settings = { ...state.settings, ...stored.nboSettings };
  if (Array.isArray(stored.nboHistory)) state.history = stored.nboHistory;
  if (stored.pendingReferenceUrl && Date.now() - Number(stored.pendingReferenceAt || 0) < 20 * 60 * 1000) {
    state.pendingReferenceUrl = stored.pendingReferenceUrl;
    $("#loadRemoteButton").classList.remove("hidden");
  }
  $("#apiKeyInput").value = state.settings.apiKey || "";
  $("#analysisModelInput").value = state.settings.analysisModel || "gpt-5.4-mini";
  $("#baseUrlInput").value = state.settings.baseUrl || "https://api.openai.com/v1";
}

async function saveSettings() {
  const baseUrl = $("#baseUrlInput").value.trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl)) {
    showToast("接口地址必须使用 https://");
    return;
  }
  state.settings = {
    apiKey: $("#apiKeyInput").value.trim(),
    analysisModel: $("#analysisModelInput").value.trim() || "gpt-5.4-mini",
    baseUrl
  };
  await storageSet({ nboSettings: state.settings });
  $("#settingsDialog").close();
  showToast(state.settings.apiKey ? "模型设置已保存在本机" : "设置已保存；AI 功能仍需要 API Key");
}

async function testConnection() {
  const button = $("#testConnectionButton");
  const baseUrl = $("#baseUrlInput").value.trim().replace(/\/$/, "");
  const apiKey = $("#apiKeyInput").value.trim();
  if (!apiKey) {
    showToast("请先填写 API Key");
    return;
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    showToast("接口地址必须使用 https://");
    return;
  }

  state.settings = {
    apiKey,
    analysisModel: $("#analysisModelInput").value.trim() || "gpt-5.4-mini",
    baseUrl
  };
  button.disabled = true;
  button.textContent = "测试中…";
  try {
    await callResponses({
      model: state.settings.analysisModel,
      input: "Reply with exactly: OK",
      max_output_tokens: 16
    });
    await storageSet({ nboSettings: state.settings });
    showToast("连接成功，密钥已保存到本机", 4200);
  } catch (error) {
    showToast(`连接失败：${error.message || "请检查密钥与余额"}`, 6500);
  } finally {
    button.disabled = false;
    button.textContent = "测试连接";
  }
}

function bindEvents() {
  setupDropzone("reference");
  setupDropzone("portrait");
  $$("input[name='mode']").forEach((input) => input.addEventListener("change", () => {
    updateTruthNote();
    if (state.analysis) renderAnalysis(state.analysis);
  }));
  $$("input[name='transfer']").forEach((input) => input.addEventListener("change", () => {
    if (state.analysis) renderAnalysis(state.analysis);
  }));
  $("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#testConnectionButton").addEventListener("click", testConnection);
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#historyButton").addEventListener("click", () => {
    renderHistory();
    $("#historyDialog").showModal();
  });
  $("#closeHistoryButton").addEventListener("click", () => $("#historyDialog").close());
  $("#clearHistoryButton").addEventListener("click", async () => {
    state.history = [];
    await storageRemove(["nboHistory"]);
    renderHistory();
    showToast("本地历史已清空");
  });
  $("#loadRemoteButton").addEventListener("click", importRemoteReference);
  $("#promptButton").addEventListener("click", async () => {
    if (!requireImages()) return;
    const analysis = templateAnalysis();
    renderAnalysis(analysis);
    await saveHistory("已生成指令模板", analysis);
    switchTab("prompt");
    showToast("复刻指令已生成；未调用 AI 图像识别");
  });
  $("#analyzeButton").addEventListener("click", analyzeImages);
  $("#generateButton").addEventListener("click", generateImage);
  $("#copyPromptButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText(`${state.prompt}\n\n负面约束：${state.negative}`);
    showToast("提示词已复制");
  });
  $("#downloadButton").addEventListener("click", () => {
    if (!state.generated) return;
    const anchor = document.createElement("a");
    anchor.href = state.generated;
    anchor.download = `南铂写真复刻-${new Date().toISOString().slice(0, 10)}.png`;
    anchor.click();
  });
  $$(".result-tabs button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
}

async function init() {
  bindEvents();
  await loadStoredState();
  updateTruthNote();
  updateActions();
}

init();

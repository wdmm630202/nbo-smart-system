(function () {
  const DB = window.NBO_REVIEW_DB;
  const $ = (selector) => document.querySelector(selector);
  const facts = [
    ["transparent", "价格和套餐提前说清", "价格和套餐内容提前说得很清楚"],
    ["no-push", "到店没有强制消费", "到店后没有强制消费"],
    ["guide", "摄影师会教动作", "摄影师会一步步教动作和表情"],
    ["relaxed", "拍摄过程不尴尬", "拍摄过程比想象中放松"],
    ["makeup", "妆造自然", "妆造自然，保留了本人感觉"],
    ["photo", "成片符合真实本人", "成片好看但没有修得不像自己"],
    ["selection", "选片流程清楚", "选片和后续流程讲得很清楚"],
    ["delivery", "按约定时间交付", "照片按约定时间完成交付"]
  ];
  const selectedFacts = new Set();
  let scenarioId = "first";
  let generation = 0;
  let variants = [];

  const toast = (message) => {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2100);
  };

  const normalize = (text) => text.replace(/\s+/g, " ").replace(/。。+/g, "。").trim();
  const pick = (items, offset) => items[(generation + offset) % items.length];
  const moduleCount = Object.values(DB.scenarios).reduce((sum, item) => sum + item.openers.length + item.proofs.length + item.results.length, 0);
  $("#databaseCount").textContent = `语言库 ${moduleCount} 条 · ${Object.keys(DB.scenarios).length} 个热门场景 · 本地生成`;

  function renderScenarios() {
    const root = $("#scenarios");
    root.innerHTML = "";
    Object.entries(DB.scenarios).forEach(([id, item]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenario";
      button.dataset.scenario = id;
      button.innerHTML = `<i>${item.icon}</i><b>${item.label}</b><small>${item.description}</small><em>${item.badge}</em>`;
      button.addEventListener("click", () => selectScenario(id, true));
      root.append(button);
    });
    updateScenarioState();
  }

  function renderFacts() {
    const root = $("#highlights");
    facts.forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.dataset.id = id;
      button.textContent = label;
      button.addEventListener("click", () => {
        selectedFacts.has(id) ? selectedFacts.delete(id) : selectedFacts.add(id);
        button.classList.toggle("active", selectedFacts.has(id));
        persist();
      });
      root.append(button);
    });
  }

  function updateScenarioState() {
    document.querySelectorAll(".scenario").forEach((node) => node.classList.toggle("active", node.dataset.scenario === scenarioId));
  }

  function selectScenario(id, autoGenerate) {
    scenarioId = id;
    const scenario = DB.scenarios[id];
    scenario.facts.forEach((fact) => selectedFacts.add(fact));
    document.querySelectorAll(".choice").forEach((node) => node.classList.toggle("active", selectedFacts.has(node.dataset.id)));
    updateScenarioState();
    persist();
    if (!$("#truthConfirm").checked) {
      toast("请先确认：该场景与客户真实体验相符");
      return;
    }
    if (autoGenerate) generate();
  }

  function buildVariants() {
    const s = DB.scenarios[scenarioId];
    const service = $("#service").value;
    const feeling = $("#feeling").value.trim().replace(/[。！!？?]+$/g, "");
    const extraFacts = facts.filter(([id]) => selectedFacts.has(id) && !s.facts.includes(id)).map(([, , text]) => text);
    const opener = pick(s.openers, 0);
    const proof = pick(s.proofs, 1);
    const result = pick(s.results, 2);
    const own = feeling ? `${feeling}。` : "";
    const extra = extraFacts.length ? `${extraFacts.slice(0, 2).join("，")}。` : "";
    return [
      { name: "自然口语", tag: "首选", text: normalize(`${opener}。实际拍下来，${proof}。${result}。${own}`) },
      { name: "简短高信任", tag: "适合快速发", text: normalize(`体验了${service}。${proof}，${result}。${extra}${own}`) },
      { name: "细节更完整", tag: "适合配图", text: normalize(`${opener}。这次体验的是${service}，${proof}。${extra}${result}。${own}以上都是这次实际体验，给同样有顾虑的人做个参考。`) }
    ];
  }

  function makeInvite(review) {
    const customer = $("#customer").value.trim();
    const hello = customer ? `${customer}您好～` : "您好～";
    return `${hello}照片收到后，如果您愿意，麻烦在抖音团购订单里写一下这次真实体验。\n\n下面是一段表达参考，请务必按您的实际感受删改；满意或不满意都可以直接写：\n\n${review}\n\n配图建议：1张最喜欢的成片 + 1张拍摄过程或环境图。谢谢您的真实反馈，这对我们改进很重要。`;
  }

  function useVariant(index) {
    const item = variants[index];
    if (!item) return;
    $("#review").value = item.text;
    $("#invite").value = makeInvite(item.text);
    document.querySelectorAll(".variant").forEach((node, position) => node.classList.toggle("active", position === index));
    persist();
  }

  function renderResult() {
    const scenario = DB.scenarios[scenarioId];
    $("#modeLine").innerHTML = `<b>${scenario.label}</b> · AI 只组合本次真实场景、顾虑、服务证据和结果，不复制网上评价。`;
    $("#strategyFlow").innerHTML = scenario.strategy.map((item, index) => `<b>${item}</b>${index < scenario.strategy.length - 1 ? "<i>→</i>" : ""}`).join("");
    $("#variants").innerHTML = variants.map((item, index) => `<button class="variant${index === 0 ? " active" : ""}" type="button" data-index="${index}"><header><b>${item.name}</b><span>${item.tag}</span></header><p>${item.text}</p></button>`).join("");
    document.querySelectorAll(".variant").forEach((node) => node.addEventListener("click", () => useVariant(Number(node.dataset.index))));
    useVariant(0);
  }

  function generate() {
    if (!$("#truthConfirm").checked) {
      toast("请先确认真实经历");
      return;
    }
    variants = buildVariants();
    renderResult();
    toast("已生成 3 个真实表达");
  }

  async function copyText(text, message) {
    if (!text.trim()) { toast("请先一键生成"); return false; }
    try { await navigator.clipboard.writeText(text); }
    catch (_error) {
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
    }
    toast(message);
    return true;
  }

  function persist() {
    try {
      localStorage.setItem("nbo-real-review-v2", JSON.stringify({
        truth: $("#truthConfirm").checked, scenarioId, generation, selectedFacts: [...selectedFacts],
        customer: $("#customer").value, service: $("#service").value, feeling: $("#feeling").value,
        invite: $("#invite").value, review: $("#review").value
      }));
    } catch (_error) {}
  }

  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem("nbo-real-review-v2") || "null");
      if (!data) return;
      $("#truthConfirm").checked = Boolean(data.truth);
      scenarioId = DB.scenarios[data.scenarioId] ? data.scenarioId : scenarioId;
      generation = Number(data.generation) || 0;
      (data.selectedFacts || []).forEach((id) => selectedFacts.add(id));
      ["customer", "service", "feeling", "invite", "review"].forEach((id) => { if (data[id]) $("#" + id).value = data[id]; });
    } catch (_error) {}
  }

  const shots = "南铂评价配图清单：\n1. 最满意成片：眼平正面或45°，人物约占2/3\n2. 拍摄过程：侧后方45°，记录摄影师指导动作\n3. 门店环境：入口斜角广景，保持横平竖直\n4. 服务细节：妆造或选片特写，避开客户隐私\n建议选3—5张，竖图3:4优先，不过度磨皮，不加大段宣传字。";
  const integration = "企业微信正式API对接清单：\n1. 企业ID CorpID\n2. 自建应用 AgentID 与 Secret（只放安全后端）\n3. 客户联系相关权限\n4. 可信域名与回调地址\n5. 客户 external_userid 的合规来源\n6. 发送前人工确认、日志与频率限制\n注意：不要把 Secret 写进网页，也不要自动群发。";

  renderFacts();
  restore();
  renderScenarios();
  document.querySelectorAll(".choice").forEach((node) => node.classList.toggle("active", selectedFacts.has(node.dataset.id)));
  $("#hotGenerate").disabled = !$("#truthConfirm").checked;
  $("#truthConfirm").addEventListener("change", () => { $("#hotGenerate").disabled = !$("#truthConfirm").checked; persist(); if ($("#truthConfirm").checked) toast("已确认，今后点场景即可生成"); });
  $("#hotGenerate").addEventListener("click", generate);
  $("#refresh").addEventListener("click", () => { generation += 1; persist(); generate(); });
  $("#generate").addEventListener("click", generate);
  ["customer", "service", "feeling", "invite", "review"].forEach((id) => $("#" + id).addEventListener("input", persist));
  $("#copyInvite").addEventListener("click", () => copyText($("#invite").value, "客户话术已复制"));
  $("#copyReview").addEventListener("click", () => copyText($("#review").value, "评价参考已复制"));
  $("#copyShots").addEventListener("click", () => copyText(shots, "拍摄清单已复制"));
  $("#copyIntegration").addEventListener("click", () => copyText(integration, "企业微信对接清单已复制"));
  $("#share").addEventListener("click", async () => { const text = $("#invite").value; if (!text.trim()) { toast("请先一键生成"); return; } if (navigator.share) { try { await navigator.share({ title: "南铂真实评价邀请", text }); return; } catch (error) { if (error.name === "AbortError") return; } } await copyText(text, "话术已复制"); });
  $("#wechat").addEventListener("click", async () => { if (await copyText($("#invite").value, "已复制，正在打开微信")) setTimeout(() => location.href = "weixin://", 220); });
  $("#wecom").addEventListener("click", async () => { if (await copyText($("#invite").value, "已复制，正在打开企业微信")) setTimeout(() => location.href = "wxwork://", 220); });
})();

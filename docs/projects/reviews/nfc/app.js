(function () {
  const DB = window.NBO_REVIEW_DB;
  const $ = (selector) => document.querySelector(selector);
  const choices = [
    { id: "first", icon: "初", title: "第一次拍，不会摆", note: "有人教动作和表情", tag: "我确实经历过" },
    { id: "transparent", icon: "明", title: "价格、套餐说得清", note: "没有强制增加消费", tag: "我确实经历过" },
    { id: "natural", icon: "真", title: "成片自然，像本人", note: "好看但没有修得很假", tag: "我确实经历过" },
    { id: "service", icon: "顺", title: "妆造、选片、交付顺", note: "每一步都有人说明", tag: "我确实经历过" }
  ];
  const packages = [
    { id: "268", price: "268元", title: "体验款", detail: "2套风格 · 2张精修", lead: "这次买的是268元体验款，订单包含2套风格和2张精修" },
    { id: "498", price: "498元", title: "变帅款", detail: "2套风格 · 5张精修", lead: "这次买的是498元变帅款，订单包含2套风格和5张精修" },
    { id: "698", price: "698元", title: "内外景款", detail: "1内1外 · 6张精修", lead: "这次买的是698元内外景款，订单包含1套内景、1套外景和6张精修" },
    { id: "998", price: "998元", title: "质感定制款", detail: "1内1外 · 10张精修", lead: "这次买的是998元质感定制款，订单包含1套内景、1套外景和10张精修" }
  ];
  let selectedPackage = "";
  let selected = "";
  let generation = 0;
  let variants = [];

  const toast = (message) => {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 1800);
  };
  const pick = (items, offset) => items[(generation + offset) % items.length];
  const clean = (text) => text.replace(/\s+/g, " ").replace(/。。+/g, "。").trim();

  function getScenario() {
    return DB.scenarios[selected];
  }

  function getPackage() {
    return packages.find((item) => item.id === selectedPackage);
  }

  function makeVariants() {
    const item = getScenario();
    const opener = pick(item.openers, 0);
    const proof = pick(item.proofs, 1);
    const result = pick(item.results, 2);
    const order = getPackage().lead;
    return [
      { name: "自然口语", tag: "最像自己说", text: clean(`${order}。${opener}。实际拍下来，${proof}。${result}。`) },
      { name: "简短真实", tag: "适合快速发", text: clean(`${order}。${proof}，${result}。整体是一次比较轻松、清楚的体验。`) },
      { name: "细节完整", tag: "适合配 3 张图", text: clean(`${order}。${opener}。这次从沟通到拍摄，${proof}。${result}。以上是我这次的真实感受，给有同样顾虑的人做个参考。`) }
    ];
  }

  function renderPackages() {
    $("#packages").innerHTML = packages.map((item) => `<button class="package" type="button" data-id="${item.id}" aria-pressed="false"><div><strong>${item.price}</strong><span>${item.title}<br>${item.detail}</span></div><i>✓</i></button>`).join("");
    document.querySelectorAll(".package").forEach((button) => button.addEventListener("click", () => {
      selectedPackage = button.dataset.id;
      document.querySelectorAll(".package").forEach((node) => {
        const active = node === button;
        node.classList.toggle("active", active);
        node.setAttribute("aria-pressed", String(active));
      });
      if (selected) generate();
      else setTimeout(() => $("#experience").scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }));
  }

  function renderScenarios() {
    $("#scenarios").innerHTML = choices.map((item) => `<button class="scenario" type="button" data-id="${item.id}"><i>${item.icon}</i><b>${item.title}</b><span>${item.note}</span><em>${item.tag}</em></button>`).join("");
    document.querySelectorAll(".scenario").forEach((button) => button.addEventListener("click", () => {
      if (!selectedPackage) { toast("请先点一下本次实际套餐"); $("#packages").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      selected = button.dataset.id;
      generation = 0;
      document.querySelectorAll(".scenario").forEach((node) => node.classList.toggle("active", node === button));
      generate();
      setTimeout(() => $("#result").scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }));
  }

  function useVariant(index) {
    const item = variants[index];
    if (!item) return;
    $("#review").value = item.text;
    document.querySelectorAll(".variant").forEach((node, position) => node.classList.toggle("active", position === index));
  }

  function generate() {
    if (!selected || !selectedPackage) return;
    variants = makeVariants();
    $("#variants").innerHTML = variants.map((item, index) => `<button class="variant${index === 0 ? " active" : ""}" type="button" data-index="${index}"><div><b>${item.name}</b><span>${item.text}</span></div><i>✓</i></button>`).join("");
    document.querySelectorAll(".variant").forEach((node) => node.addEventListener("click", () => useVariant(Number(node.dataset.index))));
    $("#result").classList.add("show");
    const order = getPackage();
    $("#package-summary").textContent = `${order.price} · ${order.title}`;
    useVariant(0);
  }

  async function copyReview(message) {
    const text = $("#review").value.trim();
    if (!text) { toast("请先选择真实经历"); return false; }
    try { await navigator.clipboard.writeText(text); }
    catch (_error) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast(message);
    return true;
  }

  renderPackages();
  renderScenarios();
  $("#copy").addEventListener("click", () => copyReview("评价已复制"));
  $("#refresh").addEventListener("click", () => { if (!selected) return; generation += 1; generate(); toast("已换一批表达"); });
  $("#share").addEventListener("click", async () => {
    const text = $("#review").value.trim();
    if (!text) { toast("请先选择真实经历"); return; }
    if (navigator.share) {
      try { await navigator.share({ title: "我的真实体验", text }); return; }
      catch (error) { if (error.name === "AbortError") return; }
    }
    await copyReview("已复制，可粘贴到任意应用");
  });
  $("#douyin").addEventListener("click", async () => {
    if (!(await copyReview("已复制；请扫描前台官方评价码"))) return;
    location.href = "snssdk1128://";
  });
})();

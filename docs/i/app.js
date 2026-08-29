const ENDPOINT = "https://p.nanbostudio.com/api/portfolio-analytics/insights";
const TOKEN_KEY = "nanbo-portfolio-insights-access";

const elements = {
  access: document.querySelector("#access-card"), accessForm: document.querySelector("#access-form"), accessInput: document.querySelector("#access-token"),
  accessError: document.querySelector("#access-error"), loading: document.querySelector("#loading-card"), report: document.querySelector("#report"),
  status: document.querySelector("#report-status"), refresh: document.querySelector("#refresh-button"), metrics: document.querySelector("#metric-grid"),
  recommendations: document.querySelector("#recommendations"), photos: document.querySelector("#photos"), themes: document.querySelector("#themes"),
  sources: document.querySelector("#sources"), sessions: document.querySelector("#sessions"), experience: document.querySelector("#experience"),
};

let activeDays = 30;
let accessToken = readAccessToken();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function readAccessToken() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const fromLink = hash.get("key") || "";
  if (fromLink) {
    try { localStorage.setItem(TOKEN_KEY, fromLink); } catch { /* device storage is optional */ }
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return fromLink;
  }
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function percent(numerator, denominator) { return denominator ? `${Math.round((numerator / denominator) * 100)}%` : "—"; }
function duration(seconds) {
  const safe = Math.max(0, Math.round(number(seconds)));
  if (safe < 60) return `${safe}秒`;
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder ? `${minutes}分${remainder}秒` : `${minutes}分钟`;
}
function localTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function deviceLabel(value) { return value === "mobile" ? "手机" : value === "tablet" ? "平板" : value === "desktop" ? "电脑" : "未知"; }
function sourceLabel(value) {
  return ({ direct: "直接打开", wechat: "微信", wecom: "企业微信", douyin: "抖音", xiaohongshu: "小红书", search: "搜索" })[value] || value || "直接打开";
}
function intentLabel(score) { return score >= 50 ? "高意向" : score >= 20 ? "有兴趣" : "普通浏览"; }
function scoreClass(score) { return score >= 50 ? "is-hot" : score >= 20 ? "is-warm" : ""; }
function emptyCopy(message) { return `<p class="empty-copy">${escapeHtml(message)}</p>`; }

function recommendations(summary, photos, themes, sources) {
  const items = [];
  if (photos[0]) items.push(`客户打开最多的是 ${photos[0].label || photos[0].key}，适合放到首屏或销售常用分享图。`);
  if (themes[0]) items.push(`当前最受关注的主题是“${themes[0].label || themes[0].key}”，下一批内容和样片可优先加强。`);
  const bestSource = [...sources].sort((left, right) => number(right.conversions) - number(left.conversions))[0];
  if (bestSource && number(bestSource.conversions) > 0) items.push(`${sourceLabel(bestSource.key)}带来的“复制需求”最多，继续使用同一渠道参数，方便判断投放质量。`);
  if (number(summary.sessions) >= 5 && number(summary.copied) === 0) items.push("有人浏览但尚未复制拍摄需求，下一步应补充清晰的咨询入口与档期行动按钮。");
  if (summary.lcp_good !== null && number(summary.lcp_good) < 75) items.push("首屏速度达标率低于 75%，先优化图片加载，再增加任何营销组件。");
  return items.slice(0, 4);
}

function render(data) {
  const summary = data.summary || {};
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const themes = Array.isArray(data.themes) ? data.themes : [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const lcp = summary.lcp_good === null || summary.lcp_good === undefined ? "采集中" : `${number(summary.lcp_good)}%`;

  elements.metrics.innerHTML = [
    ["匿名访客会话", number(summary.sessions), `${number(summary.mobile)} 次来自手机`, ""],
    ["平均有效浏览", duration(summary.avg_active), "只算页面可见且在操作", ""],
    ["有效浏览率", percent(number(summary.engaged), number(summary.sessions)), "30 秒以上或看 3 张作品", ""],
    ["高意向会话", number(summary.high_intent), `${percent(number(summary.high_intent), number(summary.sessions))} 的浏览会话`, "hot"],
    ["复制拍摄需求", number(summary.copied), "当前最接近咨询的动作", ""],
    ["页面体验", lcp, "首屏 2.5 秒内达标率", ""],
  ].map(([label, value, note, className]) => `<article class="${className}"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`).join("");

  const tips = recommendations(summary, photos, themes, sources);
  elements.recommendations.innerHTML = tips.length ? tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("") : `<li>数据还不够。先正常分享客片网址，产生 5 次以上匿名浏览后，这里会给出可执行建议。</li>`;
  const ranks = (items, fallback) => items.length ? items.map((item, index) => `<div><b>${String(index + 1).padStart(2, "0")}</b><span><strong>${escapeHtml(item.label || item.key)}</strong><small>${escapeHtml(item.key)}</small></span><em>${number(item.total)} 次</em></div>`).join("") : emptyCopy(fallback);
  elements.photos.innerHTML = ranks(photos, "暂无作品打开记录");
  elements.themes.innerHTML = ranks(themes, "暂无主题偏好记录");
  elements.sources.innerHTML = sources.length ? sources.map((item) => `<div><strong>${escapeHtml(sourceLabel(item.key))}</strong><span>${number(item.total)} 次浏览</span><em>${number(item.conversions)} 次复制需求</em></div>`).join("") : emptyCopy("暂无来源数据");
  elements.sessions.innerHTML = sessions.length ? sessions.map((session) => `<article>
    <div class="session-main"><span class="intent-badge ${scoreClass(number(session.intent_score))}">${intentLabel(number(session.intent_score))}</span><strong>访客 ${escapeHtml(String(session.session_id || "").slice(-6).toUpperCase())}</strong><small>${escapeHtml(localTime(session.started_at))} · ${deviceLabel(session.device)} · ${escapeHtml(sourceLabel(session.source))}</small></div>
    <div><small>有效 / 总停留</small><strong>${duration(session.active_seconds)} / ${duration(session.elapsed_seconds)}</strong></div>
    <div><small>浏览深度</small><strong>${number(session.photo_views)} 张 · ${number(session.max_scroll)}%</strong></div>
    <div><small>成交信号</small><strong>${number(session.favorite_count)} 收藏 · ${number(session.brief_copies)} 复制</strong></div>
    <div class="session-score"><small>意向分</small><strong>${number(session.intent_score)}</strong></div>
  </article>`).join("") : emptyCopy("上线后，有客户正常浏览客片，这里就会出现匿名明细。");
  elements.experience.innerHTML = `<span>LCP ≤ 2.5s：${lcp}</span><span>交互 ≤ 200ms：${summary.interaction_good === null || summary.interaction_good === undefined ? "采集中" : `${number(summary.interaction_good)}%`}</span><span>布局稳定：${summary.cls_good === null || summary.cls_good === undefined ? "采集中" : `${number(summary.cls_good)}%`}</span>`;
  elements.status.textContent = `近 ${data.days} 天 · 更新于 ${localTime(data.generatedAt)}`;
}

function showAccess(message = "") {
  elements.loading.hidden = true;
  elements.report.hidden = true;
  elements.access.hidden = false;
  elements.accessError.textContent = message;
  elements.accessInput.focus();
}

async function loadReport() {
  if (!accessToken) return showAccess();
  elements.access.hidden = true;
  elements.report.hidden = true;
  elements.loading.hidden = false;
  elements.refresh.disabled = true;
  elements.status.textContent = "正在读取最新数据…";
  try {
    const response = await fetch(`${ENDPOINT}?days=${activeDays}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (response.status === 401) {
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage is optional */ }
      accessToken = "";
      showAccess("访问码无效，请检查后重试。");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    elements.loading.hidden = true;
    elements.report.hidden = false;
  } catch {
    elements.loading.hidden = true;
    elements.report.hidden = false;
    elements.status.textContent = "数据连接暂时失败";
    elements.metrics.innerHTML = `<article class="error-state"><small>连接状态</small><strong>暂时失败</strong><span>客片网站不受影响，请稍后点“刷新数据”</span></article>`;
  } finally {
    elements.refresh.disabled = false;
  }
}

elements.accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  accessToken = elements.accessInput.value.trim();
  if (!accessToken) return;
  try { localStorage.setItem(TOKEN_KEY, accessToken); } catch { /* storage is optional */ }
  loadReport();
});
elements.refresh.addEventListener("click", loadReport);
document.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => {
  activeDays = Number(button.dataset.days);
  document.querySelectorAll("[data-days]").forEach((item) => item.classList.toggle("active", item === button));
  loadReport();
}));

loadReport();

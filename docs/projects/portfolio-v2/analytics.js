const ENDPOINT = location.hostname === "p.nanbostudio.com"
  ? "/api/portfolio-analytics/collect"
  : "https://nanbo-digital-systems.wdmm630202.chatgpt.site/api/portfolio-analytics/collect";
const CONSENT_KEY = "nanbo-anonymous-analytics-consent";
const SESSION_KEY = "nanbo-anonymous-analytics-session";
const MAX_EVENTS_PER_SEND = 20;

function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY) || ""; } catch { return ""; }
}

function saveConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { return; }
}

function showConsent() {
  if (document.querySelector(".analytics-consent")) return;
  const notice = document.createElement("aside");
  notice.className = "analytics-consent";
  notice.setAttribute("aria-label", "匿名浏览统计说明");
  notice.innerHTML = `<div><strong>帮助南铂把客片做得更好</strong><span>是否同意匿名记录浏览时长、作品偏好与页面速度？不收集姓名、手机号、IP 或设备指纹。</span><a href="/nbo-smart-system/p/privacy.html">查看说明</a></div><div class="analytics-consent-actions"><button type="button" data-consent="no">暂不</button><button type="button" data-consent="yes">同意</button></div>`;
  notice.addEventListener("click", (event) => {
    const button = event.target.closest("[data-consent]");
    if (!button) return;
    const answer = button.dataset.consent;
    saveConsent(answer);
    notice.remove();
    if (answer === "yes") startAnalytics();
  });
  document.body.append(notice);
}

function randomId() { return crypto.randomUUID(); }

function readSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = randomId();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch { return randomId(); }
}

function safeCampaignValue(params, name, fallback) {
  const value = params.get(name);
  return value ? value.trim().slice(0, 80) : fallback;
}

function referralSource(params) {
  const explicit = safeCampaignValue(params, "utm_source", "").toLowerCase();
  if (explicit) return explicit;
  if (!document.referrer) return "direct";
  try {
    const hostname = new URL(document.referrer).hostname.toLowerCase();
    if (hostname.includes("weixin") || hostname.includes("wechat")) return "wechat";
    if (hostname.includes("xiaohongshu") || hostname.includes("xhslink")) return "xiaohongshu";
    if (hostname.includes("douyin")) return "douyin";
    if (hostname.includes("google") || hostname.includes("baidu") || hostname.includes("bing")) return "search";
    return hostname.slice(0, 40);
  } catch { return "direct"; }
}

function referrerDomain() {
  if (!document.referrer) return "";
  try {
    const url = new URL(document.referrer);
    return url.origin === location.origin ? "" : url.hostname.slice(0, 120);
  } catch { return ""; }
}

function deviceType() {
  if (matchMedia("(max-width: 767px)").matches) return "mobile";
  if (matchMedia("(max-width: 1024px)").matches) return "tablet";
  return "desktop";
}

let started = false;
function startAnalytics() {
  if (started || readConsent() !== "yes") return;
  started = true;

  const params = new URLSearchParams(location.search);
  const sessionId = readSessionId();
  const startedAt = new Date().toISOString();
  const openedPhotos = new Set();
  const snapshot = {
    id: sessionId, startedAt, lastSeenAt: startedAt, activeSeconds: 0, maxScroll: 0,
    device: deviceType(), source: referralSource(params), medium: safeCampaignValue(params, "utm_medium", "none"),
    campaign: safeCampaignValue(params, "utm_campaign", ""), referrerDomain: referrerDomain(),
    landingPath: location.pathname.slice(0, 120), photoViews: 0, favoriteActions: 0, favoriteCount: 0,
    briefOpens: 0, briefCopies: 0, filterChanges: 0, lcpMs: 0, interactionMs: 0, clsMilli: 0,
  };
  const pending = [];
  let lastActivity = performance.now();
  let lastTick = performance.now();
  let sending = false;

  function noteActivity() { lastActivity = performance.now(); }
  function updateScroll() {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    snapshot.maxScroll = Math.max(snapshot.maxScroll, Math.min(100, Math.round((scrollY / scrollable) * 100)));
  }

  function queueEvent(event) {
    if (!event || typeof event.type !== "string") return;
    const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
    const normalized = {
      id: typeof event.id === "string" ? event.id : randomId(), type: event.type,
      targetId: String(detail.targetId || "").slice(0, 64), targetLabel: String(detail.targetLabel || "").slice(0, 80),
      theme: String(detail.theme || "").slice(0, 64), scene: String(detail.scene || "").slice(0, 32),
      at: typeof event.at === "string" ? event.at : new Date().toISOString(),
    };
    if (normalized.type === "photo_open") { openedPhotos.add(normalized.targetId); snapshot.photoViews = openedPhotos.size; }
    else if (normalized.type === "favorite_add" || normalized.type === "favorite_remove") { snapshot.favoriteActions += 1; snapshot.favoriteCount = Math.max(0, Number(detail.favoriteCount) || 0); }
    else if (normalized.type === "brief_open") snapshot.briefOpens += 1;
    else if (normalized.type === "brief_copy") snapshot.briefCopies += 1;
    else if (normalized.type === "scene_filter" || normalized.type === "theme_filter") snapshot.filterChanges += 1;
    pending.push(normalized);
    noteActivity();
    if (pending.length >= 8) send(false);
  }

  function payload() {
    snapshot.lastSeenAt = new Date().toISOString();
    return JSON.stringify({ session: snapshot, events: pending.splice(0, MAX_EVENTS_PER_SEND) });
  }

  function send(final) {
    if (sending && !final) return;
    const body = payload();
    if (final && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      return;
    }
    sending = true;
    fetch(ENDPOINT, { method: "POST", mode: "cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" }, body })
      .catch(() => {}).finally(() => { sending = false; });
  }

  function observePerformance() {
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) snapshot.lcpMs = Math.round(last.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch { return; }
    try {
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value;
        snapshot.clsMilli = Math.round(cls * 1000);
      }).observe({ type: "layout-shift", buffered: true });
    } catch { return; }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.interactionId) snapshot.interactionMs = Math.max(snapshot.interactionMs, Math.round(entry.duration));
      }).observe({ type: "event", buffered: true, durationThreshold: 40 });
    } catch { return; }
  }

  const queued = Array.isArray(window.__nanboAnalyticsQueue) ? window.__nanboAnalyticsQueue.splice(0) : [];
  queued.forEach(queueEvent);
  window.__nanboAnalyticsReady = true;
  queueEvent({ id: randomId(), type: "page_view", detail: {}, at: startedAt });
  window.addEventListener("nanbo:analytics", (event) => queueEvent(event.detail));
  ["pointerdown", "keydown", "touchstart"].forEach((name) => window.addEventListener(name, noteActivity, { passive: true }));
  window.addEventListener("scroll", updateScroll, { passive: true });
  updateScroll();
  observePerformance();

  window.setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min(10, Math.max(0, Math.round((now - lastTick) / 1000)));
    lastTick = now;
    if (document.visibilityState === "visible" && now - lastActivity <= 30_000) snapshot.activeSeconds += elapsed;
  }, 10_000);
  window.setInterval(() => send(false), 30_000);
  window.setTimeout(() => send(false), 5_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") send(true);
    else { lastTick = performance.now(); noteActivity(); }
  });
  window.addEventListener("pagehide", () => send(true), { once: true });
}

const consent = readConsent();
if (consent === "yes") startAnalytics();
else if (!consent) window.setTimeout(showConsent, 900);

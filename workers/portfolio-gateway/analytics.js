const EVENT_TYPES = new Set([
  "page_view",
  "photo_open",
  "favorite_add",
  "favorite_remove",
  "scene_filter",
  "theme_filter",
  "load_more",
  "brief_open",
  "brief_copy",
  "style_favorite_add",
  "style_favorite_remove",
  "pose_select_add",
  "pose_select_remove",
  "style_album_open",
  "style_viewer_open",
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin") || "";
  if (origin === "https://p.nanbostudio.com" || origin === "https://wdmm630202.github.io") return origin;
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return origin;
  } catch {
    return "";
  }
  return "";
}

function textValue(value, maxLength, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function integerValue(value, min, max, fallback = 0) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, number));
}

function isoValue(value, fallback) {
  if (typeof value !== "string" || value.length > 32) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function scoreIntent(session) {
  let score = 0;
  if (session.activeSeconds >= 30) score += 5;
  if (session.activeSeconds >= 90) score += 8;
  if (session.maxScroll >= 50) score += 5;
  if (session.maxScroll >= 85) score += 5;
  if (session.photoViews >= 3) score += 8;
  if (session.photoViews >= 8) score += 8;
  if (session.favoriteActions > 0 || session.favoriteCount > 0) score += 15;
  if (session.briefOpens > 0) score += 20;
  if (session.briefCopies > 0) score += 35;
  return Math.min(100, score);
}

export async function collectAnalytics(request, database) {
  const origin = allowedOrigin(request);
  if (!origin) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { ...headers, Allow: "POST, OPTIONS" } });
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 24_000) return Response.json({ error: "payload_too_large" }, { status: 413, headers });

  try {
    const raw = await request.text();
    if (raw.length > 24_000) return Response.json({ error: "payload_too_large" }, { status: 413, headers });
    const payload = JSON.parse(raw);
    const source = payload?.session;
    const now = new Date().toISOString();
    const sessionId = textValue(source?.id, 64);
    if (!/^[a-f0-9-]{20,64}$/i.test(sessionId)) {
      return Response.json({ error: "invalid_session" }, { status: 400, headers });
    }
    if (!database) return Response.json({ error: "database_unavailable" }, { status: 503, headers });

    const session = {
      id: sessionId,
      startedAt: isoValue(source?.startedAt, now),
      lastSeenAt: isoValue(source?.lastSeenAt, now),
      activeSeconds: integerValue(source?.activeSeconds, 0, 21_600),
      maxScroll: integerValue(source?.maxScroll, 0, 100),
      device: textValue(source?.device, 16, "unknown"),
      source: textValue(source?.source, 40, "direct") || "direct",
      medium: textValue(source?.medium, 40, "none") || "none",
      campaign: textValue(source?.campaign, 80),
      referrerDomain: textValue(source?.referrerDomain, 120),
      landingPath: textValue(source?.landingPath, 120, "/") || "/",
      photoViews: integerValue(source?.photoViews, 0, 500),
      favoriteActions: integerValue(source?.favoriteActions, 0, 500),
      favoriteCount: integerValue(source?.favoriteCount, 0, 158),
      briefOpens: integerValue(source?.briefOpens, 0, 100),
      briefCopies: integerValue(source?.briefCopies, 0, 100),
      filterChanges: integerValue(source?.filterChanges, 0, 500),
      lcpMs: integerValue(source?.lcpMs, 0, 60_000),
      interactionMs: integerValue(source?.interactionMs, 0, 10_000),
      clsMilli: integerValue(source?.clsMilli, 0, 10_000),
    };
    const intentScore = scoreIntent(session);
    const retentionCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const statements = [database.prepare(`
      INSERT INTO portfolio_sessions (
        session_id, started_at, last_seen_at, active_seconds, max_scroll, device,
        source, medium, campaign, referrer_domain, landing_path, photo_views,
        favorite_actions, favorite_count, brief_opens, brief_copies, filter_changes,
        lcp_ms, interaction_ms, cls_milli, intent_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
        active_seconds = MAX(active_seconds, excluded.active_seconds),
        max_scroll = MAX(max_scroll, excluded.max_scroll),
        photo_views = MAX(photo_views, excluded.photo_views),
        favorite_actions = MAX(favorite_actions, excluded.favorite_actions),
        favorite_count = excluded.favorite_count,
        brief_opens = MAX(brief_opens, excluded.brief_opens),
        brief_copies = MAX(brief_copies, excluded.brief_copies),
        filter_changes = MAX(filter_changes, excluded.filter_changes),
        lcp_ms = MAX(COALESCE(lcp_ms, 0), excluded.lcp_ms),
        interaction_ms = MAX(COALESCE(interaction_ms, 0), excluded.interaction_ms),
        cls_milli = MAX(COALESCE(cls_milli, 0), excluded.cls_milli),
        intent_score = MAX(intent_score, excluded.intent_score)
    `).bind(
      session.id, session.startedAt, session.lastSeenAt, session.activeSeconds, session.maxScroll,
      session.device, session.source, session.medium, session.campaign, session.referrerDomain,
      session.landingPath, session.photoViews, session.favoriteActions, session.favoriteCount,
      session.briefOpens, session.briefCopies, session.filterChanges, session.lcpMs,
      session.interactionMs, session.clsMilli, intentScore,
    )];

    const events = Array.isArray(payload?.events) ? payload.events.slice(0, 20) : [];
    for (const event of events) {
      const eventType = textValue(event?.type, 32);
      const eventId = textValue(event?.id, 80);
      if (!EVENT_TYPES.has(eventType) || !/^[a-f0-9-]{20,80}$/i.test(eventId)) continue;
      statements.push(database.prepare(`
        INSERT OR IGNORE INTO portfolio_interactions (
          event_id, session_id, event_type, target_id, target_label, theme, scene, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        eventId,
        session.id,
        eventType,
        textValue(event?.targetId, 64),
        textValue(event?.targetLabel, 80),
        textValue(event?.theme, 64),
        textValue(event?.scene, 32),
        isoValue(event?.at, now),
      ));
    }

    if (session.id.replaceAll("-", "").startsWith("0")) {
      statements.push(database.prepare("DELETE FROM portfolio_interactions WHERE occurred_at < ?").bind(retentionCutoff));
      statements.push(database.prepare("DELETE FROM portfolio_sessions WHERE last_seen_at < ?").bind(retentionCutoff));
    }
    await database.batch(statements);
    return Response.json({ ok: true }, { status: 202, headers });
  } catch (error) {
    console.error("portfolio analytics collect failed", error);
    return Response.json({ error: "collect_failed" }, { status: 500, headers });
  }
}

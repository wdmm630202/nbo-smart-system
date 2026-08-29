const PUBLIC_ORIGINS = new Set([
  "https://p.nanbostudio.com",
  "https://wdmm630202.github.io",
]);

function allowedOrigin(request) {
  const origin = request.headers.get("origin") || "";
  if (PUBLIC_ORIGINS.has(origin)) return origin;
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return origin;
  } catch {
    return "";
  }
  return "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function secureEqual(actual, expected) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = actual.length === expected.length ? 0 : 1;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function getAnalyticsInsights(request, database, expectedToken) {
  const origin = allowedOrigin(request);
  if (!origin) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { ...headers, Allow: "GET, OPTIONS" } });
  }
  const token = bearerToken(request);
  if (!expectedToken || !token || !(await secureEqual(token, expectedToken))) {
    return Response.json({ error: "access_denied" }, { status: 401, headers });
  }
  if (!database) return Response.json({ error: "database_unavailable" }, { status: 503, headers });

  const requestedDays = Number(new URL(request.url).searchParams.get("days") || 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const period = `-${days} days`;

  try {
    const results = await database.batch([
      database.prepare(`
        SELECT
          COUNT(*) AS sessions,
          SUM(CASE WHEN active_seconds >= 30 OR photo_views >= 3 THEN 1 ELSE 0 END) AS engaged,
          SUM(CASE WHEN intent_score >= 20 THEN 1 ELSE 0 END) AS interested,
          SUM(CASE WHEN intent_score >= 50 THEN 1 ELSE 0 END) AS high_intent,
          SUM(CASE WHEN brief_copies > 0 THEN 1 ELSE 0 END) AS copied,
          ROUND(AVG(active_seconds)) AS avg_active,
          SUM(CASE WHEN device = 'mobile' THEN 1 ELSE 0 END) AS mobile,
          ROUND(100.0 * AVG(CASE WHEN lcp_ms > 0 THEN lcp_ms <= 2500 END)) AS lcp_good,
          ROUND(100.0 * AVG(CASE WHEN interaction_ms > 0 THEN interaction_ms <= 200 END)) AS interaction_good,
          ROUND(100.0 * AVG(CASE WHEN cls_milli > 0 THEN cls_milli <= 100 END)) AS cls_good
        FROM portfolio_sessions
        WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      `).bind(period),
      database.prepare(`
        SELECT target_id AS key, MAX(target_label) AS label, COUNT(*) AS total
        FROM portfolio_interactions
        WHERE event_type = 'photo_open' AND occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        GROUP BY target_id ORDER BY total DESC LIMIT 8
      `).bind(period),
      database.prepare(`
        SELECT theme AS key, MAX(target_label) AS label, COUNT(*) AS total
        FROM portfolio_interactions
        WHERE event_type = 'photo_open' AND theme <> '' AND occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        GROUP BY theme ORDER BY total DESC LIMIT 8
      `).bind(period),
      database.prepare(`
        SELECT source AS key, source AS label, COUNT(*) AS total,
          SUM(CASE WHEN brief_copies > 0 THEN 1 ELSE 0 END) AS conversions
        FROM portfolio_sessions
        WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        GROUP BY source ORDER BY total DESC LIMIT 8
      `).bind(period),
      database.prepare(`
        SELECT session_id, started_at, last_seen_at,
          MAX(0, ROUND((julianday(last_seen_at) - julianday(started_at)) * 86400)) AS elapsed_seconds,
          active_seconds, device, source, campaign, photo_views, favorite_count,
          brief_opens, brief_copies, max_scroll, intent_score
        FROM portfolio_sessions
        WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        ORDER BY last_seen_at DESC LIMIT 60
      `).bind(period),
    ]);

    return Response.json({
      ok: true,
      days,
      generatedAt: new Date().toISOString(),
      summary: results[0].results[0] || {},
      photos: results[1].results,
      themes: results[2].results,
      sources: results[3].results,
      sessions: results[4].results,
    }, { headers });
  } catch (error) {
    console.error("portfolio insights failed", error);
    return Response.json({ error: "insights_failed" }, { status: 500, headers });
  }
}

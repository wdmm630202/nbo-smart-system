import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import "./insights.css";

export const dynamic = "force-dynamic";

type SummaryRow = {
  sessions: number;
  engaged: number;
  interested: number;
  high_intent: number;
  copied: number;
  avg_active: number;
  mobile: number;
  lcp_good: number | null;
  interaction_good: number | null;
  cls_good: number | null;
};

type RankedRow = { key: string; label: string; sessions?: number; total: number; conversions?: number };
type SessionRow = {
  session_id: string;
  started_at: string;
  last_seen_at: string;
  elapsed_seconds: number;
  active_seconds: number;
  device: string;
  source: string;
  campaign: string;
  photo_views: number;
  favorite_count: number;
  brief_opens: number;
  brief_copies: number;
  max_scroll: number;
  intent_score: number;
};

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function percent(numerator: number, denominator: number) {
  return denominator ? `${Math.round((numerator / denominator) * 100)}%` : "—";
}

function duration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}分${remainder}秒` : `${minutes}分钟`;
}

function localTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function deviceLabel(value: string) {
  return value === "mobile" ? "手机" : value === "tablet" ? "平板" : value === "desktop" ? "电脑" : "未知";
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    direct: "直接打开",
    wechat: "微信",
    wecom: "企业微信",
    douyin: "抖音",
    xiaohongshu: "小红书",
    search: "搜索",
  };
  return labels[source] || source || "直接打开";
}

function intentLabel(score: number) {
  if (score >= 50) return "高意向";
  if (score >= 20) return "有兴趣";
  return "普通浏览";
}

function scoreClass(score: number) {
  return score >= 50 ? "is-hot" : score >= 20 ? "is-warm" : "";
}

function recommendation(summary: SummaryRow, photos: RankedRow[], themes: RankedRow[], sources: RankedRow[]) {
  const items: string[] = [];
  if (photos[0]) items.push(`客户打开最多的是 ${photos[0].label || photos[0].key}，适合放到首屏或销售常用分享图。`);
  if (themes[0]) items.push(`当前最受关注的主题是“${themes[0].label || themes[0].key}”，下一批内容和样片可优先加强。`);
  const bestSource = [...sources].sort((a, b) => number(b.conversions) - number(a.conversions))[0];
  if (bestSource && number(bestSource.conversions) > 0) items.push(`${sourceLabel(bestSource.key)}带来的“复制需求”最多，继续使用同一渠道参数，方便判断投放质量。`);
  if (summary.sessions >= 5 && summary.copied === 0) items.push("有人浏览但尚未复制拍摄需求，下一步应补充清晰的咨询入口与档期行动按钮。 ");
  if (summary.lcp_good !== null && summary.lcp_good < 75) items.push("首屏速度达标率低于 75%，先优化图片加载，再增加任何营销组件。 ");
  return items.slice(0, 4);
}

export default async function PortfolioInsights({ searchParams }: { searchParams?: Promise<{ days?: string }> }) {
  const requested = Number((await searchParams)?.days || 30);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const returnTo = `/i?days=${days}`;
  const user = await getChatGPTUser();
  if (!user) redirect(chatGPTSignInPath(returnTo));

  const runtime = env as typeof env & { PORTFOLIO_OWNER_USER_ID?: string };
  if (!runtime.PORTFOLIO_OWNER_USER_ID || user.userId !== runtime.PORTFOLIO_OWNER_USER_ID) {
    return (
      <main className="insights-shell access-denied">
        <p>NANBO PRIVATE INSIGHTS</p><h1>此页仅限南铂负责人查看</h1><Link href="/">返回系统首页</Link>
      </main>
    );
  }

  const period = `-${days} days`;
  const results = await runtime.DB.batch([
    runtime.DB.prepare(`
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
    runtime.DB.prepare(`
      SELECT target_id AS key, MAX(target_label) AS label, COUNT(*) AS total
      FROM portfolio_interactions
      WHERE event_type = 'photo_open' AND occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      GROUP BY target_id ORDER BY total DESC LIMIT 8
    `).bind(period),
    runtime.DB.prepare(`
      SELECT theme AS key, MAX(target_label) AS label, COUNT(*) AS total
      FROM portfolio_interactions
      WHERE event_type = 'photo_open' AND theme <> '' AND occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      GROUP BY theme ORDER BY total DESC LIMIT 8
    `).bind(period),
    runtime.DB.prepare(`
      SELECT source AS key, source AS label, COUNT(*) AS total,
        SUM(CASE WHEN brief_copies > 0 THEN 1 ELSE 0 END) AS conversions
      FROM portfolio_sessions
      WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      GROUP BY source ORDER BY total DESC LIMIT 8
    `).bind(period),
    runtime.DB.prepare(`
      SELECT session_id, started_at, last_seen_at,
        MAX(0, ROUND((julianday(last_seen_at) - julianday(started_at)) * 86400)) AS elapsed_seconds,
        active_seconds, device, source, campaign, photo_views, favorite_count,
        brief_opens, brief_copies, max_scroll, intent_score
      FROM portfolio_sessions
      WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      ORDER BY last_seen_at DESC LIMIT 60
    `).bind(period),
  ]);

  const summary = (results[0].results[0] || {}) as unknown as SummaryRow;
  const photos = results[1].results as unknown as RankedRow[];
  const themes = results[2].results as unknown as RankedRow[];
  const sources = results[3].results as unknown as RankedRow[];
  const sessions = results[4].results as unknown as SessionRow[];
  const tips = recommendation(summary, photos, themes, sources);

  return (
    <main className="insights-shell">
      <header className="insights-head">
        <div><p>NANBO PORTFOLIO INSIGHTS</p><h1>客户浏览与成交信号</h1><span>匿名会话 · 只统计客户同意后的数据 · 自动保留 90 天</span></div>
        <a className="view-portfolio" href="https://wdmm630202.github.io/nbo-smart-system/p/" target="_blank" rel="noreferrer">打开客片网站 ↗</a>
      </header>

      <nav className="range-tabs" aria-label="统计周期">
        {[7, 30, 90].map((value) => <a key={value} className={days === value ? "active" : ""} href={`/i?days=${value}`}>近 {value} 天</a>)}
      </nav>

      <section className="metric-grid" aria-label="核心指标">
        <article><small>匿名访客会话</small><strong>{number(summary.sessions)}</strong><span>{number(summary.mobile)} 次来自手机</span></article>
        <article><small>平均有效浏览</small><strong>{duration(number(summary.avg_active))}</strong><span>只算页面可见且在操作</span></article>
        <article><small>有效浏览率</small><strong>{percent(number(summary.engaged), number(summary.sessions))}</strong><span>30 秒以上或看 3 张作品</span></article>
        <article className="hot"><small>高意向会话</small><strong>{number(summary.high_intent)}</strong><span>{percent(number(summary.high_intent), number(summary.sessions))} 的浏览会话</span></article>
        <article><small>复制拍摄需求</small><strong>{number(summary.copied)}</strong><span>当前最接近咨询的动作</span></article>
        <article><small>页面体验</small><strong>{summary.lcp_good === null ? "采集中" : `${summary.lcp_good}%`}</strong><span>首屏 2.5 秒内达标率</span></article>
      </section>

      <section className="insight-card action-card">
        <header><div><small>PRODUCT MANAGER SUMMARY</small><h2>本期该怎么做</h2></div><span>自动提炼</span></header>
        {tips.length ? <ol>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ol> : <p className="empty-copy">数据还不够。先正常分享客片网址，产生 5 次以上同意统计的浏览后，这里会给出可执行建议。</p>}
      </section>

      <div className="insights-columns">
        <section className="insight-card">
          <header><div><small>TOP PHOTOS</small><h2>最常打开的作品</h2></div></header>
          <div className="rank-list">{photos.length ? photos.map((item, index) => <div key={item.key}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.label || item.key}</strong><small>{item.key}</small></span><em>{item.total} 次</em></div>) : <p className="empty-copy">暂无作品打开记录</p>}</div>
        </section>
        <section className="insight-card">
          <header><div><small>TOP THEMES</small><h2>最受关注的主题</h2></div></header>
          <div className="rank-list">{themes.length ? themes.map((item, index) => <div key={item.key}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.label || item.key}</strong><small>{item.key}</small></span><em>{item.total} 次</em></div>) : <p className="empty-copy">暂无主题偏好记录</p>}</div>
        </section>
      </div>

      <section className="insight-card">
        <header><div><small>CHANNEL QUALITY</small><h2>客户从哪里来</h2></div></header>
        <div className="source-grid">{sources.length ? sources.map((item) => <div key={item.key}><strong>{sourceLabel(item.key)}</strong><span>{item.total} 次浏览</span><em>{number(item.conversions)} 次复制需求</em></div>) : <p className="empty-copy">暂无来源数据</p>}</div>
      </section>

      <section className="insight-card sessions-card">
        <header><div><small>RECENT SESSIONS</small><h2>最近浏览明细</h2></div><span>不是客户身份，仅是一次匿名浏览</span></header>
        <div className="session-table">
          {sessions.length ? sessions.map((session) => (
            <article key={session.session_id}>
              <div className="session-main"><span className={`intent-badge ${scoreClass(session.intent_score)}`}>{intentLabel(session.intent_score)}</span><strong>访客 {session.session_id.slice(-6).toUpperCase()}</strong><small>{localTime(session.started_at)} · {deviceLabel(session.device)} · {sourceLabel(session.source)}</small></div>
              <div><small>有效 / 总停留</small><strong>{duration(session.active_seconds)} / {duration(session.elapsed_seconds)}</strong></div>
              <div><small>浏览深度</small><strong>{session.photo_views} 张 · {session.max_scroll}%</strong></div>
              <div><small>成交信号</small><strong>{session.favorite_count} 收藏 · {session.brief_copies} 复制</strong></div>
              <div className="session-score"><small>意向分</small><strong>{session.intent_score}</strong></div>
            </article>
          )) : <p className="empty-copy">上线后，有客户同意匿名统计并浏览，这里就会出现明细。</p>}
        </div>
      </section>

      <footer className="insights-footer">
        <p>数据用于优化客片顺序、分享渠道和咨询流程；不收集姓名、手机号、精确位置、IP 或设备指纹。</p>
        <div><span>LCP ≤ 2.5s：{summary.lcp_good === null ? "采集中" : `${summary.lcp_good}%`}</span><span>交互 ≤ 200ms：{summary.interaction_good === null ? "采集中" : `${summary.interaction_good}%`}</span><span>布局稳定：{summary.cls_good === null ? "采集中" : `${summary.cls_good}%`}</span></div>
      </footer>
    </main>
  );
}

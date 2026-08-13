import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const portfolioSessions = sqliteTable("portfolio_sessions", {
  sessionId: text("session_id").primaryKey(),
  startedAt: text("started_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  activeSeconds: integer("active_seconds").notNull().default(0),
  maxScroll: integer("max_scroll").notNull().default(0),
  device: text("device").notNull().default("unknown"),
  source: text("source").notNull().default("direct"),
  medium: text("medium").notNull().default("none"),
  campaign: text("campaign").notNull().default(""),
  referrerDomain: text("referrer_domain").notNull().default(""),
  landingPath: text("landing_path").notNull().default("/p/"),
  photoViews: integer("photo_views").notNull().default(0),
  favoriteActions: integer("favorite_actions").notNull().default(0),
  favoriteCount: integer("favorite_count").notNull().default(0),
  briefOpens: integer("brief_opens").notNull().default(0),
  briefCopies: integer("brief_copies").notNull().default(0),
  filterChanges: integer("filter_changes").notNull().default(0),
  lcpMs: integer("lcp_ms"),
  interactionMs: integer("interaction_ms"),
  clsMilli: integer("cls_milli"),
  intentScore: integer("intent_score").notNull().default(0),
}, (table) => [
  index("portfolio_sessions_started_idx").on(table.startedAt),
  index("portfolio_sessions_score_idx").on(table.intentScore),
  index("portfolio_sessions_source_idx").on(table.source),
]);

export const portfolioInteractions = sqliteTable("portfolio_interactions", {
  eventId: text("event_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  eventType: text("event_type").notNull(),
  targetId: text("target_id").notNull().default(""),
  targetLabel: text("target_label").notNull().default(""),
  theme: text("theme").notNull().default(""),
  scene: text("scene").notNull().default(""),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("portfolio_interactions_session_idx").on(table.sessionId),
  index("portfolio_interactions_time_idx").on(table.occurredAt),
  index("portfolio_interactions_type_target_idx").on(table.eventType, table.targetId),
]);

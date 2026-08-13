CREATE TABLE `portfolio_interactions` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_type` text NOT NULL,
	`target_id` text DEFAULT '' NOT NULL,
	`target_label` text DEFAULT '' NOT NULL,
	`theme` text DEFAULT '' NOT NULL,
	`scene` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portfolio_interactions_session_idx` ON `portfolio_interactions` (`session_id`);--> statement-breakpoint
CREATE INDEX `portfolio_interactions_time_idx` ON `portfolio_interactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `portfolio_interactions_type_target_idx` ON `portfolio_interactions` (`event_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `portfolio_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`active_seconds` integer DEFAULT 0 NOT NULL,
	`max_scroll` integer DEFAULT 0 NOT NULL,
	`device` text DEFAULT 'unknown' NOT NULL,
	`source` text DEFAULT 'direct' NOT NULL,
	`medium` text DEFAULT 'none' NOT NULL,
	`campaign` text DEFAULT '' NOT NULL,
	`referrer_domain` text DEFAULT '' NOT NULL,
	`landing_path` text DEFAULT '/p/' NOT NULL,
	`photo_views` integer DEFAULT 0 NOT NULL,
	`favorite_actions` integer DEFAULT 0 NOT NULL,
	`favorite_count` integer DEFAULT 0 NOT NULL,
	`brief_opens` integer DEFAULT 0 NOT NULL,
	`brief_copies` integer DEFAULT 0 NOT NULL,
	`filter_changes` integer DEFAULT 0 NOT NULL,
	`lcp_ms` integer,
	`interaction_ms` integer,
	`cls_milli` integer,
	`intent_score` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portfolio_sessions_started_idx` ON `portfolio_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `portfolio_sessions_score_idx` ON `portfolio_sessions` (`intent_score`);--> statement-breakpoint
CREATE INDEX `portfolio_sessions_source_idx` ON `portfolio_sessions` (`source`);
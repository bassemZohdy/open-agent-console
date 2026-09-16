CREATE TABLE IF NOT EXISTS `models` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `provider` text NOT NULL,
  `model_id` text NOT NULL,
  `base_url` text,
  `api_key_env` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `temperature` real,
  `max_tokens` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agents` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `model_ref` text NOT NULL,
  `instructions` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `temperature` real,
  `max_tokens` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`model_ref`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `title` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_session_created` ON `messages` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `runs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `status` text NOT NULL,
  `started_at` text NOT NULL,
  `completed_at` text,
  `error` text,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_agent_started` ON `runs` (`agent_id`,`started_at`);

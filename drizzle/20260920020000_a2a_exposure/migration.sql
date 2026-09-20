CREATE TABLE IF NOT EXISTS `a2a_exposures` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `slug` text NOT NULL,
  `published` integer DEFAULT false NOT NULL,
  `visibility` text DEFAULT 'private' NOT NULL,
  `auth_mode` text DEFAULT 'bearer' NOT NULL,
  `auth_env` text,
  `streaming` integer DEFAULT true NOT NULL,
  `max_task_seconds` integer DEFAULT 300 NOT NULL,
  `max_requests_per_minute` integer DEFAULT 60 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `a2a_exposures_agent_id_unique` ON `a2a_exposures` (`agent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `a2a_exposures_slug_unique` ON `a2a_exposures` (`slug`);

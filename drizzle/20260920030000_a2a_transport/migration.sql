ALTER TABLE `a2a_exposures` ADD `enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `a2a_exposures` ADD `max_concurrent_tasks` integer DEFAULT 4 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `a2a_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `exposure_id` text NOT NULL,
  `context_id` text NOT NULL,
  `parent_task_id` text,
  `client_message_id` text NOT NULL,
  `session_id` text,
  `run_id` text,
  `state` text DEFAULT 'TASK_STATE_SUBMITTED' NOT NULL,
  `input_json` text NOT NULL,
  `output_text` text,
  `error_code` text,
  `error_message` text,
  `caller_hash` text NOT NULL,
  `correlation_id` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`exposure_id`) REFERENCES `a2a_exposures`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `a2a_tasks_exposure_message_unique` ON `a2a_tasks` (`exposure_id`, `client_message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `a2a_tasks_exposure_state_index` ON `a2a_tasks` (`exposure_id`, `state`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `a2a_tasks_context_index` ON `a2a_tasks` (`exposure_id`, `context_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `a2a_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `exposure_id` text,
  `task_id` text,
  `actor_type` text NOT NULL,
  `action` text NOT NULL,
  `caller_hash` text,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`exposure_id`) REFERENCES `a2a_exposures`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`task_id`) REFERENCES `a2a_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `a2a_audit_exposure_created_index` ON `a2a_audit_events` (`exposure_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `a2a_audit_task_created_index` ON `a2a_audit_events` (`task_id`, `created_at`);

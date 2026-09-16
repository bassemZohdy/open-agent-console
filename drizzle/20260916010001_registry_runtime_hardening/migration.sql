ALTER TABLE `models` ADD `capabilities_json` text DEFAULT '["streaming"]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `models` ADD `timeout_ms` integer DEFAULT 60000 NOT NULL;
--> statement-breakpoint
ALTER TABLE `models` ADD `max_retries` integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD `max_model_calls` integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD `max_tool_calls` integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `input_tokens` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD `output_tokens` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD `total_tokens` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD `correlation_id` text;

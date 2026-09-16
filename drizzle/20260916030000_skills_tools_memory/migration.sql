CREATE TABLE `memory_connectors` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `config_json` text DEFAULT '{}' NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `instructions` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `url` text NOT NULL,
  `headers_json` text DEFAULT '{}' NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tools` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `kind` text NOT NULL,
  `config_json` text DEFAULT '{}' NOT NULL,
  `input_schema_json` text DEFAULT '{"type":"object","additionalProperties":false}' NOT NULL,
  `mcp_server_id` text,
  `external_name` text,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `memory_connector_id` text REFERENCES `memory_connectors`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE TABLE `agent_skills` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `skill_id` text NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_skills_unique` ON `agent_skills` (`agent_id`,`skill_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_skills_position` ON `agent_skills` (`agent_id`,`position`);
--> statement-breakpoint
CREATE TABLE `agent_tools` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `tool_id` text NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_tools_unique` ON `agent_tools` (`agent_id`,`tool_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_tools_position` ON `agent_tools` (`agent_id`,`position`);
--> statement-breakpoint
CREATE TABLE `tool_calls` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `tool_id` text,
  `tool_name` text NOT NULL,
  `status` text NOT NULL,
  `input_json` text DEFAULT '{}' NOT NULL,
  `output` text,
  `error` text,
  `started_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tool_calls_run` ON `tool_calls` (`run_id`,`started_at`);
--> statement-breakpoint
CREATE TABLE `memories` (
  `id` text PRIMARY KEY NOT NULL,
  `connector_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `key` text,
  `content` text NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`connector_id`) REFERENCES `memory_connectors`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memories_agent_connector` ON `memories` (`agent_id`,`connector_id`,`updated_at`);
--> statement-breakpoint
INSERT INTO `memory_connectors` (`id`,`name`,`type`,`config_json`,`enabled`,`created_at`,`updated_at`)
VALUES
('00000000-0000-4000-8000-000000000101','No long-term memory','none','{}',1,datetime('now'),datetime('now')),
('00000000-0000-4000-8000-000000000102','SQLite long-term memory','sqlite','{}',1,datetime('now'),datetime('now'));
--> statement-breakpoint
INSERT INTO `tools` (`id`,`name`,`description`,`kind`,`config_json`,`input_schema_json`,`enabled`,`created_at`,`updated_at`)
VALUES
('00000000-0000-4000-8000-000000000001','calculator','Safely evaluate basic arithmetic expressions using +, -, *, / and parentheses.','builtin-calculator','{}','{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"],"additionalProperties":false}',1,datetime('now'),datetime('now')),
('00000000-0000-4000-8000-000000000002','current_datetime','Get the current date and time, optionally in an IANA timezone.','builtin-datetime','{}','{"type":"object","properties":{"timeZone":{"type":"string"}},"additionalProperties":false}',1,datetime('now'),datetime('now'));

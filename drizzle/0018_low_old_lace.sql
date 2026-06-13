CREATE TABLE `advisor_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slot` text,
	`status` text NOT NULL,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`web_searches` integer,
	`cost_usd` real,
	`error_message` text,
	`summary` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `advisor_runs_kind_idx` ON `advisor_runs` (`kind`);--> statement-breakpoint
CREATE INDEX `advisor_runs_started_at_idx` ON `advisor_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `advisor_runs_slot_idx` ON `advisor_runs` (`kind`,`slot`);
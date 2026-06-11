CREATE TABLE `tax_declared_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`category` text NOT NULL,
	`amount_eur` real NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_declared_baselines_year_category_idx` ON `tax_declared_baselines` (`year`,`category`);
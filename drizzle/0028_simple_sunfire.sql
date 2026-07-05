CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`purchase_date` text NOT NULL,
	`purchase_price_eur` real NOT NULL,
	`purchase_costs_eur` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mortgages` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`lender` text,
	`principal_eur` real NOT NULL,
	`rate_type` text NOT NULL,
	`nominal_rate_pct` real NOT NULL,
	`term_months` integer NOT NULL,
	`first_payment_date` text NOT NULL,
	`spread_pct` real,
	`reference_index` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mortgages_property_idx` ON `mortgages` (`property_id`);--> statement-breakpoint
CREATE TABLE `mortgage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`mortgage_id` text NOT NULL,
	`event_date` text NOT NULL,
	`type` text NOT NULL,
	`amount_eur` real,
	`mode` text,
	`new_rate_pct` real,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`mortgage_id`) REFERENCES `mortgages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mortgage_events_mortgage_idx` ON `mortgage_events` (`mortgage_id`,`event_date`);--> statement-breakpoint
CREATE TABLE `property_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`valuation_date` text NOT NULL,
	`value_eur` real NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_valuations_property_date_idx` ON `property_valuations` (`property_id`,`valuation_date`);
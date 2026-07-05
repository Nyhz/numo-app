ALTER TABLE `daily_balances` ADD `invested_eur` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `daily_balances_date_idx` ON `daily_balances` (`balance_date`);
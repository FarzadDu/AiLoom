ALTER TABLE `generation_job` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `generation_job` ADD `lease_expires_at` integer;
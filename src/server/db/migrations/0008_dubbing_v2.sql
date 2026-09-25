CREATE TABLE `dubbing_job` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_language` text,
	`target_language` text NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`provider_project_id` text,
	`provider_language_id` text,
	`output_asset_id` text,
	`error_code` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`next_poll_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`output_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dubbing_job_owner_created_idx` ON `dubbing_job` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `dubbing_job_state_poll_idx` ON `dubbing_job` (`state`,`next_poll_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `dubbing_job_provider_project_idx` ON `dubbing_job` (`provider_project_id`);
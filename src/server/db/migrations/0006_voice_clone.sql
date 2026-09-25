CREATE TABLE `voice_clone` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`provider_name` text NOT NULL,
	`sample_hash` text NOT NULL,
	`sample_mime_type` text NOT NULL,
	`sample_size_bytes` integer NOT NULL,
	`consent_at` integer NOT NULL,
	`state` text NOT NULL,
	`provider_voice_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `voice_clone_owner_created_idx` ON `voice_clone` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `voice_clone_provider_voice_idx` ON `voice_clone` (`provider_voice_id`);--> statement-breakpoint
CREATE TABLE `voice_speech` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`clone_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`output_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clone_id`) REFERENCES `voice_clone`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`output_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `voice_speech_owner_created_idx` ON `voice_speech` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `voice_speech_clone_idx` ON `voice_speech` (`clone_id`,`created_at`);
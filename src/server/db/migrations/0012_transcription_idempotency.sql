CREATE TABLE `transcription_request` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcription_request_owner_created_idx` ON `transcription_request` (`owner_id`,`created_at`,`id`);
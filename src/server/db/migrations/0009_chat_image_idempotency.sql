CREATE TABLE `chat_image_request` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`response_json` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_image_request_owner_created_idx` ON `chat_image_request` (`owner_id`,`created_at`,`id`);
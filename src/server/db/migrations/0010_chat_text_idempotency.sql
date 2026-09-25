CREATE TABLE `chat_text_request` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`conversation_id` text,
	`user_message_id` text,
	`assistant_message_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_text_request_owner_created_idx` ON `chat_text_request` (`owner_id`,`created_at`,`id`);
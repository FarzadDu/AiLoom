CREATE TABLE `lora_dataset` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`image_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lora_dataset_owner_created_idx` ON `lora_dataset` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lora_dataset_storage_idx` ON `lora_dataset` (`storage_key`);--> statement-breakpoint
CREATE TABLE `lora_inference` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`model_id` text NOT NULL,
	`prompt` text NOT NULL,
	`scale_milli` integer NOT NULL,
	`size` text NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`provider_task_id` text,
	`output_asset_id` text,
	`error_code` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `lora_model`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`output_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `lora_inference_owner_created_idx` ON `lora_inference` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `lora_inference_state_created_idx` ON `lora_inference` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lora_inference_provider_task_idx` ON `lora_inference` (`provider_task_id`);--> statement-breakpoint
CREATE TABLE `lora_model` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger_word` text,
	`steps` integer NOT NULL,
	`rank` integer NOT NULL,
	`input_hash` text NOT NULL,
	`state` text NOT NULL,
	`provider_task_id` text,
	`weight_storage_key` text,
	`weight_size_bytes` integer,
	`error_code` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dataset_id`) REFERENCES `lora_dataset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lora_model_owner_created_idx` ON `lora_model` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `lora_model_state_created_idx` ON `lora_model` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lora_model_provider_task_idx` ON `lora_model` (`provider_task_id`);
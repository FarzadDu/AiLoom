CREATE TABLE `storyboard` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storyboard_id_owner_idx` ON `storyboard` (`id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `storyboard_owner_updated_idx` ON `storyboard` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `storyboard_project_idx` ON `storyboard` (`project_id`);--> statement-breakpoint
CREATE TABLE `storyboard_shot` (
	`id` text PRIMARY KEY NOT NULL,
	`storyboard_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`model_id` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`aspect_ratio` text NOT NULL,
	`first_frame_asset_id` text,
	`last_frame_asset_id` text,
	`reference_asset_ids_json` text DEFAULT '[]' NOT NULL,
	`output_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_frame_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_frame_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`output_asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`storyboard_id`,`owner_id`) REFERENCES `storyboard`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storyboard_shot_position_idx` ON `storyboard_shot` (`storyboard_id`,`position`);--> statement-breakpoint
CREATE INDEX `storyboard_shot_owner_board_idx` ON `storyboard_shot` (`owner_id`,`storyboard_id`);
CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`projectId` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`mimeType` text NOT NULL,
	`originalName` text,
	`sizeBytes` integer NOT NULL,
	`storageKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_owner_created_idx` ON `asset` (`ownerId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `asset_project_idx` ON `asset` (`projectId`);--> statement-breakpoint
CREATE INDEX `asset_visibility_idx` ON `asset` (`visibility`);--> statement-breakpoint
CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`projectId` text,
	`title` text NOT NULL,
	`modelId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`archivedAt` integer,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_owner_updated_idx` ON `conversation` (`ownerId`,`updatedAt`,`id`);--> statement-breakpoint
CREATE INDEX `conversation_project_idx` ON `conversation` (`projectId`);--> statement-breakpoint
CREATE TABLE `explore_template` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`definitionJson` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `explore_template_owner_updated_idx` ON `explore_template` (`ownerId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `explore_template_visibility_category_idx` ON `explore_template` (`visibility`,`category`);--> statement-breakpoint
CREATE TABLE `generation_job` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`projectId` text,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`providerModel` text NOT NULL,
	`externalId` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`inputJson` text NOT NULL,
	`outputJson` text,
	`costEstimateMicrosUsd` integer,
	`errorCode` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generation_job_owner_created_idx` ON `generation_job` (`ownerId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `generation_job_state_created_idx` ON `generation_job` (`state`,`createdAt`);--> statement-breakpoint
CREATE INDEX `generation_job_provider_external_idx` ON `generation_job` (`provider`,`externalId`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`role` text NOT NULL,
	`modelId` text,
	`blocksJson` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`conversationId`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_conversation_created_idx` ON `message` (`conversationId`,`createdAt`,`id`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_owner_updated_idx` ON `project` (`ownerId`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `specialist_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`description` text NOT NULL,
	`systemPrompt` text NOT NULL,
	`sourceLinksJson` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdByUserId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `specialist_profile_slug_unique` ON `specialist_profile` (`slug`);--> statement-breakpoint
CREATE INDEX `specialist_profile_enabled_domain_idx` ON `specialist_profile` (`enabled`,`domain`);--> statement-breakpoint
CREATE TABLE `user_preference` (
	`userId` text PRIMARY KEY NOT NULL,
	`savedModelId` text,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

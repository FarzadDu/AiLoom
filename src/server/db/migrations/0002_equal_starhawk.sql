ALTER TABLE `message` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `message_conversation_position_idx` ON `message` (`conversationId`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_storage_key_idx` ON `asset` (`storageKey`);
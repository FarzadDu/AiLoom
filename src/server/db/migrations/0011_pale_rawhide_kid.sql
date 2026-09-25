ALTER TABLE `asset` ADD `internal` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `asset` SET `internal` = 1, `visibility` = 'private'
WHERE `source` = 'generation' AND (
  `storageKey` GLOB 'repairs/*/context-*.mp4' OR
  `storageKey` GLOB 'repairs/*/mask-*.mp4'
);

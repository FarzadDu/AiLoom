CREATE TABLE `explore_starter_seed` (
	`ownerId` text PRIMARY KEY NOT NULL,
	`seededAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

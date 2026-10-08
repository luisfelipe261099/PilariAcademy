CREATE TABLE `users` (
	`uid` varchar(128) NOT NULL,
	`email` varchar(255) NOT NULL,
	`display_name` varchar(255),
	`photo_url` varchar(1024),
	`roles` json,
	`disabled` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) DEFAULT (now()),
	`updated_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `users_uid` PRIMARY KEY(`uid`)
);
--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);
CREATE TABLE `lesson_progress` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`lesson_id` varchar(36) NOT NULL,
	`completed` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now()),
	`updated_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `lesson_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `lesson_progress_user_lesson_unq` UNIQUE(`user_id`,`lesson_id`)
);
--> statement-breakpoint
CREATE INDEX `lesson_progress_user_idx` ON `lesson_progress` (`user_id`);
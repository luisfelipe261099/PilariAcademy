CREATE TABLE `course_announcements` (
	`id` varchar(36) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`author_id` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `course_announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `course_reviews` (
	`id` varchar(36) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`rating` int NOT NULL,
	`comment` text,
	`created_at` timestamp(3) DEFAULT (now()),
	`updated_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `course_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `course_reviews_course_user_unq` UNIQUE(`course_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `lesson_notes` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`lesson_id` varchar(36) NOT NULL,
	`at_sec` int NOT NULL DEFAULT 0,
	`body` text NOT NULL,
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `lesson_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `course_announcements_course_idx` ON `course_announcements` (`course_id`);--> statement-breakpoint
CREATE INDEX `course_reviews_course_idx` ON `course_reviews` (`course_id`);--> statement-breakpoint
CREATE INDEX `lesson_notes_user_course_idx` ON `lesson_notes` (`user_id`,`course_id`);
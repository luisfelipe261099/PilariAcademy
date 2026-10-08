CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`student_id` varchar(128) NOT NULL,
	`sender_id` varchar(128) NOT NULL,
	`body` text NOT NULL,
	`read_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `messages_convo_idx` ON `messages` (`course_id`,`student_id`);
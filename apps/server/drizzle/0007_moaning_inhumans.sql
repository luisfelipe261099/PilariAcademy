CREATE TABLE `certificates` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`code` varchar(16) NOT NULL,
	`issued_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `certificates_code_unique` UNIQUE(`code`),
	CONSTRAINT `certificates_user_course_unq` UNIQUE(`user_id`,`course_id`)
);
--> statement-breakpoint
CREATE INDEX `certificates_code_idx` ON `certificates` (`code`);
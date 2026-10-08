CREATE TABLE `quiz_attempts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`module_id` varchar(36) NOT NULL,
	`score` int NOT NULL,
	`passed` boolean NOT NULL,
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `quiz_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` varchar(36) NOT NULL,
	`module_id` varchar(36) NOT NULL,
	`prompt` text NOT NULL,
	`options` json NOT NULL,
	`correct_index` int NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) DEFAULT (now()),
	`updated_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `quiz_questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `quiz_attempts_user_module_idx` ON `quiz_attempts` (`user_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `quiz_questions_module_idx` ON `quiz_questions` (`module_id`);
CREATE TABLE `earnings` (
	`id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`instructor_id` varchar(128) NOT NULL,
	`gross_in_cents` int NOT NULL,
	`commission_percent` int NOT NULL,
	`net_in_cents` int NOT NULL,
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `earnings_id` PRIMARY KEY(`id`),
	CONSTRAINT `earnings_order_course_unq` UNIQUE(`order_id`,`course_id`)
);
--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` varchar(36) NOT NULL,
	`instructor_id` varchar(128) NOT NULL,
	`amount_in_cents` int NOT NULL,
	`note` varchar(255),
	`paid_at` timestamp(3) DEFAULT (now()),
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `courses` ADD `commission_percent` int DEFAULT 30 NOT NULL;--> statement-breakpoint
CREATE INDEX `earnings_instructor_idx` ON `earnings` (`instructor_id`);--> statement-breakpoint
CREATE INDEX `payouts_instructor_idx` ON `payouts` (`instructor_id`);
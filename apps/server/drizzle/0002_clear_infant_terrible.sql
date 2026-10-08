CREATE TABLE `enrollments` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`source` varchar(16) NOT NULL,
	`activated_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now()),
	`updated_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `enrollments_user_course_unq` UNIQUE(`user_id`,`course_id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(36) NOT NULL,
	`enrollment_id` varchar(36) NOT NULL,
	`asaas_charge_id` varchar(64) NOT NULL,
	`asaas_customer_id` varchar(64) NOT NULL,
	`amount_in_cents` int NOT NULL,
	`billing_type` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`payment_url` varchar(1024),
	`due_date` varchar(10),
	`paid_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now()),
	`updated_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_asaas_charge_id_unique` UNIQUE(`asaas_charge_id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `asaas_customer_id` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `cpf` varchar(14);--> statement-breakpoint
CREATE INDEX `enrollments_user_idx` ON `enrollments` (`user_id`);--> statement-breakpoint
CREATE INDEX `enrollments_course_idx` ON `enrollments` (`course_id`);--> statement-breakpoint
CREATE INDEX `payments_enrollment_idx` ON `payments` (`enrollment_id`);
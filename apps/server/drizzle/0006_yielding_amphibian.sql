CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`actor_uid` varchar(128),
	`actor_email` varchar(255),
	`action` varchar(64) NOT NULL,
	`summary` varchar(500) NOT NULL,
	`target_type` varchar(40),
	`target_id` varchar(64),
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);
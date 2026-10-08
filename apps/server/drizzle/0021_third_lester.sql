CREATE TABLE `certificate_templates` (
	`id` varchar(36) NOT NULL,
	`html` longtext NOT NULL,
	`updated_by` varchar(128),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `certificate_templates_id` PRIMARY KEY(`id`)
);

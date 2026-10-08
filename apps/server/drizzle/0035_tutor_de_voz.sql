CREATE TABLE `tutor_material_cache` (
	`source_hash` varchar(64) NOT NULL,
	`file_url` varchar(1024) NOT NULL,
	`text` mediumtext NOT NULL,
	`chars` int NOT NULL,
	`created_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `tutor_material_cache_source_hash` PRIMARY KEY(`source_hash`)
);
--> statement-breakpoint
CREATE TABLE `tutor_usage` (
	`user_uid` varchar(128) NOT NULL,
	`day` varchar(10) NOT NULL,
	`seconds` int NOT NULL DEFAULT 0,
	`requests` int NOT NULL DEFAULT 0,
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `tutor_usage_pk` PRIMARY KEY(`user_uid`,`day`)
);
--> statement-breakpoint
ALTER TABLE `courses` ADD `tutor_enabled` boolean DEFAULT false NOT NULL;
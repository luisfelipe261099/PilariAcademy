CREATE TABLE `categories` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(140) NOT NULL,
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(180) NOT NULL,
	`instructor_id` varchar(128) NOT NULL,
	`category_id` varchar(36),
	`kind` varchar(16) NOT NULL,
	`title` varchar(200) NOT NULL,
	`subtitle` varchar(300),
	`description` text,
	`price_in_cents` int NOT NULL DEFAULT 0,
	`cover_image_url` varchar(1024),
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`external_url` varchar(1024),
	`published_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `courses_id` PRIMARY KEY(`id`),
	CONSTRAINT `courses_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `lesson_attachments` (
	`id` varchar(36) NOT NULL,
	`lesson_id` varchar(36) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`file_url` varchar(1024) NOT NULL,
	`size_bytes` int,
	`created_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `lesson_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` varchar(36) NOT NULL,
	`module_id` varchar(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`video_url` varchar(1024),
	`duration_sec` int NOT NULL DEFAULT 0,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_free_preview` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `lessons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` varchar(36) NOT NULL,
	`course_id` varchar(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `modules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `courses_status_idx` ON `courses` (`status`);--> statement-breakpoint
CREATE INDEX `courses_category_idx` ON `courses` (`category_id`);--> statement-breakpoint
CREATE INDEX `courses_instructor_idx` ON `courses` (`instructor_id`);--> statement-breakpoint
CREATE INDEX `lesson_attachments_lesson_idx` ON `lesson_attachments` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `lessons_module_idx` ON `lessons` (`module_id`);--> statement-breakpoint
CREATE INDEX `modules_course_idx` ON `modules` (`course_id`);
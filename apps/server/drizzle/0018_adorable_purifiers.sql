ALTER TABLE `certificates` ADD `student_name` varchar(255);--> statement-breakpoint
ALTER TABLE `certificates` ADD `course_title` varchar(255);--> statement-breakpoint
ALTER TABLE `certificates` ADD `hours` int;--> statement-breakpoint
ALTER TABLE `certificates` ADD `status` enum('issued','revoked') DEFAULT 'issued' NOT NULL;--> statement-breakpoint
ALTER TABLE `certificates` ADD `pdf_path` varchar(512);
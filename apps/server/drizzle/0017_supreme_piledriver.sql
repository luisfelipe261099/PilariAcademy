ALTER TABLE `enrollments` ADD `quiz_attempt_rounds` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `points` decimal(4,2) DEFAULT '2.00' NOT NULL;
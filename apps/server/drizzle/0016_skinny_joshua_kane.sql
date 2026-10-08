ALTER TABLE `courses` MODIFY COLUMN `commission_percent` int NOT NULL DEFAULT 50;--> statement-breakpoint
ALTER TABLE `orders` ADD `asaas_fee_in_cents` int;--> statement-breakpoint
ALTER TABLE `earnings` ADD `asaas_fee_in_cents` int DEFAULT 0 NOT NULL;
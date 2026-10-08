CREATE TABLE `coupons` (
	`id` varchar(36) NOT NULL,
	`code` varchar(40) NOT NULL,
	`type` varchar(16) NOT NULL,
	`value` int NOT NULL,
	`valid_until` timestamp(3),
	`max_uses` int,
	`used_count` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `coupons_id` PRIMARY KEY(`id`),
	CONSTRAINT `coupons_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`subtotal_in_cents` int NOT NULL,
	`discount_in_cents` int NOT NULL DEFAULT 0,
	`total_in_cents` int NOT NULL,
	`coupon_code` varchar(40),
	`asaas_charge_id` varchar(64),
	`asaas_customer_id` varchar(64),
	`billing_type` varchar(16),
	`payment_url` varchar(1024),
	`due_date` varchar(10),
	`paid_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_asaas_charge_id_unique` UNIQUE(`asaas_charge_id`)
);
--> statement-breakpoint
ALTER TABLE `enrollments` ADD `order_id` varchar(36);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`);
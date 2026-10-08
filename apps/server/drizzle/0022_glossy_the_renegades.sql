CREATE TABLE `coupon_redemptions` (
	`id` varchar(36) NOT NULL,
	`coupon_code` varchar(40) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`order_id` varchar(36),
	`created_at` timestamp(3) DEFAULT (now()),
	CONSTRAINT `coupon_redemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `coupon_redemptions_coupon_user_unq` UNIQUE(`coupon_code`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `coupon_redemptions_user_idx` ON `coupon_redemptions` (`user_id`);
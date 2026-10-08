CREATE TABLE `order_installments` (
	`id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`asaas_charge_id` varchar(64) NOT NULL,
	`installment_number` int,
	`value_in_cents` int NOT NULL,
	`asaas_fee_in_cents` int,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`due_date` varchar(10),
	`paid_at` timestamp(3),
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `order_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_installments_asaas_charge_id_unique` UNIQUE(`asaas_charge_id`)
);
--> statement-breakpoint
CREATE INDEX `order_installments_order_idx` ON `order_installments` (`order_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_mode` varchar(24);--> statement-breakpoint
ALTER TABLE `orders` ADD `asaas_installment_id` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD `settled_at` timestamp(3);--> statement-breakpoint
-- NOT NULL DEFAULT '' de propósito, não nullable: um índice UNIQUE do MySQL admite
-- múltiplas linhas com NULL, então uma coluna nullable pararia de proteger as linhas
-- existentes (à vista/cartão) assim que a UNIQUE de baixo entrasse em vigor.
ALTER TABLE `earnings` ADD `asaas_charge_id` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `earnings` ADD CONSTRAINT `earnings_order_course_charge_unq` UNIQUE(`order_id`,`course_id`,`asaas_charge_id`);

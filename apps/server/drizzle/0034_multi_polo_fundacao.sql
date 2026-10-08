CREATE TABLE `tenant_domains` (
	`host` varchar(253) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `tenant_domains_host` PRIMARY KEY(`host`)
);
--> statement-breakpoint
CREATE TABLE `tenant_members` (
	`tenant_id` varchar(36) NOT NULL,
	`user_uid` varchar(128) NOT NULL,
	`roles` json NOT NULL,
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `tenant_members_pk` PRIMARY KEY(`tenant_id`,`user_uid`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(40) NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`is_matriz` boolean NOT NULL DEFAULT false,
	`branding` json NOT NULL,
	`created_at` timestamp(3) DEFAULT (now(3)),
	`updated_at` timestamp(3) DEFAULT (now(3)),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `categories` DROP INDEX `categories_slug_unique`;--> statement-breakpoint
ALTER TABLE `courses` DROP INDEX `courses_slug_unique`;--> statement-breakpoint
ALTER TABLE `coupon_redemptions` DROP INDEX `coupon_redemptions_coupon_user_unq`;--> statement-breakpoint
ALTER TABLE `coupons` DROP INDEX `coupons_code_unique`;--> statement-breakpoint
ALTER TABLE `users` ADD `is_platform_admin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `courses` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `courses` ADD `submitted_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `courses` ADD `approved_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `courses` ADD `approved_by` varchar(128);--> statement-breakpoint
ALTER TABLE `courses` ADD `review_note` varchar(1000);--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `coupons` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `orders` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `earnings` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `payouts` ADD `tenant_id` varchar(36) NOT NULL DEFAULT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d';--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `tenant_id` varchar(36);--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_tenant_slug_unq` UNIQUE(`tenant_id`,`slug`);--> statement-breakpoint
ALTER TABLE `courses` ADD CONSTRAINT `courses_tenant_slug_unq` UNIQUE(`tenant_id`,`slug`);--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_tenant_coupon_user_unq` UNIQUE(`tenant_id`,`coupon_code`,`user_id`);--> statement-breakpoint
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_tenant_code_unq` UNIQUE(`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `tenant_domains_tenant_idx` ON `tenant_domains` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `tenant_members_user_idx` ON `tenant_members` (`user_uid`);--> statement-breakpoint
CREATE INDEX `orders_tenant_idx` ON `orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `earnings_tenant_idx` ON `earnings` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `payouts_tenant_idx` ON `payouts` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_idx` ON `audit_logs` (`tenant_id`);--> statement-breakpoint
-- ── Dados: o polo matriz e o vínculo de tudo que já existe com ele ──────────────────
-- Matriz = a loja atual. A marca repete os valores que o client tinha fixos no código.
INSERT INTO `tenants` (`id`, `slug`, `name`, `status`, `is_matriz`, `branding`, `created_at`, `updated_at`) VALUES ('accbdc75-009f-4aa2-9fd3-e92d11f3b06d', 'pilari', 'Studio Pilari', 'active', true, JSON_OBJECT('logoUrl', NULL, 'logoLightUrl', NULL, 'faviconUrl', NULL, 'primaryColor', '#5c6e5a', 'accentColor', '#c67c89', 'whatsapp', '5541997102441', 'phone', '(41) 99710-2441', 'email', 'studiopilari@gmail.com', 'address', 'Rod. da Uva, 1299, Jardim Osasco, Colombo/PR, CEP 83402-000', 'description', 'Cursos online de Pilates e fisioterapia com a Dra. Mylena Sestream. Aprenda no seu ritmo, com certificado de conclusão.', 'heroTitle', NULL, 'heroSubtitle', NULL), NOW(3), NOW(3));--> statement-breakpoint
INSERT INTO `tenant_domains` (`host`, `tenant_id`, `is_primary`, `created_at`) VALUES ('cursos.studiopilari.com.br', 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d', true, NOW(3));--> statement-breakpoint
-- Logs antigos foram ações na loja da matriz.
UPDATE `audit_logs` SET `tenant_id` = 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d' WHERE `tenant_id` IS NULL;--> statement-breakpoint
-- Curso já publicado conta como aprovado: os dados do certificado travam a partir de agora.
UPDATE `courses` SET `approved_at` = COALESCE(`published_at`, `updated_at`, NOW(3)) WHERE `status` = 'published';--> statement-breakpoint
-- Todo usuário vira membro da matriz com os papéis que já tinha. Os admins atuais viram admins da matriz por aqui, e o
-- admin da matriz é admin da plataforma pela regra do código (sinal OU admin da matriz): `is_platform_admin` fica 0 para
-- todos, e a tela de usuários da matriz continua sendo onde esse poder é dado e tirado.
INSERT INTO `tenant_members` (`tenant_id`, `user_uid`, `roles`, `created_at`, `updated_at`) SELECT 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d', `uid`, COALESCE(`roles`, JSON_ARRAY('student')), NOW(3), NOW(3) FROM `users`;
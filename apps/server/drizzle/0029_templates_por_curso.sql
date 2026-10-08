ALTER TABLE `courses` ADD `certificate_template_id` varchar(36);--> statement-breakpoint
-- A tabela já tem a linha do template singleton. Adicionar NOT NULL sem DEFAULT falha no
-- modo estrito; adiciona com default para preencher a linha existente e em seguida remove
-- o default, para a coluna ficar idêntica ao que o schema TS declara.
ALTER TABLE `certificate_templates` ADD `name` varchar(120) NOT NULL DEFAULT 'Padrao';--> statement-breakpoint
ALTER TABLE `certificate_templates` ALTER COLUMN `name` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `certificate_templates` ADD `is_default` boolean DEFAULT false NOT NULL;

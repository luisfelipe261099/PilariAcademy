-- Promove o template singleton existente a PADRAO. Sem isto, todo curso cairia no HTML
-- de fabrica e o layout salvo pelo admin (2a assinatura, ajuste do "com carga") sumiria
-- silenciosamente da emissao.
-- Nomeia tambem: a coluna nasceu com o default 'Padrao' e o nome de verdade e este.
UPDATE `certificate_templates` t
   JOIN (SELECT `id` FROM `certificate_templates` ORDER BY `updated_at` DESC LIMIT 1) alvo
     ON alvo.`id` = t.`id`
    SET t.`is_default` = 1, t.`name` = 'Padrão';

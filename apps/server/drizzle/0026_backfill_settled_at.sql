-- Pedidos já pagos antes desta funcionalidade estão quitados por definição:
-- à vista e cartão não têm parcelas em aberto do nosso lado.
-- SEM ISTO, todo aluno que já pagou perde o certificado no deploy.
--
-- COALESCE(paid_at, updated_at): um pedido pago sem paid_at (ex.: baixa manual do
-- admin, que pode marcar `status = 'paid'` sem passar pelo webhook do Asaas) também
-- precisa sair quitado — settled_at só é lido como nulo/não-nulo, então updated_at
-- é uma aproximação honesta e nunca fica pior que deixar o pedido sem certificado.
UPDATE `orders` SET `settled_at` = COALESCE(`paid_at`, `updated_at`) WHERE `status` = 'paid';

# Contingência

- Supabase indisponível: servir páginas públicas cacheadas; bloquear ações mutáveis.
- Pagamento indisponível: preservar carrinho e não criar pedido incompleto.
- Frete indisponível: não inventar cotação; permitir tentar novamente.
- E-mail/ERP/WhatsApp indisponível: enfileirar com idempotência e mostrar estado real.
- Realtime indisponível: suporte usa polling e envio normal por API.

Toda indisponibilidade relevante gera evento técnico e alerta no painel quando a integração estiver configurada.

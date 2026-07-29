# Segurança

Controles principais: RLS default-deny, CSP, validação Zod, allowlist de origem, URLs internas seguras, upload privado, idempotência, estoque bloqueado por linha, webhook assinado e consulta posterior ao provider.

Logs removem senhas, tokens, cookies, CPF e dados financeiros. Ações críticas recebem `request_id`. Nunca confie em preço, desconto, status ou permissão enviados pelo navegador.

Checklist pré-produção: executar testes RLS, secret scan, auditoria de dependências, validar buckets, habilitar MFA, configurar Turnstile/WAF, testar restauração e revisar retenção LGPD.

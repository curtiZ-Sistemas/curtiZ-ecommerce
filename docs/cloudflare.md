# Cloudflare

Use TLS Full Strict, WAF gerenciado, proteção DDoS e rate limiting. Turnstile é opcional por
`TURNSTILE_ENABLED`; quando desativado, as chaves não são exigidas nem o widget inicializado. Quando
ativado, valide o token no servidor.

Cacheie apenas conteúdo público. Respostas autenticadas, cookies de sessão, checkout e painel usam
`private, no-store`. Webhooks habilitados devem validar assinatura e idempotência na origem.

O monorepo possui configurações OpenNext e Wrangler independentes em `apps/store` e `apps/panel`.
Comandos e variáveis de ambiente estão em `docs/deployment.md`. Nunca publique ambos os aplicativos
no mesmo Worker ou na mesma rota.

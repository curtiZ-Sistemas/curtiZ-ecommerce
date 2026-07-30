# Cloudflare

Usar TLS Full Strict, WAF gerenciado/OWASP, DDoS, rate limiting e Turnstile. Aplicar limites por conta e IP para login, recuperação, cadastro, cupom e checkout. Webhooks do Mercado Pago não devem ser bloqueados indiscriminadamente; valide assinatura na origem.

Cacheie somente páginas públicas. Respostas autenticadas, cookies de sessão e checkout usam `private, no-store`.

Em Workers Builds, use um Worker por aplicação e mantenha a raiz do monorepo como diretório de
build. Os comandos de staging e a lista de variáveis obrigatórias estão em `docs/deployment.md`.
Não use `pnpm build` para demo: esse comando é deliberadamente reservado à validação de produção.

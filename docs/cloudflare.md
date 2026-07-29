# Cloudflare

Usar TLS Full Strict, WAF gerenciado/OWASP, DDoS, rate limiting e Turnstile. Aplicar limites por conta e IP para login, recuperação, cadastro, cupom e checkout. Webhooks do Mercado Pago não devem ser bloqueados indiscriminadamente; valide assinatura na origem.

Cacheie somente páginas públicas. Respostas autenticadas, cookies de sessão e checkout usam `private, no-store`.

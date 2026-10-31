---
name: endurecimento-web
description: Checklist de segurança em camadas para sites e sistemas (Next.js, Supabase, formulários, uploads, login, pagamentos, cabeçalhos, segredos, dependências), com os comandos de verificação. Use em qualquer tarefa da área de segurança, ao criar formulário/API/login e antes de publicar.
---
# Endurecimento web (segurança em camadas)

Nenhum sistema é impenetrável. O objetivo é **não deixar portas óbvias** e **limitar o estrago** se algo falhar. Cada item vale só com evidência (arquivo, teste ou comando).

## 1. Segredos
- Chaves só em variáveis de ambiente do provedor (Cloudflare Workers/Supabase); `.env` no `.gitignore`; `.env.exemplo` sem valores.
- No front, só chaves públicas (`NEXT_PUBLIC_*`, `anon key` do Supabase). **service_role nunca** no navegador.
- Vazou? Troque a chave na hora (apagar o arquivo não basta: está no histórico do Git).

## 2. Dados e acesso (Supabase)
- **RLS ligado em todas as tabelas** com políticas por usuário/papel; testar acesso indevido (usuário A não lê dados do B). Skill `supabase-postgres-best-practices` (categoria Security & RLS).
- No servidor, use `getUser()`/`getClaims()` para autorização, não só a sessão do cookie. Skill `supabase`.
- Funções `security definer` só quando necessário e com `search_path` fixo.

## 3. Entradas (formulários, APIs, uploads)
- Validar **no servidor** (ex.: Zod), não só no navegador. Limites de tamanho.
- Anti-robô: Cloudflare Turnstile (validação do token no servidor via Siteverify) ou honeypot + tempo mínimo.
- Limite de requisições por IP/usuário nas rotas sensíveis (login, formulário, recuperação de senha).
- Uploads: tipo e tamanho checados no servidor, nome gerado pelo sistema, bucket privado com URL assinada.
- Nada de `eval`, `dangerouslySetInnerHTML` sem sanitizar, SQL montado com texto do usuário.

## 4. Login e sessão
- Supabase Auth; senha mínima 8+, confirmação de e-mail, recuperação com link de uso único. Cookies `Secure`, `HttpOnly`, `SameSite=Lax`.
- Mensagens de erro de login genéricas (não revelar se o e-mail existe).

## 5. Pagamentos
- Provedor oficial (Mercado Pago, Stripe, Pix do banco). **Nunca** guardar dados de cartão.
- Webhook com verificação de assinatura; preço sempre calculado no servidor.

## 6. Cabeçalhos HTTP
CSP (sem `unsafe-inline` em scripts quando possível; nonce no Next.js), `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (ou `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` mínimo. Na curti Z: `headers()` no `next.config.ts` e o middleware da loja (CSP com nonce). Esconder `X-Powered-By` (`poweredByHeader: false`).

## 7. Dependências
`npm audit --omit=dev` sem crítica/alta; lockfile versionado; dependências novas só de pacotes conhecidos (skill `supply-chain-risk-auditor` para auditoria completa).

## 8. LGPD
Política de privacidade, consentimento para cookies de medição, coletar só o necessário, prazo de guarda, canal para o titular pedir exclusão.

## Verificação (rode e anexe o resultado)
Na curti Z: testes do workspace afetado (`pnpm --filter <app> exec vitest run <arquivos>`), `tests/db-static` para migrations/RLS, `npm audit --omit=dev` e `scripts/check-browser-exposure.ts` no build do Worker (já incluso em `build:worker`). Depois: `/security-review` nas mudanças (revisão por IA; pode errar — não substitui os itens acima). Revisão de mudanças sensíveis: skill `differential-review`. APIs perigosas: skill `sharp-edges`.

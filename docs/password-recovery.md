# Recuperação de senha

Fluxo: `/login` → `/esqueci-senha` → Supabase Auth (e-mail) → `/auth/callback?next=/redefinir-senha` → `/redefinir-senha` → `/login?senha=atualizada`.

## O que o código garante

- `POST /api/auth/password` (`request`): Turnstile (se ativo) → limite de 3/h por e-mail (HMAC, distribuído) → `resetPasswordForEmail`. O erro do Supabase é classificado em `src/lib/password-recovery.ts`:
  - sucesso, rejeição 4xx e cooldown por conta → resposta neutra (não revela se a conta existe);
  - 5xx, falha de rede e limite global de e-mail → 503 genérico.
  - Residual conhecido: durante uma falha de SMTP o 503 só ocorre para contas existentes.
- `update` só funciona com sessão cujo JWT tenha `amr` `recovery` com no máximo 15 min, identidade `email` e perfil ativo. Sessão comum ou do Google é recusada. Após o sucesso, `signOut({ scope: "global" })` encerra a sessão de recuperação e as demais.
- Conta que só usa Google não ganha senha pelo fluxo de recuperação.
- Contas com MFA são enviadas a `/mfa` e voltam a `/redefinir-senha`.

## Configuração externa (Supabase Auth, painel; não há API disponível aos MCPs)

1. **Auth → SMTP Settings**: ativar SMTP personalizado. Host `smtp.resend.com`, usuário `resend`, senha = API key do Resend só com envio, porta conforme https://resend.com/supabase. Remetente de `curtiz.com.br`; Reply-To só se a caixa existir. A chave fica apenas nesse campo.
2. **Auth → URL Configuration**: Site URL `https://curtiz.com.br`; Redirect URLs incluindo `https://curtiz.com.br/auth/callback**`.
3. **Auth → Email Templates → Reset Password**: ver modelo abaixo. Manter `{{ .ConfirmationURL }}`.
4. Validade do link: recomendado 1 hora ou menos. Ativar a notificação de senha alterada, se disponível.

### Modelo (assunto: `Redefina sua senha da curti Z`)

```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1c1c1c">
  <h2>Redefina sua senha</h2>
  <p>Recebemos um pedido para redefinir a senha da sua conta na curti Z.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#1c1c1c;color:#fff;text-decoration:none;border-radius:6px">Criar nova senha</a></p>
  <p>Por segurança, este link tem validade limitada e só pode ser usado uma vez.</p>
  <p>Se você não fez esse pedido, ignore esta mensagem: sua senha continua a mesma.</p>
  <p style="color:#666;font-size:13px">curti Z · curtiz.com.br</p>
</div>
```

## Turnstile (desligado)

Para ativar: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (variável de build no GitHub Actions), `TURNSTILE_SECRET_KEY` (secret do Worker), `TURNSTILE_ENABLED=true` e o hostname `curtiz.com.br` no widget. O formulário e a validação no servidor já usam essas variáveis.

## Homologação com e-mail real

Exige conta de teste e caixa postal autorizadas. Conferir: e-mail recebido, link, nova senha, login com ela, rejeição da senha antiga, link reutilizado/expirado e conta Google. Confirmar também que o `amr` da sessão de recuperação é `recovery` (premissa baseada na documentação de claims do Supabase).

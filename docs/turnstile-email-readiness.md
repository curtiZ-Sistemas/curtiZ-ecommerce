# Turnstile e confirmação de e-mail

Turnstile usa as telas existentes da loja: login (`login`), cadastro e reenvio de confirmação (`signup`), recuperação (`password_recovery`) e privacidade (`privacy_request`). Cada tentativa renova o widget; expiração/erro apaga o token. O backend exige HTTP válido, `success === true`, domínio exato e ação esperada. O token é limitado a 2048 caracteres; falhas de rede/JSON/configuração bloqueiam a ação protegida.

Configuração da loja:

- Build/GitHub: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (pública).
- Runtime/Cloudflare: `TURNSTILE_SECRET_KEY` (secret), `TURNSTILE_HOSTNAMES` (domínios exatos separados por vírgula), `TURNSTILE_ENABLED=true` somente após publicação e verificação.
- Domínios produtivos permitidos no servidor: `curtiz.com.br,curtiz-ecommerce.sistemas-curtiz.workers.dev`. Domínios locais, mesmo cadastrados no widget para desenvolvimento, não são aceitos pelo servidor com `APP_ENV=production`.
- Não ativar CAPTCHA nativo do Supabase apenas com essa configuração: o token é validado diretamente no backend existente, e as chamadas Supabase não recebem `captchaToken`.

No Supabase, a confirmação obrigatória de e-mail afeta novos cadastros. Antes de ativar, conferir SMTP, template de confirmação usando `{{ .ConfirmationURL }}`, callbacks e contas existentes. Manter a recuperação personalizada separada. Cadastro sem sessão retorna202 e mostra confirmação/reenvio protegido. As versões legais são capturadas no cadastro e preservadas no callback; erros de persistência encerram a sessão e não aparentam conclusão.

Alteração segura de e-mail exige confirmação no endereço antigo e no novo. Não alterar exigência de senha atual ou reautenticação sem adaptar os fluxos correspondentes. A fila de e-mails de pedidos (`EMAIL_ENABLED`) é independente dos e-mails de autenticação enviados pelo SMTP Supabase.

Referências: [Cloudflare: gestão de widgets](https://developers.cloudflare.com/turnstile/get-started/widget-management/api/), [validação no servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Supabase: templates de autenticação](https://supabase.com/docs/guides/auth/auth-email-templates).

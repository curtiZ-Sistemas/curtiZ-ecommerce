# Login com Google

Fluxo PKCE do Supabase SSR, iniciado por POST na loja. `/auth/callback` valida a intenção assinada de até dez minutos, troca o código e verifica perfil, papéis e MFA no servidor. Não vincula identidades manualmente, não altera papéis nem sobrescreve nome/telefone existentes. Usa a associação automática de e-mails verificados do Supabase, preservando o usuário e seu histórico.

O botão aparece em login/cadastro, mas exige configuração confirmada. `GOOGLE_AUTH_ENABLED` é uma flag **somente no Runtime da loja**, sem prefixo `NEXT_PUBLIC_`. Ausente ou diferente de `true`, ou se o Supabase informar Google desabilitado, o botão fica indisponível e o endpoint não inicia OAuth. A chave existente `RATE_LIMIT_HMAC_KEY` assina a intenção e protege um orçamento distribuído independente (30/min), sem migration.

## Configuração pelo responsável

1. No Google Auth Platform, usar um aplicativo dedicado de acesso à loja, separado do aplicativo de backup/Drive. Nome da marca: curti Z; domínio autorizado `curtiz.com.br`; página inicial `https://curtiz.com.br`; termos `https://curtiz.com.br/termos-de-uso`; privacidade `https://curtiz.com.br/politica-de-privacidade`. Usar o contato corporativo autorizado.
2. Criar um cliente OAuth do tipo Web. Origem JavaScript: `https://curtiz.com.br`. URI de redirecionamento do Google: `https://jfnkxdzusqymsvzckerl.supabase.co/auth/v1/callback`. Escopos apenas `openid`, e-mail e perfil. Não usar permissões de Drive nem solicitar acesso offline.
3. Inserir **Client ID** e **Client Secret** diretamente no provedor Google do Supabase principal. O Secret fica exclusivamente nessa configuração protegida; não entra no repositório, Cloudflare ou conversa. Habilitar o provedor depois de conferir os dados.
4. Na configuração de URLs do Supabase Auth, preservar as URLs existentes e autorizar `https://curtiz.com.br/auth/callback` para o retorno ao aplicativo, incluindo os parâmetros de estado usados pelo fluxo conforme a configuração de redirects do Supabase. Site URL: `https://curtiz.com.br`. Não ampliar para domínios arbitrários.
5. Publicar o consentimento Google para a audiência pretendida e concluir eventuais verificações de marca exigidas. Não ativar a flag da loja enquanto o aplicativo estiver limitado a contas de teste ou com configuração incompleta.
6. Validar com contas de teste autorizadas: cliente novo/existente, vinculação por e-mail verificado, funcionário, MFA, cancelamento, código expirado e sessão persistente. Depois, habilitar `GOOGLE_AUTH_ENABLED=true` no Worker `curtiz-ecommerce`. Não é necessário expor Client ID/Secret no frontend.

O aceite dos termos é explícito antes do redirecionamento; a intenção assinada guarda as versões legais exibidas pelo servidor. Marketing é opcional e separado; sua ausência não remove consentimentos de uma conta existente. Falha ao registrar consentimento ou validar acesso encerra somente a nova sessão local.

## Estado verificado em 18/10/2026

O endpoint público de configurações do Supabase informou `external.google=false`; não havia identidades Google cadastradas. A configuração externa e o teste real de login dependem do provedor habilitado e do responsável. O navegador compartilhado estava ocupado por outra sessão; nenhuma configuração de backup ou credencial foi reutilizada para contornar isso.

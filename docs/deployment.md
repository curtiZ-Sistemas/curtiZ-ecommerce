# Deploy

A produção usa dois aplicativos Next.js e dois Workers Cloudflare independentes:

- loja: `apps/store` → Worker `curtiz-ecommerce`;
- painel: `apps/panel` → Worker `curtiz-panel`.

O Supabase gerenciado continua sendo a fonte de verdade dos dados. Loja e painel precisam de URLs,
variáveis e rotas próprias.

## Caminho oficial de produção

O workflow `.github/workflows/ci.yml` é o único caminho automático de produção. Em cada `push` no
`main`, ele executa qualidade, migrations em um Supabase efêmero no runner Linux e E2E. Apenas após
todas as validações, o OpenNext compila as aplicações alteradas e o Wrangler publica o Worker
correspondente. O controle de concorrência cancela uma execução antiga quando chega um commit mais
novo, evitando deploy fora de ordem.

No Cloudflare, abra **Workers & Pages**, selecione cada Worker, acesse **Settings → Builds** e use
**Disconnect**. Repita em `curtiz-ecommerce` e `curtiz-panel`. Manter a integração Git nativa e o
GitHub Actions ativos ao mesmo tempo cria dois deploys concorrentes para o mesmo commit. As variáveis
e secrets de runtime permanecem no Cloudflare; o workflow usa `--keep-vars` e nunca os copia para o
repositório.

Configure no GitHub, em **Settings → Secrets and variables → Actions**:

- secrets: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`;
- variables: `NEXT_PUBLIC_STORE_URL`, `NEXT_PUBLIC_PANEL_URL`,
  `NEXT_PUBLIC_STORE_TEST_URL`, `NEXT_PUBLIC_PANEL_TEST_URL`,
  `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
- variable opcional: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, quando o Turnstile estiver habilitado.

O token Cloudflare deve ter somente as permissões necessárias para publicar os dois Workers na
conta correta. Não armazene tokens em variables públicas.

## Domínios públicos e aliases de teste

A origem canônica da loja é determinada somente por `NEXT_PUBLIC_STORE_URL`. O par de produção e o
par de teste devem ser configurados assim:

```dotenv
NEXT_PUBLIC_STORE_URL=https://curtiz.com.br
NEXT_PUBLIC_PANEL_URL=https://painel.curtiz.com.br
NEXT_PUBLIC_STORE_TEST_URL=https://curtiz-ecommerce.sistemas-curtiz.workers.dev
NEXT_PUBLIC_PANEL_TEST_URL=https://curtiz-panel.sistemas-curtiz.workers.dev
AUTH_COOKIE_DOMAINS=curtiz.com.br,sistemas-curtiz.workers.dev
ALLOWED_ORIGINS=https://curtiz.com.br,https://painel.curtiz.com.br,https://curtiz-ecommerce.sistemas-curtiz.workers.dev,https://curtiz-panel.sistemas-curtiz.workers.dev
```

As quatro variáveis `NEXT_PUBLIC_*_URL` são variáveis de build do GitHub Actions e devem ser
espelhadas com os mesmos valores no runtime dos dois Workers. As duas últimas são aliases, não
origens canônicas. `AUTH_COOKIE_DOMAINS` e `ALLOWED_ORIGINS` são variáveis somente de runtime dos
dois Workers no Cloudflare. A aplicação seleciona o par correspondente ao host da requisição; isso
mantém login, logout, MFA e navegação loja/painel isolados entre produção e teste.

No Cloudflare, associe `curtiz.com.br` ao Worker `curtiz-ecommerce` e
`painel.curtiz.com.br` ao Worker `curtiz-panel` como **Custom Domains**. Não adicione essas rotas ao
Wrangler: assim os domínios podem ser retirados e recolocados no painel sem alteração de código e
os endereços `workers.dev` permanecem habilitados. Para o `www`, crie um registro DNS `A` proxied
`www` apontando para `192.0.2.0` e um Single Redirect com padrão de entrada `https://www.*`, destino
`https://${1}`, status 301 e **Preserve query string** habilitado.

No Supabase Auth, use `https://curtiz.com.br` como **Site URL** e cadastre estas Redirect URLs:

```text
https://curtiz.com.br/auth/callback**
https://curtiz-ecommerce.sistemas-curtiz.workers.dev/auth/callback**
```

O `**` fica restrito ao final da rota real e é necessário porque confirmação e recuperação incluem
o parâmetro seguro `next` na query string. Se os templates de e-mail do Auth tiverem sido
personalizados, os links de confirmação e recuperação devem usar `{{ .RedirectTo }}`.

O ambiente local mantém as URLs adicionais definidas em `supabase/config.toml`.

Para republicar sem criar commit, abra **Actions → CI → Run workflow** e escolha `store`, `panel` ou
`both`. A execução manual passa pelas mesmas validações antes do deploy.

Cada deploy injeta apenas metadados não sensíveis (`GIT_COMMIT_SHA`, `BUILD_ID` e
`BUILD_TIMESTAMP`). O commit ativo pode ser consultado em `/api/version` na URL de cada aplicação.

## Validação dos ambientes

- `pnpm validate:development`: aceita URLs locais e mocks.
- `pnpm validate:staging`: exige URLs e Supabase remoto de homologação; aceita mocks explícitos.
- `pnpm validate:production`: exige HTTPS, chaves internas, origens permitidas e `DEMO_MODE=false`.

`NODE_ENV=production` seleciona otimizações do framework; não habilita integrações comerciais.
Integrações desativadas não devem receber tokens fictícios:

```dotenv
CHECKOUT_ENABLED=false
PAYMENT_PROVIDER=disabled
MERCADO_PAGO_ENABLED=false
SHIPPING_PROVIDER=disabled
MELHOR_ENVIO_ENABLED=false
EMAIL_PROVIDER=disabled
EMAIL_ENABLED=false
TURNSTILE_ENABLED=false
REQUIRE_INTERNAL_MFA=false
```

## Comandos equivalentes

Os comandos abaixo são úteis para diagnóstico ou operação manual autorizada. Execute-os na raiz do
monorepo após gerar o artefato OpenNext da aplicação correta:

```powershell
pnpm --filter @curtiz/store build:worker
pnpm exec wrangler deploy --config apps/store/wrangler.jsonc --env production --keep-vars

pnpm --filter @curtiz/panel build:worker
pnpm exec wrangler deploy --config apps/panel/wrangler.jsonc --env production --keep-vars
```

O `wrangler.jsonc` da raiz continua apontando exclusivamente para a loja por compatibilidade. Para o
painel, sempre informe `apps/panel/wrangler.jsonc`; apontar o painel para `apps/store` publica a loja
no Worker errado.

## Migrations

O CI inicia Supabase e Docker somente no runner Linux, aplica todas as migrations, executa
`supabase db lint` e os testes pgTAP. Nada exige Docker, WSL ou k6 no notebook Windows.

Aplicar migrations no Supabase remoto é uma operação separada do deploy dos Workers. Produção exige
aprovação explícita, backup verificado e conferência prévia da lista com `supabase migration list
--linked`. Nunca execute seed de demonstração em produção.

# Validação da correção dos Workers — 01/10/2026

Base: `dbdf333`. Ambiente: Windows, Node 24.19.0, pnpm 10.14.0, Next 16.3.6,
OpenNext 1.20.2 e Wrangler 4.86.0. Os manifests e importers do lockfile concordam;
nenhuma dependência foi atualizada. O pnpm reconheceu os nove projetos e seus links internos.
Os builds usaram configuração de validação equivalente à CI, com integrações comerciais
desativadas e placeholders internos, sem ler ou modificar valores secretos para o diagnóstico.

## Achados confirmados

- Loja: o Wrangler reempacota os imports dos jobs de `custom-worker.ts`, alcançando marcadores
  `server-only` que o Next resolve internamente. A tentativa inicial reproduziu os quatro
  arquivos do log e também o marcador da integração Bling já em andamento no diretório local.
  O alias exclusivo da loja resolveu esses marcadores; no dry-run posterior restou somente
  a ausência de `.open-next/worker.js`, explicada pelo bloqueio local abaixo.
- Painel: `next build --webpack` passou. O OpenNext local parou na criação de symlinks,
  assim como a loja. Isso **não comprova a causa da falha original no Cloudflare**, cujo log
  disponível termina na instalação do Node. Não se adicionou alias ao painel.
- O OpenNext instalado só propõe criar Wrangler config se não encontrar uma existente.
  Nas execuções observadas, as configurações originais foram preservadas. Os comandos de
  empacotamento e publicação agora selecionam explicitamente o arquivo de cada aplicação.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `pnpm check:exposure` | Passou |
| `pnpm lint` | Scripts, pacotes e painel passaram; loja falhou em dois arquivos Bling preexistentes, preservados fora desta correção |
| Lint dos arquivos TypeScript desta correção | Passou |
| Typecheck | Scripts e todos os oito projetos passaram; scripts e loja foram repetidos após ajustar os novos testes |
| Testes relacionados | 101 passaram: 58 de fronteira, handlers, CI, ambiente e secrets; 15 de housekeeping, imagens e contexto OpenNext; 28 das integrações |
| Next da loja e do painel | Compilação, TypeScript, páginas e verificação dos assets públicos passaram |
| `pnpm build:worker` / `pnpm build:worker:panel` | Ambos saíram com código 1 no OpenNext: `EPERM ... symlink` ao copiar dependências no Windows, mesmo fora do sandbox |
| `pnpm deploy:dry-run` | Código 1: o handler OpenNext não foi gerado; nenhum erro `server-only` restante |
| `pnpm deploy:dry-run:panel` | Código 1: entrypoint OpenNext não foi gerado |

Os testes dos handlers usam dependências isoladas e verificam delegação HTTP, imagens,
`waitUntil`, execução dos jobs e propagação de falhas. Não comprovam execução remota de cron,
acesso real ao banco, cotação, emissão fiscal ou cobrança. O teste do alias usa o esbuild
consumido pelo Wrangler e executa o módulo resultante; o teste de fronteira verifica as
resoluções reais de cliente/servidor do Next instalado. Isso não substitui os dois
empacotamentos finais completos.

## Pendências e publicação

Os builds e dry-runs completos estão pendentes no runner Linux. O CI agora exige os dry-runs
inclusive em PRs, preservando os gates de qualidade, banco, E2E e segurança. Esse CI remoto
não foi executado nesta tarefa; não houve push, upload de versão ou deploy.

Para diagnosticar o painel remoto, é necessário o trecho desde o comando de build após instalar
Node até o primeiro erro, stack e código de saída, com diretório, SHA e versões, sem secrets.
O painel também emitiu avisos de `process.cwd` no Edge Runtime e de cache webpack; ambos
compilaram com o aviso existente de migração de `middleware` para `proxy`.

O lint do diretório local ainda encontra `@typescript-eslint/no-base-to-string` em
`apps/store/src/app/api/webhooks/bling/route.ts:41` e
`@typescript-eslint/consistent-type-imports` em `apps/store/src/lib/bling-jobs.ts:1`.
Esses arquivos pertencem à integração preexistente e não entram no commit desta correção.

Confira e desconecte manualmente Workers Builds dos dois Workers no Cloudflare. Depois de
validar a correção em PR, integrar em `main` e passar todos os gates, publique somente pelo
GitHub Actions. Preserve secrets e a chave OAuth do Melhor Envio. Confira `/api/version`,
smoke sem cobrança, bindings e cron; mantenha a versão anterior para rollback.
Veja [o procedimento de deploy](deployment.md#empacotamento-final-dos-workers).

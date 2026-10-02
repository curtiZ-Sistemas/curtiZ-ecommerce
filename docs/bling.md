# Integração Bling API v3

## Arquitetura e autoridade

O fluxo existente de checkout mantém snapshots, reservas por variante, confirmação de pagamento pelo servidor e idempotência no Supabase. Foram reutilizados o armazenamento privado de OAuth, autenticação/MFA, permissões, fila `background_jobs`, Mercado Pago, Melhor Envio e os painéis existentes.

`packages/integrations/src/bling.ts` concentra OAuth, JWT, AES-GCM, refresh com lease/CAS, HTTP, erros sanitizados, assinatura e documentos. O painel inicia a autorização; a loja recebe webhooks e seu Worker processa os jobs no cron existente. Nenhuma flag comercial é ativada pela migration.

| Informação | Autoridade | Regra |
| --- | --- | --- |
| Catálogo, imagens por cor, SKU, preço e dimensões | curti Z/Supabase | Atualizações locais geram jobs; PATCH não altera imagens nem tributação no Bling. |
| Estoque físico | Supabase | `available_quantity + reserved_quantity`; reservar não baixa o físico. Pagamento, devolução e ajustes locais alteram o físico. Envio ao depósito Bling usa saldo absoluto e versão local. |
| Pagamento e reembolso | Mercado Pago confirmado no servidor | Bling nunca confirma pagamento local nem cria receita financeira adicional. |
| Venda ERP e fiscal | Bling | Referência `numeroLoja` é o código imutável local; variante é mapeada por SKU, nunca por título. |
| Entrega e rastreio | Melhor Envio | Mantém shipments, tracking, frete cobrado e custo separados. |
| Notificação fiscal | Resend | Aceitação real recebe ID; aceitação não significa entrega na caixa postal. |

Eventos de estoque/produto do Bling ficam registrados e são ignorados para alteração do catálogo local: não existe ciclo de sincronização. Arquivamento local desativa o produto externo por job. Se a remoção física já permitida pelas regras existentes apagar uma variante, seu vínculo/ID/SKU é preservado e um job solicita a inativação externa. Referências de pedidos também sobrevivem à retenção/arquivamento local, sem bloquear a rotina existente.

## Preparação manual por ambiente

O Bling usa a mesma API real para as operações aqui implementadas. O identificador interno `sandbox` reaproveita o contrato OAuth existente e **não representa um sandbox fiscal do Bling**. Use conta de teste, dados autorizados e Supabase isolado para validação. Não autorize a mesma instalação em bancos diferentes que operem a mesma conta: o rate limiter coordena apenas os Workers do mesmo banco. Instalações locais de teste e produção precisam de bases/contas separadas.

1. Aplique `supabase/migrations/202610020001_bling_integration.sql` depois das migrations anteriores, primeiro em banco isolado. Execute `supabase test db`; SQL estático e typecheck não substituem a execução dos testes de RLS, triggers e concorrência.
2. No Bling, acesse a área de aplicativos e crie aplicativo **Privado**, para operar a conta da empresa. Público destina-se a outras contas e exige o processo de homologação correspondente. Cadastre nome, descrição, logo e callback na aba de dados básicos.
3. Configure apenas os escopos de leitura/escrita dos recursos usados: dados básicos da empresa; contatos; produtos; estoques/depósitos; pedidos de venda; NF-e; natureza de operação; e leitura da forma de pagamento usada na configuração. Os nomes/IDs são selecionados na interface do Bling, não enviados por um `scope` inventado no authorize. Verifique as permissões na aba do aplicativo. A lista técnica informa recursos a conferir, não afirma consultar os escopos concedidos pelo provedor.
4. URLs exatas, conforme as origens documentadas no projeto:

   | Ambiente | Callback no Worker panel | Webhook no Worker store |
   | --- | --- | --- |
   | Produção, quando houver autorização para ativar | `https://painel.curtiz.com.br/api/integrations/bling/callback` | `https://curtiz.com.br/api/webhooks/bling` |
   | Instalação isolada de teste nos aliases existentes | `https://curtiz-panel.sistemas-curtiz.workers.dev/api/integrations/bling/callback` | `https://curtiz-ecommerce.sistemas-curtiz.workers.dev/api/webhooks/bling` |

   No teste, a origem canônica do painel deve ser o alias utilizado, tanto no build quanto no runtime. O callback precisa coincidir com `BLING_REDIRECT_URI` e `NEXT_PUBLIC_PANEL_URL`; não use um callback de teste com a origem canônica de produção.
5. Configure secrets Cloudflare **server-only**, no ambiente nomeado de cada Worker. Client ID/secret e chave devem ser os mesmos no panel e store que compartilham o banco. Não use `NEXT_PUBLIC_*` para credenciais.

   | Nome | Workers | Conteúdo/configuração |
   | --- | --- | --- |
   | `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` | panel e store | Dados do aplicativo; secret nunca aparece na UI. |
   | `BLING_TOKEN_ENCRYPTION_KEY` | panel e store | Base64 de 32 bytes aleatórios; guarde em secret manager. Rotação exige procedimento de recriptografia/reconexão. |
   | `BLING_REDIRECT_URI` | panel | Uma URL da tabela acima, HTTPS, sem query. |
   | `APP_ENV`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | ambos | Configuração existente; banco da instalação correspondente. |
   | `PII_ENCRYPTION_KEY` | store | Chave existente para o CPF **salvo no pedido**, sem buscar o CPF atual do perfil. |
   | `BLING_PAYMENT_METHOD_ID` | store | ID real, no Bling, da forma de pagamento correspondente ao recebimento via Mercado Pago. |
   | `BLING_STOCK_DEPOSIT_ID` | store | ID real do depósito que receberá o saldo local. |
   | `BLING_NATURE_OF_OPERATION_ID` | store | ID real e ativo, padrão venda ou venda pessoa física, validado pela contabilidade. |
   | `BLING_WEBHOOK_CONFIGURED` | panel | `true` somente depois de cadastrar e verificar o webhook; não prova entrega. |
   | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | store | API key existente e endereço remetente simples de domínio verificado; necessários apenas para a notificação. |

   Cadastre secrets com `pnpm exec wrangler secret put NOME --config apps/panel/wrangler.jsonc --env staging` e o equivalente `apps/store/wrangler.jsonc`; use entrada interativa, nunca coloque valores na linha de comando ou no Git. Produção requer autorização própria. Variáveis não sensíveis e flags devem ser definidas no ambiente Cloudflare correspondente e preservadas pelos deploys existentes.
6. Mantenha todas as flags abaixo em `false` inicialmente. Em **Técnico → Integrações → Bling**, conecte com sessão ativa, permissão `technical.integrations.manage` e MFA aplicável. O state é aleatório, hasheado, ligado ao usuário/ambiente e consumido uma vez em cinco minutos. Só persistimos novos tokens depois de verificar a empresa. Outra empresa exige migração revisada das referências; reconectar não remapeia IDs.
7. Na aba Webhooks do aplicativo, cadastre a URL da loja, versão 1, recursos `order`, `invoice`, `product`, `stock` e ações created/updated/deleted disponíveis. `virtual_stock` acompanha stock segundo o Bling. O receiver valida o corpo bruto, empresa e HMAC antes de persistir evento/job atomicamente; duplicatas recebem 200. Eventos novos/desconhecidos ficam guardados. O processamento consulta o estado atual do recurso e aplica observações pela data da consulta, não pela ordem de entrega.
8. Faça o teste técnico de API e a prévia paginada de SKUs. Confirmar uma página relê a prévia e verifica SKUs duplicados também em outras páginas antes de vincular. Não cria produtos. A criação explícita consulta por SKU antes de criar; conflitos exigem conferência.

## Ativação gradual

| Flag no store | Critério para ativar |
| --- | --- |
| `BLING_PRODUCT_CREATE_ENABLED` | Cadastro local revisado; usar ação individual na prévia técnica. Nenhuma emissão fiscal está envolvida. |
| `BLING_PRODUCT_SYNC_ENABLED` | Vínculos confirmados; catálogo local é a autoridade; peso/dimensões/preços corretos. |
| `BLING_STOCK_SYNC_ENABLED` | Depósito real confirmado e saldo físico local reconciliado; avaliar outras aplicações que escrevam nesse depósito. |
| `BLING_ORDER_SYNC_ENABLED` | SKUs mapeados, snapshots/CPF/endereço e forma de pagamento real conferidos; pagamento aprovado pelo fluxo existente do MP. |
| `BLING_FISCAL_READY` | Empresa/contador conferiu empresa, regime, certificado, autorização SEFAZ, inscrição, natureza padrão, NCM e demais regras tributárias no Bling. A flag registra essa conferência e não substitui cadastro/certificado. |
| `BLING_INVOICE_SYNC_ENABLED` | Teste autorizado para gerar rascunho; preflight de empresa, natureza ativa/padrão, produtos/NCM e pagamento passou. |
| `BLING_INVOICE_SEND_ENABLED` | Autorização explícita para emissão real, configuração fiscal validada e rascunho com natureza correspondente. Permanecer desabilitada nesta entrega. |
| `BLING_REQUIRE_INVOICE_FOR_SHIPPING` | Política fiscal aprovada. Ative antes de operar expedição: `select public.set_bling_shipping_policy(true);` como dono do banco, em mudança revisada. O cron também ativa a política. Ela permanece ativa no banco mesmo se a flag sumir. Remoção exige revisão explícita pelo dono do banco. |
| `BLING_INVOICE_EMAIL_ENABLED` | Remetente Resend verificado, origem da loja correta e teste de aceitação real autorizado. A fila fica pendente sem credenciais e não mostra envio fictício. |

No panel, espelhe as flags de produto/estoque/pedido/fiscal para a informação técnica refletir a configuração do store. O processamento pertence ao store. Cron existente: a cada cinco minutos, até quatro jobs Bling por execução; trabalho sequencial, lease renovado antes de chamadas HTTP e histórico persistente.

O rate limiter no banco espaça requisições em 334 ms e compartilha a conta entre ambientes. Contabiliza até 120 mil chamadas em uma janela móvel conservadora de 24 horas, agrupada por hora (pode manter até uma hora adicional no limite). OAuth também tem espaçamento de 3,1 s para respeitar 20 chamadas/minuto da instalação. Outras aplicações/contas atrás do mesmo IP Cloudflare podem consumir limites que esta instalação não controla: 429 permanece tratado com Retry-After e tentativas limitadas.

## Operação e recuperação

- Técnico: status de configuração/conexão, empresa, recursos de escopo a conferir, expiração, último teste real da API, webhook, fila, preview e conexão/revogação. Ausência de eventos por 48 horas sinaliza verificação; não prova que o webhook quebrou, pois a conta pode não ter atividade.
- Administrativo: estado por SKU no editor de variantes e lista de pedidos integrados no contexto de pedidos. Retry exige permissão de produto/pedido e estado elegível.
- Operacional: filtros de ERP/nota/falhas, código local, ID externo, motivo sanitizado, histórico de tentativas e consulta/conciliação. Reprocessamento comum não repete operação incerta.
- Gerencial: contagem enxuta de sincronizados/pendentes/falhas e detalhe de pedidos. Não há nova soma de faturamento.
- Cliente: nota disponível apenas quando autorizada com chave válida. Download é autenticado, limitado ao dono do pedido e reconfirma o estado atual no Bling; o PDF vem do envelope oficial base64+gzip. Falha fiscal não altera pagamento nem expõe erro interno.

HTTP GET pode repetir com backoff/jitter limitado. POST/PATCH com timeout, rede, 5xx ou resposta inválida vira resultado incerto e não é repetido automaticamente. “Consultar e conciliar” só procura registros existentes. Se nenhum for encontrado, confira a operação no Bling antes de qualquer intervenção manual: não existe botão que force nova emissão após resultado incerto. Cancelamento, estorno parcial/total e devolução local exigem conciliação do ERP e da nota pela empresa/contador; não há cancelamento fiscal automático. O financeiro existente continua conciliando MP uma única vez.

Para pedidos, a conciliação confere referência, total e todos os itens antes de confirmar a venda existente; só encerra falha de geração quando há nota vinculada e falha de envio quando a nota está autorizada. Para produtos, “Consultar vínculo” confirma o SKU e o ID externo existentes; após essa conferência, atualizações de catálogo e saldo absoluto que falharam podem voltar à fila, conforme suas flags. Nenhuma dessas consultas cria um produto, uma venda ou uma nota externa.

Com a política fiscal ativa, triggers no banco bloqueiam etapas de shipment sem pagamento e nota autorizados; o job Melhor Envio aguarda a nota e recebe sua chave real. Autorização fiscal libera jobs de frete bloqueados por esse motivo. As restrições existentes de Melhor Envio/MP para testes continuam aplicadas; esta entrega não habilita seus modos de produção.

Notificação Resend registra aceitação somente com ID retornado. Resultado incerto exige conferência manual, inclusive após falha ao salvar o recibo local; não se arrisca uma repetição depois do prazo de 24h da idempotência do provedor. Não afirmamos entrega do e-mail sem evento de entrega.

## Validação e limites desta entrega

Testes automatizados com APIs simuladas cobrem criptografia/JWT/OAuth/refresh concorrente, rejeição de state, assinatura/raw body/duplicatas/empresa/eventos desconhecidos, 429/Retry-After, escrita incerta, snapshots/SKU/totais/pagamentos inelegíveis, documentos do cliente e aceitação Resend. `supabase/tests/bling_integration_test.sql` cobre privilégios/RLS, persistência idempotente, lease, histórico, limite e conta em banco isolado. Sua execução depende de PostgreSQL/Supabase disponível; não deve ser substituída por busca de texto.

Migration não aplicada, conexão real, certificado/SEFAZ, emissão fiscal, entrega de e-mail e processamento externo integral precisam de validação controlada autorizada antes de ativação. Credenciais não foram lidas nem adicionadas ao repositório. Veja o relatório de execução em `docs/bling-validation.md`.

## Contratos oficiais consultados

- [Aplicativos/OAuth e revogação](https://developer.bling.com.br/aplicativos)
- [JWT e enable-jwt](https://developer.bling.com.br/migracao-jwt)
- [Referência de endpoints/OpenAPI](https://developer.bling.com.br/referencia)
- [Webhooks](https://developer.bling.com.br/webhooks)
- [Limites por conta e IP](https://developer.bling.com.br/limites)
- [Envio de e-mails Resend](https://resend.com/docs/api-reference/emails/send-email)
- [Idempotência Resend](https://resend.com/docs/dashboard/emails/idempotency-keys)

# Integração Bling API v3

## Arquitetura e autoridade

O fluxo existente de checkout mantém snapshots, reservas por variante, confirmação de pagamento pelo servidor e idempotência no Supabase. Foram reutilizados o armazenamento privado de OAuth, autenticação/MFA, permissões, fila `background_jobs`, Mercado Pago, Melhor Envio e os painéis existentes.

`packages/integrations/src/bling.ts` concentra OAuth, JWT, AES-GCM, refresh com lease/CAS, HTTP, erros sanitizados, assinatura e documentos. O painel inicia a autorização; a loja recebe webhooks e seu Worker processa os jobs no cron existente. Nenhuma flag comercial é ativada pela migration.

| Informação | Autoridade | Regra |
| --- | --- | --- |
| Catálogo, imagens por cor, SKU, preço e dimensões | curti Z/Supabase | Atualizações locais geram jobs; imagens vêm exclusivamente do bucket público do catálogo. Unidade/NCM/origem/CEST só são enviados quando existe metadata privada revisada. |
| Estoque físico | Supabase | `available_quantity + reserved_quantity`; reservar não baixa o físico. Pagamento, devolução e ajustes locais alteram o físico. Envio ao depósito Bling usa saldo absoluto e versão local. |
| Pagamento e reembolso | Mercado Pago confirmado no servidor | Bling nunca confirma pagamento local nem cria receita financeira adicional. |
| Venda ERP e fiscal | Bling | Referência `numeroLoja` é o código imutável local; variante é mapeada por SKU, nunca por título. |
| Entrega e rastreio | Melhor Envio | Mantém shipments, tracking, frete cobrado e custo separados. |
| Notificação fiscal | Resend | Aceitação real recebe ID; aceitação não significa entrega na caixa postal. |

Eventos de estoque/produto do Bling ficam registrados e são ignorados para alteração do catálogo local: não existe ciclo de sincronização. Arquivamento local desativa o produto externo por job. Se a remoção física já permitida pelas regras existentes apagar uma variante, seu vínculo/ID/SKU é preservado e um job solicita a inativação externa. Referências de pedidos também sobrevivem à retenção/arquivamento local, sem bloquear a rotina existente.

## Preparação manual por ambiente

### Automação fiscal da Parte 1

A migration `20261017175643_part1_fiscal_automation.sql` acrescenta a declaração fiscal imutável do comprador, aprovação automática de espelhos sob uma política privada e filas de consulta/arquivamento. Não contém dados empresariais, autorização fiscal nem ativação comercial.

O checkout registra separadamente contribuinte de ICMS e consumidor final. Pedidos antigos sem declaração continuam bloqueados para aprovação automática; não se infere uma condição da outra. Após conferir regras, naturezas reais, unidades, certificado, ambiente e histórico das séries, o operador técnico registra a evidência e o hash de `private.bling_fiscal_configuration_hash()` em `private.bling_fiscal_automation_policy`. Essa autorização é privada e não pode ser criada pelo navegador. Mudanças na configuração impedem novas aprovações automáticas até nova conferência. Espelhos já aprovados continuam sujeitos à comparação exata antes de gerar/transmitir.

Kits permanecem uma única linha comercial no Supabase e no pedido ERP, com saldo próprio. A migration `20261017200032_bling_kit_fiscal_decomposition.sql` acrescenta composição fiscal privada por variação e CSTs separados de PIS/COFINS/IPI. Cada componente tem código fiscal rastreável, descrição real, unidade PR, classificação, quantidade e peso de rateio aprovados. Nenhuma composição é deduzida automaticamente em runtime. Uma mudança no SKU, cor, tamanho, descrição ou classificação invalida a origem aprovada; componentes ausentes, repetidos ou incompletos impedem a geração. Não há vínculo da composição com estoque de avulsos nem criação automática de produtos avulsos.

O valor comercial é distribuído por maior resto em centavos inteiros. Se uma quantidade repetida não admite preço unitário exato em duas casas, a rotina divide em no máximo dois grupos de preço por componente. A soma permanece exata, inclusive para múltiplos kits; frete, desconto e total do pedido são preservados. A validação da NF-e compara a lista fiscal expandida completa, incluindo multiplicidade, códigos, classificação, quantidades e valores: aceita a decomposição aprovada e continua rejeitando pares extras/ausentes ou valores divergentes.

Somente um rascunho pendente, sem chave e ainda correspondente integralmente às linhas comerciais originais, pode ser desdobrado pelo PUT oficial de NF-e. Número e natureza existentes são preservados; notas transmitidas ou alteradas não são sobrescritas. A rotina relê o rascunho após a alteração e não repete escrita incerta. A preparação de kits exige `BLING_INVOICE_STOCK_AUTOMATION_DISABLED=true`, somente depois de conferir no Bling que geração/transmissão de notas não baixará estoque novamente. Isso não configura o ERP por si só. Não chamar rotas de lançamento de estoque da NF-e: o estoque físico continua sendo sincronizado pelo saldo absoluto do Supabase.

Os CSTs aprovados fazem parte do hash do espelho. PIS/COFINS/IPI são configurados na natureza no Bling: o contrato da API de itens não permite escrevê-los como campos avulsos. A API retorna ICMS, mas não expõe os demais impostos integralmente; a conferência da natureza e a homologação do XML continuam necessárias. Não inventar alíquotas ou códigos de enquadramento para completar esses CSTs.

Pedidos novos preparados para emissão incluem a natureza aprovada em cada item. Na geração, um pedido externo sem essa natureza é bloqueado, evitando adotar silenciosamente a natureza padrão do ERP. Pedidos anteriores exigem reconciliação e correção conferida no provedor.

Além de `BLING_FISCAL_READY`, `BLING_INVOICE_SYNC_ENABLED` e `BLING_INVOICE_SEND_ENABLED`, a transmissão exige `BLING_INVOICE_TRANSMISSION_MODE=homologation|production`. Produção também exige `BLING_LIVE_INVOICE_SEND_AUTHORIZED=true`, somente após autorização específica. O nome interno OAuth `sandbox` não comprova homologação fiscal: a API de NF-e não expõe o ambiente nessa resposta; conferir o ambiente efetivo no Bling antes de configurar essa variável. Não se alteram contadores nem se pressupõe numeração inicial livre.

As ações Preparar, Solicitar emissão e Consultar do painel enfileiram os mesmos jobs persistentes da automação, com permissões, origem, limite de requisições e controle de concorrência existentes. Consultas são somente leitura e podem reconciliar notas quando um webhook não chega. Processamento pendente usa retries limitados; após esgotá-los, a consulta manual permite reprocessar. Escritas incertas continuam exigindo reconciliação.

Uma autorização observada no provedor agenda um único arquivamento de XML e DANFE no bucket privado `fiscal-documents`, com hash SHA-256, limite de tamanho e sem sobrescrita. Reexecução recupera um upload anterior conferindo seu conteúdo. O download autenticado existente aceita `?format=xml` e mantém a verificação de titularidade e da situação atual no provedor. Rejeição, cancelamento ou nota não autorizada não liberam documento. As interfaces de e-mail e expedição permanecem preservadas para a Parte 2; esta alteração não as ativa.

Referência do contrato de documentos: [OpenAPI oficial do Bling](https://developer.bling.com.br/referencia#/Notas%20Fiscais%20Eletr%C3%B4nicas).

O Bling usa a mesma API real para as operações aqui implementadas. O identificador interno `sandbox` reaproveita o contrato OAuth existente e **não representa um sandbox fiscal do Bling**. Use conta de teste, dados autorizados e Supabase isolado para validação. Não autorize a mesma instalação em bancos diferentes que operem a mesma conta: o rate limiter coordena apenas os Workers do mesmo banco. Instalações locais de teste e produção precisam de bases/contas separadas.

1. Aplique `supabase/migrations/202610020001_bling_integration.sql` depois das migrations anteriores, primeiro em banco isolado. Execute `supabase test db`; SQL estático e typecheck não substituem a execução dos testes de RLS, triggers e concorrência.
2. No Bling, acesse a área de aplicativos e crie aplicativo **Privado**, para operar a conta da empresa. Público destina-se a outras contas e exige o processo de homologação correspondente. Cadastre nome, descrição, logo e callback na aba de dados básicos.
3. Configure apenas os escopos de leitura/escrita dos recursos usados: dados básicos da empresa; contatos; produtos; estoques/depósitos; pedidos de venda; NF-e; natureza de operação; e leitura da forma de pagamento usada na configuração. Os nomes/IDs são selecionados na interface do Bling, não enviados por um `scope` inventado no authorize. Verifique as permissões na aba do aplicativo. A lista técnica informa recursos a conferir, não afirma consultar os escopos concedidos pelo provedor.
4. URLs exatas, conforme as origens documentadas no projeto:

   | Ambiente | Callback no Worker panel | Webhook no Worker store |
   | --- | --- | --- |
   | Produção, quando houver autorização para ativar | `https://painel.curtiz.com.br/api/integrations/bling/callback` | `https://curtiz.com.br/api/webhooks/bling` |
   | Instalação isolada de teste nos aliases existentes | `https://curtiz-painel.sistemas-curtiz.workers.dev/api/integrations/bling/callback` | `https://curtiz-ecommerce.sistemas-curtiz.workers.dev/api/webhooks/bling` |

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
   | Naturezas fiscais por cenário | banco privado | `private.bling_fiscal_rules` registra IDs reais conferidos no Bling, por UF/contribuinte/operação. O antigo `BLING_NATURE_OF_OPERATION_ID` global não decide mais a emissão. |
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

No panel, espelhe as flags de produto/estoque/pedido/fiscal para a informação técnica refletir a configuração do store. O cron pertence ao store; o painel também pode processar um lote explícito de catálogo. Cron existente: a cada cinco minutos, até quatro jobs Bling por execução; trabalho sequencial, lease renovado antes de chamadas HTTP e histórico persistente.

O botão técnico **Processar lote de catálogo** executa até quatro tarefas já enfileiradas; a API aceita de uma a oito. Exige a mesma sessão ativa, permissão, MFA aplicável, origem e orçamento de mutações das demais ações técnicas. Compartilha a trava global com o cron e só reivindica tarefas de produto/estoque, nunca pedidos, notas ou e-mails. Falhas interrompem o lote; escritas incertas exigem conciliação por SKU, sem repetição automática.

Custos permanecem nos campos existentes `cost_price`/`cost_override`. O balanço de estoque envia o custo unitário no campo documentado `custo`, sem adicionar despesas ao checkout. `precoCusto` do resumo de produto é um campo de leitura relacionado ao fornecedor padrão: não inventar fornecedor para preenchê-lo nem presumir que o custo do movimento equivale a esse cadastro. A conferência externa deve distinguir os dois.

Uma variação é vinculada pelo seu SKU existente. Kits conservam sua quantidade por SKU e o número de pares em metadata; o sincronizador não cria vínculos de componentes nem baixa pares individuais por inferência. Unidade fiscal de kit e compartilhamento físico precisam de conferência própria; o saldo provisório autorizado não representa contagem física validada nem libera vendas reais.

O Bling limita o código a 60 caracteres. SKUs locais que cabem permanecem idênticos; os maiores usam somente no provedor `CZ-` seguido do UUID da variante sem hífens. O SKU original e o ID externo permanecem no vínculo privado. Cadastros já truncados exigem a ação técnica explícita `POST /api/integrations/bling/catalog/normalize` com `variantId`: ela confere ID, descrição, prefixo truncado e ausência de alias conflitante, altera apenas o código do registro existente e relê o resultado. Não recria produto, não altera SKU local e não usa essa reparação como retry automático de escrita incerta.

## Espelho fiscal sem numeração

`POST /api/integrations/bling/fiscal-preview` no painel técnico prepara um espelho local por variante/cenário ou pelo snapshot de um pedido. Não chama o Bling, não cria pedido ou NF-e, não consome numeração e não transmite à SEFAZ. Retorna valores em centavos, unidade/pares, NCM, regra recebida, bloqueios e hash. Dados pessoais do pedido entram somente em um hash de contexto; não são reproduzidos no espelho.

As migrations não semeiam regras fiscais, IDs de natureza ou dados empresariais. A configuração privada distingue venda interna, interestadual contribuinte, interestadual não contribuinte e devoluções internas/interestaduais. A escolha exige UF válida e situação do destinatário explícita; não há alternativa arbitrária entre CFOPs. IDs reais ainda precisam corresponder às regras e séries configuradas no provedor, preservando documentos/numeração existentes.

`private.bling_fiscal_natures` vincula cada cenário e indicador explícito de consumidor final a um ID conferido. Um contribuinte pode ser consumidor final; a escolha não deriva uma condição da outra. O ID legado único não serve como alternativa quando falta esse vínculo. Prévias por variante aceitam `finalConsumer`; sem esse dado continuam sem natureza selecionada. A aprovação de pedido sempre exige ambos os indicadores.

`GET /api/integrations/bling/readiness?scope=catalog&page=1` consulta até cem produtos e seus saldos no depósito configurado e compara SKU, preço, situação e saldo físico com o Supabase. Saldo físico local soma disponível e reservado. Ausência de saldo externo é divergência, nunca zero confirmado. A conferência integral deve reunir todas as páginas e detectar SKUs repetidos também entre páginas.

`GET /api/integrations/bling/readiness?scope=series&series=2` verifica existência de NF-e da série informada nas duas direções, incluindo canceladas em consulta separada e período amplo. Retorna somente o indicador de uso; não expõe destinatários, não cria nota e não modifica contadores. Falha de consulta impede afirmar que a série está livre. As duas consultas exigem sessão técnica ativa, permissão e MFA aplicável.

Antes da geração fiscal, o servidor exige `BLING_FISCAL_READY`, as flags específicas, pagamento aprovado, vínculo ERP, metadata fiscal e aprovação documentada do espelho exato em `private.bling_fiscal_mirror_approvals`. O hash vincula destinatário, endereço, itens, preços, frete, descontos e regra. Alterações invalidam a aprovação. Essa tabela não é gravável por clientes. O envio reconfere natureza, série e CFOPs da nota; ausência ou divergência bloqueia a transmissão. Certificado, SEFAZ e homologação real permanecem requisitos separados. O certificado A1 e sua senha são responsabilidade do titular e não passam por esse fluxo.

Pedidos usam a unidade comercial revisada do produto vinculado; ausência de unidade bloqueia o envio ao ERP. Antes de transmitir uma nota, a releitura compara todos os códigos externos, unidades, quantidades, preços, NCM, origem, CEST, CFOPs, total e frete com o espelho aprovado. Alterações e linhas duplicadas bloqueiam a transmissão. Essa proteção não substitui a homologação dos demais campos tributários e dos indicadores que não são expostos integralmente pela API.

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

# Preparação de produção — 15/10/2026

Registro técnico desta execução. Não autoriza vendas reais nem emissão fiscal.

## Achados e correções

| Gravidade | Achado confirmado | Correção / estado |
| --- | --- | --- |
| P0 | O cron dispara, mas Workerd rejeita `redirect: "error"` nas chamadas de saída; expiração e filas falham. | Transporte nativo converte para `manual` e rejeita 301/302/303/307/308, sem seguir o destino nem repetir POST. Reproduzido e validado no Workerd local. Publicação pendente. |
| P1 | `/tecnico/integracoes` renderiza somente a tabela genérica, ocultando os controles Bling/Melhor Envio já implementados. | Preservada a tabela e incluído o diagnóstico existente na rota. Regressão E2E acrescentada. |
| P1 | `published_help_contents` aplica expiração somente ao caminho de agendamento por precedência de `AND`/`OR`. | Migration incremental e nove verificações pgTAP: prazo vencido/exato/futuro, publicação, agendamento, rascunho, papéis e metadados privados. Não aplicada remotamente nesta etapa. |
| P1 | Query strings não eram removidas dos logs/traces dos dois Workers; callbacks OAuth usam parâmetros sensíveis. | `observability.redact_query_string=true` configurado e relido nos dois Workers; observabilidade e nomes/tipos dos bindings preservados. Não se afirma exposição anterior de credenciais. |
| P2 | Vitest podia descobrir testes de cópias antigas sob `.cache`. | Excluídos caches e artefatos da descoberta. |

## Plataformas e integrações

- **Cloudflare — TESTADO:** domínios oficiais associados aos Workers corretos; Workers Builds sem triggers nos dois; cron `*/5 * * * *` da loja presente. CI da base `6cd84b0` aprovado, com banco/E2E/build/dry-run da loja; painel ativo na base anterior `fe7c876` por detecção de escopo. Isso não comprova o novo commit.
- **Bling — TESTADO parcialmente:** chamada técnica real de leitura respondeu 200; renovação do access token comprovada por metadados de validade, sem consultar valores. Forma de pagamento configurada corresponde a Mercado Pago. Depósito único, ativo e padrão conferido na interface; `BLING_STOCK_DEPOSIT_ID` cadastrado como Text nos dois Workers, sem ativar sincronização.
- **Bling — PENDENTE:** revisar aplicativo/escopos, comprovar entrega/processamento/idempotência do webhook e sincronização controlada por SKU. Não há eventos Bling registrados. Webhook cadastrado não comprova operação.
- **Fiscal — BLOQUEADO:** `BLING_FISCAL_READY=false` e `BLING_INVOICE_SEND_ENABLED=false`. Natureza definitiva depende da contabilidade; nenhuma regra tributária foi definida. Sem NF-e, cancelamento ou escrita comercial real.
- **Mercado Pago — PENDENTE:** runtime em `test`; o código mantém guardas `TEST-` e não oferece adapter live homologado. Testes automatizados não equivalem a pagamento oficial de teste concluído. Não trocar para produção por simples substituição do token.
- **Melhor Envio — TESTADO parcialmente:** OAuth sandbox conectado; registro da loja indica cotação bem-sucedida em 14/10. Cotação/checkout completo e remessa de teste precisam de execução atual com dados fictícios. Não houve compra de frete real.
- **Resend — TESTADO parcialmente:** domínio e DNS de envio verificados; API key presente. Templates são internos; acompanhamento usa consulta de recibos, sem necessidade de templates/webhook no provedor.
- **E-mails — BLOQUEADO pelo cron até publicação:** runtime comercial permanece desligado no Worker e no banco. Homologação autorizada foi tentada com os dois modelos, sem pedido real; transporte falhou e métricas agregadas indicaram zero envios. Bindings temporários de homologação removidos após a tentativa. Aceitação e entrega ainda não comprovadas.

## Supabase e segurança

- **TESTADO:** nenhuma tabela de `public` sem RLS. `anon` e `authenticated` não possuem SELECT nas tabelas privadas de credenciais, contas Bling e mensagens. Leitura anônima das quatro views públicas executada sem consultar dados pessoais.
- **PENDENTE, sem alteração indiscriminada:** quatro views com aviso SECURITY DEFINER, 24 funções acessíveis a anon e 142 a authenticated. As views são projeções públicas sobre dados editoriais protegidos; trocar para invoker exige preservar esse contrato. A correção localizada de expiração não remove esses avisos.
- **PENDENTE:** proteção de senhas vazadas desativada; verificar disponibilidade no plano. MFA e Turnstile desligados; MFA obrigatório depende de conta interna de teste com fator e recuperação validados.
- **PENDENTE, desempenho:** advisors apontaram 300 FKs sem índice, 219 avisos de initplan, 264 de policies permissivas e 38 índices sem uso. Não foram criados/removidos índices sem evidência de custo.
- **PENDENTE:** histórico remoto contém somente cinco migrations, apesar de existir schema de outras migrations. Não reaplicar toda a história nem usar seed em produção; reconciliar definições/histórico antes de futuras mudanças amplas.

## Evidências de validação

- **TESTADO:** suites dos oito workspaces, sequenciais, 1.311 testes; scripts/contratos estáticos, 333 testes. Os dois erros de caminho da execução global não canônica passaram nos respectivos diretórios oficiais.
- **TESTADO:** 31 testes direcionados de transporte, expiração e e-mail; dez testes do wrapper do Worker. Incluem transporte capturado antes do Next, falhas e redirecionamentos sem replay. São testes com provedores simulados.
- **TESTADO no runtime local:** antes da correção, Workerd reproduziu `Invalid redirect value`; depois, POST retornou 200 e 302 foi rejeitado. Serviços fictícios locais, sem dados/credenciais reais nem escrita externa.
- **TESTADO:** typecheck de scripts, loja e painel; smoke remoto da loja (home, catálogo, configuração pública, versão e disponibilidade) passou sem iniciar compra.
- **PENDENTE:** lint final e CI do novo commit, pgTAP da nova migration, E2E atualizado, builds/dry-runs completos Linux e smoke após publicação. Docker ausente neste notebook; não há validação SQL local equivalente.

## Validação necessária com o contador/responsável

Confirmar documentalmente fabricação própria e regime tributário; inscrição e situação fiscal; certificado/autorização SEFAZ; natureza ativa adequada; CFOP/CSOSN/CST/NCM/CEST e tributos aplicáveis; regras interestaduais e eventuais benefícios; procedimento de emissão/cancelamento e bloqueio fiscal da expedição. A lista não propõe códigos ou alíquotas.

## Entrega e rollback

Branch `fix/production-readiness-20261015`, criada da `main` `6cd84b0880ec06bf5b60c4ec7aa8c1a274172e7c`. Commit, PR, checks e publicação desta execução ainda pendentes.

Rollback de código pelo caminho oficial do Actions com versão anterior validada. O predicado anterior da view permanece em `202608080006_help_center_reform.sql` para uma migration de reversão revisada; não apagar dados. O depósito pode ser removido do runtime com as flags comerciais desligadas. Manter a remoção de query strings dos logs.

**NO-GO comercial:** pagamentos/frete reais, emissão fiscal, e-mails, MFA e validações externas completas ainda pendentes. **Preparação técnica em andamento:** não declarar entrega concluída somente por unitários, HTTP 200 ou credenciais presentes.

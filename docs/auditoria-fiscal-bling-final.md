# Auditoria fiscal do atacado MG no Bling

**26/11/2026 · curti Z**

O fluxo MG02 foi revisado no Bling, no Supabase, no código e nos logs do Cloudflare. A correção desta sessão cobre o pagamento e os totais do rascunho e do XML. O aceite fiscal de ponta a ponta permanece pendente dos documentos autorizados em ambiente isolado. Nenhuma nota ou pedido comercial foi criado, excluído, transmitido ou estornado nesta sessão.

## Configuração e evidência

| Item | Antes da auditoria | Após a auditoria |
| --- | --- | --- |
| Emissão | Produção, leiaute 4.00. Auditoria anterior registrou resposta do ambiente principal SEFAZ MG e SVC desabilitado pela origem. | Nenhuma alteração de ambiente. A disponibilidade da SEFAZ não comprova autorização do fluxo. |
| Certificado | A1 no servidor, validade 31/07/2027, conforme configuração anteriormente confirmada. | Certificado preservado. A conferência atual não recuperou os dados do certificado pela interface. |
| Retirada e entrega | Desativadas na configuração geral de preenchimento de NF-e. | Conferidas ao vivo e mantidas desativadas. Faltou comprovar a regressão do varejo com esta preferência global ativa. |
| Frete | Padrão geral CIF (`0`). Atacado próprio deve informar `3`, sem valor de frete. | Padrão geral preservado. O código exige total do frete zero e modalidade `3` ao conferir o rascunho de atacado. |
| Numeração | Última leitura do painel Bling exibiu `001` próximo `2`, `002` próximo `6`, `003` próximo `3`, sem linha `004`. | Nenhum contador alterado. A ausência de `004` não comprova disponibilidade da sequência. O Bling exibe o controle após haver uma sequência de notas salvas. |
| Estoque e contas da NF-e | Lançamentos automáticos na emissão e cancelamento e emissão automática após geração em lote desativados conforme evidência anterior. | Configuração preservada. Workers têm `BLING_INVOICE_STOCK_AUTOMATION_DISABLED=true`. A situação das automações de **pedidos** e dos lançamentos vinculados ainda depende de conferência no ERP. |
| Depósito | `BLING_STOCK_DEPOSIT_ID=14889172958` na loja e no painel, conferido no Cloudflare. | Nenhum saldo alterado. Nome do depósito, vínculo com o endereço físico de Nova Serrana e saldos no Bling pendentes de leitura da conta. |

[Configuração da NF-e no Bling](https://www.bling.com.br/preferencias.php#notas-fiscais/notas-fiscais-nfe-configuracoes/nfe-preenchimento) · [Séries por natureza](https://ajuda.bling.com.br/hc/pt-br/articles/360036464953-Como-alterar-o-n%C3%BAmero-de-s%C3%A9rie-das-notas-fiscais) · [Próximo número](https://ajuda.bling.com.br/hc/pt-br/articles/360035353334-Como-alterar-o-pr%C3%B3ximo-n%C3%BAmero-da-NF-e)

## Regra fiscal de venda e de devolução

| Operação | Natureza | Parâmetros confirmados ou previstos | Pendências |
| --- | --- | --- | --- |
| Venda MG02 | `15111975260` | Série `003`, modelo 55, saída normal, CRT 1, MG, revenda interna sem ST ou crédito de ICMS, CFOP `5102`, CSOSN `102`, não consumidor final, presença `2`, NCM `64022000`, origem `0`, unidade `PR`, IPI `99`/enquadramento `999`, PIS `49`, COFINS `49`, alíquotas federais zero na regra. | Conferir os grupos tributários no XML emitido pela API e o texto aplicável do Simples Nacional em `infAdic/infCpl`. O texto obrigatório precisa ser comprovado na natureza/nota de série `003`. A mensagem de aproveitamento de crédito ficou desativada no Bling e esta venda não apropria crédito. |
| Venda antiga | `15111725693` | Natureza antiga em série `002`, preservada nos documentos existentes. | Excluída da regra de novas vendas MG02 pelo versionamento prévio, sem alterar notas históricas. |
| Atacado com crédito | Cadastro distinto com CFOP `5102` e CSOSN `101`. | Visível na auditoria anterior. | ID e regra específica sem confirmação nesta sessão. Fora da venda MG02. |
| Devolução própria de atacado | `15111772281` na regra versionada MG02, listada anteriormente como homologação de devolução PF MG. | Série `004`, entrada (`tpNF=0`), finalidade devolução (`finNFe=4`), MG, CFOP `1202`, CSOSN `102`, chave da venda em `NFref/refNFe`. A configuração do Supabase registra teste reportado sem XML nem protocolo retido. | O editor Bling abriu vazio. Verificar se a natureza atende outro fluxo, série real, abas ICMS, IPI, PIS, COFINS, informações complementares e XML autorizado. O registro geral `return_in_state` tem série `003` e CSTs PIS `98`, COFINS `98`, IPI `49`/`999`, sem ID de natureza nessa tabela. Essa regra geral, seus CSTs e a série do varejo não são evidência da natureza específica `004`. |

As migrations `20261126193357_correct_mg02_bling_nature_series_003` e `20261126223525_wholesale_cancel_history_and_current_rule` já constavam como aplicadas no Supabase de produção. A leitura do banco confirmou o vínculo MG02 `15111975260` e o snapshot de devolução `004` separado da regra geral de devolução. Esta sessão não aplicou migrations nem alterou as regras versionadas. [Resolução CGSN nº 140/2018](https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278)

## Retirada e API v3

O emitente permanece em Ribeirão das Neves/MG. A mercadoria sai da Rua Antônio Pedro da Silva, 753, bairro Romeu Duarte, Nova Serrana/MG, CEP `35524-168`. O Bling informa na interface que a preferência global habilita o preenchimento dos grupos F e G quando os campos da nota são informados. A ativação por si só não cadastra a origem por nota ou canal.

A especificação OpenAPI da versão 3 consultada para `POST /nfe` e `PUT /nfe/{idNotaFiscal}` traz `contato.endereco`, `transporte.etiqueta`, `transporte.fretePorConta` e `observacoes`. O schema de gravação não expõe o grupo de retirada e marca `xml` como somente leitura. Etiqueta e observações não preenchem o grupo F. A opção global não foi ativada, pois o efeito no varejo e o preenchimento pela API não foram demonstrados.

**Caminho alternativo.** A Nuvem Fiscal documenta emissão por `POST /nfe` com `infNFe`, ambiente distinto e referência do documento. Validar o grupo de retirada na homologação, com `004` vinculada à chave de `003`, antes de selecionar o novo emissor. Usar uma referência única vinculada à operação e conciliar antes de repetir uma requisição com resultado incerto. Definir um único emissor por série e documento, mantendo o Bling para operações que não migrarem. A `main` não contém o adaptador Nuvem Fiscal. A branch histórica contém o ponteiro `.tmp/nuvem-fiscal-atacado-mg`, que aponta para `b52ec5cc796868b39ef3f40857bc9f60b50c30f5`. Esse commit e sua árvore foram verificados e contêm o fluxo de representantes no Bling, sem os arquivos do adaptador citado. Assim, a implementação alternativa não pôde ser testada nesta sessão.

[Bling API v3](https://developer.bling.com.br/referencia) · [Especificação consultada](https://developer.bling.com.br/build/assets/openapi-Dfpp2fup.json) · [NT 2018.005, local de retirada](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=cMMn5vosZC4%3D) · [Nuvem Fiscal, NF-e](https://dev.nuvemfiscal.com.br/docs/nfe/)

| Etapa | Endpoints e campos oficiais |
| --- | --- |
| Conta, naturezas e produtos | `GET /empresas/me/dados-basicos`, `GET /naturezas-operacoes`, `POST /naturezas-operacoes/{idNaturezaOperacao}/obter-tributacao` e `GET /produtos/{idProduto}`. O endpoint de tributação foi identificado na referência, sem consulta efetiva nesta sessão. |
| Pagamento e pedido | `GET /formas-pagamentos/{idFormaPagamento}`, campos `id`, `tipoPagamento`, `situacao`, `finalidade`, `destino`. `POST /pedidos/vendas` e `GET /pedidos/vendas/{idPedidoVenda}`, com `itens`, `parcelas`, `formaPagamento.id` e referência `numeroLoja`. |
| Geração e preparação | `POST /pedidos/vendas/{idPedidoVenda}/gerar-nfe`, `GET /nfe/{idNotaFiscal}`, `PUT /nfe/{idNotaFiscal}`. O PUT de uma nota vinculada tem restrições. `parcelas[].data`, `valor`, `formaPagamento.id`, `transporte.fretePorConta` e `itens` constam na especificação. |
| Transmissão e leitura | `POST /nfe/{idNotaFiscal}/enviar?enviarEmail=false`, `GET /nfe/{idNotaFiscal}`, `GET /nfe/documento/{chaveAcesso}?formato={formato}`. A autorização efetiva requer situação, chave e protocolo compatíveis no XML processado. |
| Exclusão de rascunho | `DELETE /nfe?idsNotas[]=...`, seguido de `GET /nfe/{idNotaFiscal}`. O pedido vinculado é reconciliado separadamente com `DELETE /pedidos/vendas/{idPedidoVenda}` e nova leitura. |

## Notas investigadas e causas registradas

| Caso | Supabase e logs associados | Evidência ainda necessária |
| --- | --- | --- |
| A · R$ 204,00 · Dinheiro | Erro de cancelamento, reserva ativa, nenhum protocolo local nem registro de envio pela integração. Dois eventos HTTP `400` no estágio `cancel_draft_delete`. Duas tentativas de preparação registraram `invoice_series_mismatch`. | Estado atual no Bling e, se houver chave, consulta de autorização. Verificar vínculo, movimentos e escopo OAuth. |
| B · R$ 204,00 · Pix | Erro de cancelamento, reserva ativa, nenhum protocolo local nem registro de envio pela integração. Três eventos HTTP `400` no estágio `cancel_draft_delete`. A preparação registrou `invoice_series_mismatch`. | Mesma conferência do caso A, sem presumir que os vínculos e lançamentos sejam idênticos. |
| C · R$ 612,00 · Pix | `invoice_items_mismatch`, reserva ativa, nenhum protocolo normal no registro. Há registro fiscal externo separado com protocolo e hash. A chave desse registro coincide com o DANFE anterior da série `002`. Logs do painel mostram divergência de itens e falhas anteriores na persistência da modalidade de frete, todas na preparação. | Conciliar a nota externa autorizada e o ID do rascunho Bling antes de qualquer ação. Obter as linhas do rascunho e do pedido, mais correspondência por ID de produto e variante. |

O `operation_not_permitted` foi comprovado no `DELETE /nfe?idsNotas[]=...` dos casos A e B. O log registrou HTTP `400`, código de validação `0` e o tópico de permissão. A integração nem chegou à etapa de exclusão do pedido nessas ocorrências. A regra interna usada pelo Bling para recusar a exclusão não veio no retorno sanitizado. Não foi possível reler esses documentos no painel Bling, que falhou ao abrir a listagem de notas. A especificação confirma o método e o parâmetro. Sem situação, vínculo e lançamentos atuais, falta evidência para atribuir a recusa a uma permissão OAuth específica, baixa de estoque, conta, série ou situação da nota.

Uma chave de acesso pode existir antes do envio. O caso sem protocolo local ainda pode ter transmissão por outro canal. Para um rascunho presente, a rotina salva a prévia antes de tentar excluí-lo. A confirmação de ausência dos recursos externos precede a liberação transacional do estoque. Chave existente, autorização, resultado desconhecido ou recusa mantêm a reserva. Quando o documento já está ausente, a visualização recorre ao histórico preservado ou ao resumo local. A lista de canceladas já tem Nova nota, olho e lixeira nessa ordem. A lixeira arquiva o histórico e a nova nota usa a regra vigente. [Exclusão de notas no Bling](https://ajuda.bling.com.br/hc/pt-br/articles/360036761374-Excluir-uma-nota-fiscal)

## Catálogo, divergência de itens e pagamento

- Foram auditadas **78 variações ativas** associadas às fichas ativas, distribuídas em 2 produtos, 13 grupos de cor e tamanhos 34 a 39. Todas têm IDs Bling únicos, SKU vinculado exatamente igual, status local de sincronização `synced`, NCM `64022000`, origem `0`, unidade `PR`, um par por SKU e produção `T` no Supabase. CEST vazio em todas e GTIN ausente em todas no snapshot local. As unidades tributáveis, dados vivos do Bling e estoque do depósito dependem da comparação externa. O inventário por variante e os IDs das três notas estão no relatório privado, fora do Git.
- O código aloca o valor da ficha entre os pares em centavos, monta linhas por variante e confere SKU, unidade, quantidade e preço unitário no rascunho. `invoice_items_mismatch` no caso C prova que o rascunho não passou nessa comparação. O XML externo da série `002` tinha códigos curtos por cor/tamanho, conforme documentação anterior do repositório. Como esse XML pertence a outra emissão, ele não comprova qual linha veio diferente no rascunho vinculado. Evitar alias por semelhança de cor/tamanho ou reescrita de SKU sem o ID do produto de origem.
- Pix `11014942` e Dinheiro `11014936` confirmados nos bindings de texto do painel. A loja tem Pix em texto e Dinheiro como secret, cujo valor não foi lido. O menu financeiro do Bling não carregou. O vínculo financeiro `destino`, a situação e o tipo fiscal atuais do cadastro no ERP ficaram sem leitura ao vivo. A integração passou a consultar o cadastro antes de emitir, exigir situação ativa e finalidade de recebimento, e aceitar Pix dinâmico `17` ou estático `20` e Dinheiro `01` conforme a forma da operação.
- A evidência anterior registra o XML manual autorizado em produção, nota `000003` da **série `002`**, com `tPag=90`, `vPag=0`. O nome da natureza contém “Homologacao”, mas a documentação do XML registra `tpAmb=1`. `90` significa sem pagamento e o motivo pelo qual o ERP aplicou esse valor nessa emissão manual permanece em aberto. O código agora verifica as parcelas persistidas antes da transmissão e o meio e valor no XML autorizado, mantendo a cobrança real fora do fluxo fiscal. [Meios de pagamento NF-e](https://ajuda.bling.com.br/hc/pt-br/articles/25114582502423--Atualiza%C3%A7%C3%B5es-da-vers%C3%A3o-Novas-formas-de-pagamento-para-emiss%C3%A3o-de-NF-e-e-NFC-e)

## Implementação, testes e publicação

O commit `a64fbc34554bf0b7d214fe3a00c88e23581ed816` corrige a leitura do cadastro de forma de pagamento, a ausência de parcelas em rascunho de atacado com itens já conferidos e a validação de total, frete e pagamento antes da transmissão. Em atualização exclusiva de metadados, o PUT omite as linhas já vinculadas ao pedido e relê o documento para conferir as linhas e parcelas. A validação de pagamento do XML passa a ser exigida na conciliação do atacado administrativo. O botão de olho continua consultando o documento existente em rota independente da preparação e não autoriza envio.

| Arquivos modificados | Escopo |
| --- | --- |
| `apps/panel/src/lib/wholesale-kit-invoice.ts` e `apps/panel/src/components/wholesale-invoice-manager.tsx` | Validação de pagamento e total no fluxo de atacado, mensagens de erro específicas. |
| `packages/integrations/src/bling-invoice-draft.ts`, `bling-commercial-kit.ts`, `bling-return-xml.ts` | Preparação segura do rascunho e nova validação fiscal de pagamento. |
| `apps/panel/src/lib/wholesale-kit-invoice.test.ts`, `apps/store/src/lib/bling-invoice-draft.test.ts` e `packages/integrations/src/bling-resale-xml.test.ts` | Regressões de pagamento, total antes do envio e preservação dos itens vinculados. |

Testes locais passaram em 337 casos do pacote de integrações, 83 do painel fiscal, 81 de rascunho e jobs da loja, 42 de escopo/automação/observação da loja e 9 verificações estáticas das migrations de atacado. Typecheck de integrações, painel e loja, lint dos arquivos alterados e checagem de exposição do código também passaram. O Chromium do Playwright não foi obtido localmente por HTTP `403` e a instalação local de Chromium estava sem binário. A validação dinâmica de banco e E2E usa o CI publicado.

O [GitHub Actions 45913316345](https://github.com/curtiZ-Sistemas/curtiZ-ecommerce/actions/runs/45913316345) concluiu com sucesso para `a64fbc34554bf0b7d214fe3a00c88e23581ed816`. Passaram qualidade, banco e migrations, segurança, E2E de painel e loja em desktop/mobile/responsivo e publicação dos dois Workers. O Cloudflare confirmou o mesmo `GIT_COMMIT_SHA`, `BUILD_ID=45913316345-1` e 100% do tráfego nas versões abaixo.

| Worker | Versão ativa no Cloudflare | Horário de São Paulo em 26/11/2026 |
| --- | --- | --- |
| `curtiz-painel` | `52d6c37c-0a3f-4329-a525-23607ee74dfe` | 20h56min19s |
| `curtiz-ecommerce` | `b78e7cac-35c3-4d40-9c5d-0cb38baa5df6` | 20h55min44s |

Nos dois Workers, `APP_ENV` e `BLING_INVOICE_TRANSMISSION_MODE` permanecem `production`. Foram conferidos `BLING_ORDER_SYNC_ENABLED`, `BLING_INVOICE_SYNC_ENABLED`, `BLING_INVOICE_SEND_ENABLED`, `BLING_LIVE_INVOICE_SEND_AUTHORIZED` e `BLING_INVOICE_STOCK_AUTOMATION_DISABLED` como `true`. A ação de transmissão continua vinculada à confirmação explícita e ao hash da nota revisada. O relatório versionado é um commit posterior apenas de documentação. O SHA acima identifica o código efetivamente publicado.

## Continuação da validação fiscal

1. Com acesso ao Bling, coletar situação da NF-e e do pedido de cada caso e conferir chave, protocolo, vínculo, lançamentos e escopos. Recuperar a prévia registrada antes de eventual exclusão. Aprovação específica continua necessária quando houver documento real ou ação fiscal irreversível.
2. Confirmar os dois cadastros financeiros e as regras de automação do pedido e da nota. Conferir 78 variações e saldos pelo ID, incluindo GTIN e unidade tributável. Comparar as linhas exatas do caso C com o pedido e o espelho, sem reemitir o documento externo.
3. Validar em conta ou emissor isolado duas operações, venda MG02 `003` e devolução própria `004` com referência à venda. Arquivar XML processado e DANFE fora do Git, conferir `tpAmb=2`, chave/protocolo, grupo `<retirada>`, `modFrete`, tributação, `infCpl`, pagamento e totais. A ausência de uma homologação ativa no Supabase e de uma configuração Bling isolada impediu esse teste nesta execução.

[Exportação oficial de XML](https://ajuda.bling.com.br/hc/pt-br/articles/360035753933-Como-exportar-o-XML-das-notas) · [Documentação fiscal do projeto](./bling.md) · [Conciliação anterior da NF-e série 002](./atacado-reconciliacao-nfe-2026-11-25.md)

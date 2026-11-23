# Entrega própria dos kits de atacado em Minas Gerais

Plano operacional de 19/11/2026, atualizado após a resposta final da contabilidade. A execução técnica prepara o atacado e a ativação em produção depende de aprovação final.

## 1. Compra no portal do representante

- Usar **Entrega pela curti Z** nas compras de kits de atacado em MG, tanto para Pix antecipado quanto para pagamento no recebimento. Manter o Melhor Envio no varejo nacional e preservar o histórico dos pedidos.
- Reaproveitar o cadastro de rotas próprias com entrega sem cobrança. A equipe informa CEP de saída, cobertura em MG, prazo e vigência. A cobertura, o preço da ficha, o estoque e o total são validados no servidor. Se não houver uma rota aplicável, ou se duas rotas conflitarem, o portal informa a indisponibilidade para aquele CEP.
- Mostrar ficha, quantidade, endereço, taxa, prazo e total antes de confirmar a compra. Mostrar no pedido os estados da entrega, do pagamento e de eventual devolução. A cotação confirmada registra a rota e a taxa usadas no pedido. A reserva de estoque continua atômica e idempotente.
- Desvincular a prontidão comercial dos kits de cotação, compra de etiqueta, rastreio e autorizações do Melhor Envio. Separar a rota de entrega da forma de pagamento no banco, pois hoje o vínculo da rota é específico do pagamento no recebimento. Preservar as travas fiscais e as integrações de pagamento.
- No Pix antecipado, a loja cruza pedido, recebedor e valor antes de confirmar o pagamento. No recebimento, manter dinheiro, Pix, débito e crédito à vista. Habilitar meios eletrônicos no recebimento conforme a disponibilidade real de terminal e configuração do Mercado Pago. O dinheiro usa registro de recebimento e troco, calculado sobre o total confirmado.

**Áreas previstas**  
`apps/store/src/components/representative-kit-delivery.tsx` para a experiência de compra. APIs de cotação, recebimento e pedidos em `apps/store/src/app/api/representatives/kits`. `apps/store/src/lib/representative-commercial-payments.ts` para a prontidão de pagamento e `representative-commercial-fulfillment.ts` para separar a expedição própria. Migration incremental no Supabase para a rota da cotação e do pedido, mantendo o isolamento por canal.

## 2. Entrega e pagamento no painel interno

- Dar prioridade à fila operacional **Entregas de kits MG**, com pedidos prontos para sair, em entrega, entregues e tentativas sem sucesso. Mostrar endereço e instruções somente a pessoas autorizadas. A equipe registra saída, entrega ou falha, com usuário, horário e evidência operacional.
- Em pedidos com pagamento no local, disponibilizar **Confirmar entrega** e **Confirmar pagamento**, com ambos os estados visíveis. O pedido só fica concluído quando as duas confirmações estiverem registradas. Em Pix antecipado, o painel mostra a confirmação do Mercado Pago e permite à equipe confirmar a entrega.
- Para dinheiro, o operador confirma o recebimento e registra a evidência e o troco. Para Pix, débito e crédito no Point, a ação consulta a transação e registra a confirmação somente quando o Mercado Pago valida o recebedor, o valor e o pedido. Se a consulta falhar, o pagamento fica pendente para conciliação. Repetir a ação não cria outra cobrança.
- Quando uma tentativa falhar, registrar o ocorrido, reprogramar ou registrar o retorno do kit à curti Z. A baixa e a liberação de estoque seguem o estado efetivo do pedido e a conferência física.

**Áreas previstas**  
`apps/panel/src/components/representative-kit-operations.tsx` e a API `/api/operations/representative-kits`. Reaproveitar a fila de recebimento, as permissões e a autenticação interna já existentes. Registrar as transições no servidor com auditoria.

## 3. Solicitação de devolução e estorno

1. No próprio pedido, o representante solicita a devolução informando itens, quantidade, motivo e dados para a retirada. O portal exibe o protocolo e permite acompanhar a análise.
2. A curti Z aprova ou recusa com registro da decisão. Se aprovar, a equipe agenda a retirada própria, registra a coleta e confere os itens quando retornarem. O estoque só é ajustado após a conferência e conforme as regras fiscal e financeira do pedido.
3. Se o pagamento foi feito pelo Mercado Pago, apresentar **Estornar no Mercado Pago** quando a retirada, a conferência e as condições fiscais aplicáveis estiverem registradas. Mostrar pedido, valor, forma de pagamento e motivo antes de liberar a ação.
4. **Proposta de confirmação dupla** — uma pessoa autorizada prepara o estorno e outra pessoa autorizada revisa e confirma. O servidor registra ambos os responsáveis e o valor autorizado. Uma nova tentativa usa a mesma referência e consulta o provedor antes de repetir qualquer envio. O painel mantém **Estorno em processamento** até a confirmação do Mercado Pago.
5. Para pagamento em dinheiro, mostrar o registro financeiro correspondente e a evidência necessária no painel interno. A ação do Mercado Pago aparece somente em pedidos pagos pelo provedor.

**Áreas previstas**  
Reaproveitar a solicitação de devolução da API de pedidos de kits, a fila interna em `representative-kit-operations.tsx` e as rotinas de estorno e conciliação em `representative-commercial-payments.ts` e `representative-commercial-jobs.ts`. Acrescentar em migration os registros de retirada, conferência e dupla confirmação necessários.

## 4. Verificação e publicação

- Testar CEP fora de MG, CEP sem rota e rotas conflitantes. Testar alteração de taxa entre cotação e reserva, concorrência de estoque e repetição de confirmações. Confirmar que Pix antecipado e recebimento funcionam com a rota própria e que o varejo mantém o Melhor Envio.
- Testar entrega bem-sucedida, tentativa sem entrega, dinheiro com troco, Point pendente, confirmação fora de ordem e usuário sem permissão. Validar uma conciliação segura com a conta Mercado Pago configurada e o comportamento do terminal aplicável.
- Testar solicitação de devolução do próprio pedido, recusa, retirada, inspeção, segunda confirmação independente, repetição do estorno, resposta incerta do provedor e reposição única no estoque. Fazer testes de integração em ambiente isolado, sem cobrança, estorno ou emissão fiscal produtiva.
- A validação para publicação usará testes automatizados, ambiente de teste dos provedores quando aplicável, consulta de configurações em produção e conferência dos fluxos sem movimentação financeira. Para o Bling, solicitar à contabilidade a aprovação dos cenários e, quando disponível, o XML com protocolo de venda e devolução em homologação. O relatório de publicação registra separadamente a evidência obtida para cada cenário.
- Após aprovação e implementação, aplicar as migrations incrementais, acompanhar o CI e verificar o commit servido pela loja e pelo painel em produção. Registrar as evidências e o estado de cada opção no documento de continuidade.
- A implantação permite cadastrar kits, configurar rotas e preparar a operação em produção. A liberação comercial por cenário fica condicionada à comprovação fiscal no Bling, inclusive a emissão e, quando aplicável, o documento de devolução. Só registrar **pendente apenas Bling** depois de verificar rotas, conta recebedora, conciliação, meios autorizados no recebimento, entrega própria e estorno.

## 5. Decisões e dados para executar após aprovação

- Aprovar a confirmação dupla de estorno por duas pessoas autorizadas.
- A equipe da curti Z informa no cadastro a cobertura inicial em MG, o prazo e os meios de recebimento. A taxa inicial é zero. Para meios presenciais eletrônicos, a equipe identifica o terminal Point a ser verificado. Os donos continuam responsáveis pelos kits e pelos preços de cada ficha.
- O responsável fiscal informa as pendências específicas do Bling e fornece a evidência de homologação do cenário que será liberado. A proposta mantém essas validações por operação.
- A solicitação fiscal está pronta para encaminhamento. [Mensagem para a contabilidade](2026-11-19-mensagem-contabilidade-kits-mg.md)

## 6. Decisões fiscais recebidas em 19/11/2026

- Venda do atacado apenas a PJ em Minas Gerais com IE ativa e enquadramento comprovado. Simples e MEI elegíveis seguem o cenário sem crédito, após validação do comprador. Regime normal pode usar `101` quando elegível e `102` nas demais operações aplicáveis. Para as vendas confirmadas dos produtos atuais, usar `5102` sem ST. Qualquer produto ou operação fora da cobertura confirmada exige revisão específica.
- Registrar o crédito de `1,36%` somente para novembro/2026, com a referência contábil de outubro e aprovação da competência. As competências seguintes exigem seus próprios valores e comprovações. O cronograma do Simples para IBS/CBS precisa ser reavaliado antes de operar em 2027. [Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026)
- Venda na série `003` e entrada própria do atacado na `004`. No Bling, a `003` está com próximo número `3`; a `004` não apareceu no controle e sua sequência depende da consulta ao histórico. Manter as naturezas do varejo. Os kits usam os SKUs reais das fichas por modelo, cor e numeração, com valores fechados em centavos.
- Autorizar a NF-e antes da saída. Em entrega própria gratuita, conferir `modFrete=3` e `vFrete=0`, retirada em Nova Serrana e local de entrega distinto quando aplicável. Homologar Pix antecipado e pagamento no recebimento com o documento fiscal correspondente e com confirmação de entrega separada do pagamento. [MOC NF-e](https://moc.sped.fazenda.pr.gov.br/NFe_NFCe/DanfeCodigoBarras.html)
- Para devolução de mercadoria recebida, verificar a competência do comprador para emitir a saída `5202` e, quando a emissão própria for aplicável, validar a entrada `1202` na série `004`. O cenário exige a chave original, XML autorizado, conferência física e conciliação financeira. A resposta contábil deixou ambígua a escolha do emissor. Em recusa após circulação com retorno integral, separar o retorno do cancelamento e vincular a nota da entrada à saída. Retorno parcial, reentrega e emissão simbólica para novo destinatário dependem de validação própria. [RICMS/MG, art. 50](https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/regulamento2023_1.html) · [RICMS/MG, Anexo V](https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexov2023_2.html)
- Para as rotas intermunicipais, confirmar o MDF-e por viagem, inclusive para carga própria com uma única NF-e, e a eventual exceção do art. 113. O XML da NF-e, por si só, não comprova a autorização do manifesto. A rota intermunicipal precisa dessa validação antes da liberação. [RICMS/MG, Anexo V, arts. 112–113](https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexov2023_3.html)

## 7. Cadastros fiscais a homologar no Bling

| Operação | Natureza dedicada | Requisito para vincular ao canal |
| --- | --- | --- |
| Revenda confirmada sem crédito | Saída `003`, `5102/102`, Simples Nacional, não consumidor final, operação interna | Homologar PJ com IE ativa e evidência do regime. Confirmar a cobertura de MEI com IE ativa. Conferir itens por SKU, tributos federais vigentes, transporte próprio e endereços no XML. |
| Revenda elegível a crédito | Saída `003`, `5102/101`, Simples Nacional, não consumidor final, operação interna | Mesmas conferências da saída `102`, com destinatário e operação elegíveis, crédito por competência e valores do item no XML. |
| Devolução do comprador | Entrada no Bling via documento de saída do comprador, `5202` quando aplicável | Conferir emissor, autorização e vínculo à saída original. A numeração e a série são do comprador. |
| Entrada própria do atacado | Entrada `004`, `1202` quando aplicável | Confirmar o emissor para a devolução após recebimento, tributação, escrituração, numeração da `004` e protocolo de autorização em homologação. Tratar o retorno sem entrega como cenário fiscal próprio. |

As consultas desta etapa foram feitas no Bling produtivo. A existência de naturezas de homologação com série `002` e devolução PF com série `003` serve de referência histórica. A venda existente na `003` e o próximo número exibido ficam preservados. A primeira numeração da `004` requer evidência no Bling e na SEFAZ. As naturezas dedicadas ficam pendentes de configuração e conferência em ambiente autorizado, com vínculo pelo ID validado.

## 8. Resultado da execução local

- A cópia isolada contém os ajustes de série, frete zero e transporte próprio, a validação da devolução e o registro de recusa sem iniciar cancelamento fiscal depois da circulação. As mudanças do Supabase estão na migration `20261120000432_representative_kit_accounting_rules.sql`. A conferência financeira, a confirmação de entrega, o rateio e o estoque continuam usando a estrutura existente.
- Foram executados 138 testes locais de rascunho, XML, tributação, cotação e pedidos. O TypeScript da loja e do painel e o lint dos arquivos alterados passaram. O teste de banco para recusa e retenção de estoque foi acrescentado para a próxima execução com PostgreSQL de teste. A migration ainda precisa ser verificada em um banco isolado.
- O Bling produtivo e o Supabase foram consultados em leitura. Antes da liberação, faltam homologar as naturezas e o XML autorizado de venda e devolução, comprovar a numeração da `004`, a saída física e o tratamento fiscal da recusa, e conferir a faixa de outubro para vendas com crédito. Falta validar a cobertura e os prazos da rota, seu MDF-e quando aplicável e a correspondência das formas de pagamento com o terminal Point. A devolução parcial de unidades inteiras de kit tem validação local. A devolução de pares avulsos dentro de uma ficha e a baixa após retorno por recusa precisam de fluxo fiscal próprio validado.

## 9. Trava de MDF-e e regressões do atacado

- A migration `20261120001812_representative_kit_mdfe_dispatch.sql` verifica a obrigação na função de saída dos kits. A única dispensa automática usa o endereço confirmado do pedido e os CEPs publicados para Nova Serrana, incluindo o distrito de Boa Vista de Minas. Se a origem e o destino não puderem ser classificados nessa localidade, a operação exige comprovação. [Faixas de CEP publicadas pela Prefeitura](https://www.novaserrana.mg.gov.br/portal/noticias/0/3/3120/novos-ceps-ja-estao-valendo-em-nova-serrana/novaserrana.mg.gov.br)
- O operador autorizado confere o MDF-e na SEFAZ, confirma que a NF-e do pedido, a rota e o veículo estão no manifesto e registra chave, protocolo e referência no painel de entregas. O banco valida o dígito da chave e o emitente e vincula a conferência à NF-e daquele pedido. O registro é usado uma vez por pedido. Uma nova tentativa de saída após entrega frustrada exige nova comprovação. A consulta completa dos dados do manifesto exige certificado relacionado ao documento. [Consulta oficial do MDF-e](https://dfe-portal.svrs.rs.gov.br/MDFE/Noticias/2728)
- A regressão da API verifica que a taxa de um centavo é rejeitada antes da chamada ao banco e que a rota gratuita segue para cadastro. Os cenários fiscais isolam MEI com IE ativa, PJ do Simples e PJ do regime normal com ou sem crédito. A ativação continua condicionada à homologação e à aprovação final.

## 10. Cadastros e decisões posteriores em 19/11/2026

- Bling: cadastradas e conferidas as naturezas dedicadas `15111975260` (`5102/102`) e `15111975282` (`5102/101`, crédito `1,36%` de novembro). Ambas usam série `003`, operação interna MG e tratamento fiscal copiado da referência de revenda. As naturezas existentes e os padrões do varejo foram preservados.
- Crédito: o proprietário confirmou em 19/11 que a faixa de outubro e a taxa aplicável de `1,36%` foram comprovadas e autorizadas para novembro de 2026. No Bling, a taxa foi gravada na regra da natureza dedicada do mês. Usar somente com elegibilidade aprovada e competência `2026-11`, com encerramento em 30/11. Nenhuma aprovação de comprador ou ordem fiscal produtiva foi criada.
- Pagamento: o proprietário retirou a maquininha do escopo. Rotas novas admitem Pix antecipado e, se comprovado no cadastro da rota, dinheiro no recebimento, com taxa de entrega zero. O cadastro usa a forma Dinheiro `11014936` como referência verificada no Bling. Débito, crédito e Pix pelo terminal ficam fora das novas rotas. A conta empresarial do Mercado Pago não mostrou Point vinculado. Nenhuma rota real foi criada: cobertura e prazo ainda não constam das fontes consultadas.
- Endereço de entrega: o proprietário definiu que o representante informa somente o endereço para a entrega. O cadastro de faixas de cobertura e de prazos fica fora desta etapa. A checagem fiscal de MG e a conferência do MDF-e antes da saída continuam aplicáveis. A configuração existente de rotas foi preservada, sem cadastro de faixas ou prazos fictícios.
- Retorno integral sem entrega: a migration local registra inspeção e documento de entrada `004` para a regra específica `undelivered_return`. O fluxo valida o XML autorizado e a referência à NF-e inicial, impede nova saída após a inspeção e, no cenário sem pagamento e com todos os kits aptos à revenda, libera a reserva uma vez. No pedido já pago, utiliza o fluxo de conciliação antes da reposição. O retorno sem entrega tem regra fiscal distinta da devolução após recebimento. [RICMS/MG, art. 50](https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/regulamento2023_1.html)
- A série `004` continua sem contador no Bling. A ausência no controle não comprova a sequência disponível. A natureza de entrada, a aprovação de seus parâmetros por cenário e os XMLs com protocolo em homologação seguem pendentes. A devolução de unidades inteiras de kit usa o fluxo existente. A devolução de pares avulsos ainda precisa da seleção de SKU e quantidade, validação fiscal por item e reposição individual com controle de saldo e estorno.

## 11. Execução e situação em 20/11/2026

- O checkout por endereço em MG foi implementado no PR #154 com entrega própria gratuita, Pix antecipado e dinheiro no recebimento. A autorização atual dispensa rota pré-cadastrada, tabela de cobertura, prazo regional e integração de maquininha. A devolução parcial registra os pares por SKU, confere o valor no XML por item e controla a reposição.
- A homologação remota recebeu as migrações faltantes e passou em 145 asserções PostgreSQL com rollback. Sete migrações do atacado chegaram a produção após backup lógico verificado. A situação de publicação e reversão está registrada na [continuidade](../CONTINUIDADE-REVENDA-MG-2026-11-18.md).
- A venda usa as naturezas dedicadas da série 003 e os valores fiscais registrados na seção 10. A série 004 de devolução foi confirmada pelo proprietário. Os cenários comerciais permanecem bloqueados até protocolo fiscal real e comprovação de origem e guarda para os SKUs de Nova Serrana.

- O deploy de produção da loja e do painel foi concluído pelo CI oficial #772. Os dois domínios foram conferidos com a nova versão ativa e o checkout comercial permanece bloqueado pelas pendências fiscais.

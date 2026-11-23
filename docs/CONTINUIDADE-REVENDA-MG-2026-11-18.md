# Continuidade da compra de kits para revenda em MG

Iniciado em 18/11/2026 e atualizado em 19/11/2026 para a continuidade a pedido do proprietário.

## Objetivo e situação atual

Concluir a compra de kits no painel de representantes, exclusivamente em Minas Gerais, com pedido, pagamento, estoque, NF-e, expedição e devolução integrados. A venda varejista nacional continua com o escopo existente.

**A implementação técnica está publicada na loja e no painel.** O PR #136 foi mesclado e as 26 migrations foram aplicadas. A compra comercial de kits continua fechada até o cadastro real e a comprovação fiscal e operacional. A seção 14 registra as evidências do deploy e as pendências atuais.

O proprietário solicitou deixar os documentos para depois e executar primeiro todo o trabalho técnico possível. Já autorizou instalar dependências exatas do lockfile na cópia isolada, commit, branch remota, CI, publicação e etapas necessárias dentro do escopo. Sua aprovação geral está registrada. Cobranças reais e emissão fiscal produtiva devem respeitar as limitações abaixo.

## 1. Onde está o trabalho

- Repositório remoto — curtiZ-Sistemas/curtiZ-ecommerce.
- PR — https://github.com/curtiZ-Sistemas/curtiZ-ecommerce/pull/136
- Branch do PR — codex/revenda-regras-fiscais-20261117.
- Head confirmado em 19/11 — `db6955fa73a3babf3bb6be3a957e19e5000d2f31`.
- CI #761 — concluído com sucesso nos 12 jobs para esse head.
- Execução — https://github.com/curtiZ-Sistemas/curtiZ-ecommerce/actions/runs/44550930741
- Merge na `main` e versão produtiva — `aaa625f06015d28dcfd890610b477627d5ea20ca`.
- Deploy CI #762 — https://github.com/curtiZ-Sistemas/curtiZ-ecommerce/actions/runs/44552877568
- Raiz local — C:\Users\fabri\Desktop\Rafael DEV\curtiZ
- Cópia isolada atual — `C:\Users\fabri\Desktop\Rafael DEV\curtiZ\.tmp\revenda-mg-pr136`.
- Cópia anterior preservada — `C:\Users\fabri\Desktop\Rafael DEV\curtiZ\.tmp\representative-release-worktree`.

### Atenção ao Git local

A cópia anterior estava na branch `fix/representative-production-readiness-20261110`, HEAD `5078686258e36b27a0a6964270baf53a15d33795`, com várias alterações e arquivos novos. A raiz tem outras alterações preexistentes do usuário. Na cópia isolada atual, o commit `7d53ac6` tem a mesma árvore `8a66ff41581422deff4998de1e4ae13e111c10b3` do head do PR. O PR foi atualizado via API GitHub com verificação do SHA anterior. Preserve os três diretórios.

Revalide o PR e o status local antes de editar. Prepare uma cópia baseada na branch remota para continuar se necessário. Evite reset, limpeza, descarte ou commit global. Use o GitHub como referência do que já está publicado na branch do PR. Alguns relatórios locais podem estar atrás da versão remota.

## 2. Material recebido e documentos criados

Pacote fornecido pelo usuário — C:\Users\fabri\Downloads\PACOTE_CURTIZ_MG_LIBERACAO_FINAL_NOV2026.zip

Contém README_INICIO.md, PROMPT_CODEX_LIBERACAO_FINAL.md, DOSSIER_FISCAL_MG_2026_11.md, POLITICA_LIBERACAO.json, matriz CSV/XLSX, FONTES_VERIFICADAS.md e TESTES_ACEITE_PRODUCAO.md. Leia o pacote para os critérios completos. Ele informa aprovação empresarial MG e crédito de novembro, mas também exige comprovar modalidade, ST, origem e XML autorizado para ativar cada rota.

Minutas Word criadas na raiz local, fora da cópia isolada, sem assinatura ou dados empresariais inventados.

- docs/minuta-contrato-revenda-kits-mg.docx
- docs/minuta-termo-guarda-estoque-nova-serrana.docx

O contrato foi redigido para compra e revenda em nome próprio, com anexo para descrever intermediação, rede e comissões caso existam na prática. A classificação real precisa ser confirmada. O termo identifica guarda própria, terceiro ou retirada no fornecedor, e os comprovantes correspondentes. Os arquivos foram conferidos como pacotes DOCX com XML válido e referências oficiais.

Relatórios na branch do PR.

- docs/revenda-mg-relatorio-final.md
- docs/representative-resale.md
- docs/kits-revenda/MATRIZ_FISCAL_PENDENTE.md

O relatório MG contém dados históricos e pendências. Atualize-o à medida que concluir etapas.

## 3. Seis etapas ainda pendentes

### 1 — Documentos e fatos operacionais

Preencher e assinar as minutas com dados reais e anexar provas de titularidade/guarda, aquisição, remessa ou retirada do estoque em Nova Serrana. O proprietário fará depois. As minutas não comprovam por si sós a operação.

### 2 — Enquadramento e parametrização fiscal

Confirmar a modalidade praticada e aplicar a matriz do pacote por perfil e SKU.

- MG01, PJ regime normal com IE ativa — candidato com crédito somente quando elegível.
- MG02, PJ Simples com IE ativa — candidato sem crédito.
- MG03, MEI com IE ativa — condicionado ao cadastro e modalidade, inclusive análise de ST.
- MG04, PF com IE — exceção dependente de prova.
- MG05–MG07, PF/MEI sem IE e PJ não contribuinte — bloqueados no escopo inicial.
- MG08, PJ dispensada — exceção dependente de fundamento e XML válido.

Compra, estabelecimento fiscal do comprador, entrega e origem efetiva precisam respeitar MG. A declaração do cliente no portal continua informativa e não valida IE, regime ou direito a crédito.

O pacote aceita como configuração empresarial crédito de 1,36% para novembro de 2026, referência de outubro, com expiração em 01/12. Aplicação somente nos itens/perfis legalmente elegíveis a 101/201. Falta implementar/registrar a configuração correspondente com evidência e testar a virada da competência.

CFOP 5102/CSOSN 101 ou 102 é candidato para mercadoria de terceiros em operação comprovadamente sem ST. Produção própria pode exigir 5101. Porta a porta ou modalidade equivalente exige avaliar RICMS/MG Anexo VII arts. 82–85 e capítulo 28, com natureza ST e cálculos pertinentes. Evite classificar toda a operação por um rótulo contratual. Não aplicar indIEDest=9 com indFinal=0 como atalho.

### 3 — Pedido e estoque

O catálogo seleciona endereço e serviço e o servidor emite cotação privada vinculada ao ator, endereço, variante, quantidade, fingerprint e validade. Falta criar o pedido comercial e consumir essa cotação na mesma transação que reserva o SKU.

A função privada de consumo está preparada e revalida perfil/representante, variante/produto, metadados de kit, endereço MG, versão do endereço, estoque disponível, validade e uso único. Ela bloqueia linhas relevantes durante a transação. Ainda não existe o chamador comercial que cria o pedido e faz a reserva. Levar em conta que o fingerprint de transporte é calculado no servidor e deve continuar sendo derivado de dados atuais. Falhas devem reverter consumo e reserva. Repetições do mesmo pedido precisam retornar o resultado anterior.

O fluxo existente de transações TEST já implementa reserva, baixa, cancelamento e reembolso em agregado separado, com leases e idempotência. Reaproveite seus conceitos preservando o isolamento entre teste e produção.

### 4 — Pagamento real

O código de kits continua restrito a credenciais de teste. Implementar a orquestração comercial com preflight fiscal antes de criar/capturar pagamento, webhook autenticado, referência própria e validação de valor/moeda/ambiente/identidade.

Cobrir criação incerta, replay, concorrência, expiração, aprovação durante cancelamento e reembolso parcial/total. Não remover apenas as condições de modo TEST. O provider compartilhado recusa kit_orders em produção e o webhook/ledger atual tratam referências KITTEST.

### 5 — NF-e, expedição e devolução

Ligar os pedidos comerciais à integração Bling e à logística. Reutilizar expansão fiscal por pares, rateio em centavos, validação do XML e protocolo, filas e idempotência existentes. Exigir documento autorizado correspondente ao pedido pago antes do despacho.

Série 002 para vendas e 003 para devolução própria, com próximo número real conferido no Bling/SEFAZ. Dados de 03/11 não comprovam o número disponível hoje. Conferir emitente da sede e saída física de Nova Serrana, local de retirada e documento da guarda/remessa quando exigidos.

Validar XML e protocolo em homologação para o cenário de revenda efetivamente habilitado. A homologação encontrada em outubro era de B2C, inclusive kits desmembrados. A integração comercial de revenda exige sua própria prova.

Devolução PJ emitida pelo adquirente e eventual NF-e própria de entrada precisam seguir o cenário aprovado, com referência original, itens e saldos corretos. Conciliar estoque, pagamento e logística. Evitar transpor os códigos e alíquotas da devolução PF B2C.

### 6 — Publicação

Revisar o diff completo do PR e validar schema, aplicação e operação integrada. Aplicar migrations incrementais, publicar e verificar a versão implantada e o fluxo autenticado. Habilitar apenas os perfis efetivamente validados. Manter recuperação de pedidos e reembolsos disponível no rollback.

Em 18/11 o Supabase produtivo ainda não tinha as tabelas novas de regras versionadas e cotação privada desta branch. Essa consulta é histórica, revalide antes de aplicar. O PR não foi mergeado nesta execução. O green check do CI não equivale a deploy.

## 4. Implementações presentes no PR

- Catálogo de kits reaproveita products, product_variants, inventory e composições cadastradas.
- Prévia fiscal recebe declaredScenario com dados informativos e rejeita destinos fora de MG.
- Interface mostra entrega exclusiva em MG.
- Simulação de frete usa embalagem e preços do catálogo atual.
- Seleção de endereço salvo filtra MG e confirma o serviço com o servidor.
- Mudança de quantidade invalida o resultado exibido.
- Cotação de checkout fica em tabela privada, vinculada ao representante e ao endereço salvo, com prazo máximo de 30 minutos.
- Consumo privado e único da cotação confere novamente elegibilidade e estoque.
- Tabelas e funções de regras fiscais versionadas, com aprovação e revogação separadas, histórico protegido e lookup sem ambiguidade.
- Fingerprint fiscal derivado da composição.
- Declaração de destinatário ligada à transação TEST e marcada como não verificada.
- Cancelamentos e jobs de teste validam se a resposta do provider pertence à transação original.
- Configuração de CI desativa o cache de desenvolvimento Turbopack apenas quando CI e DEMO_MODE são true para evitar falha no reinício de servidor de E2E.

## 5. Arquivos técnicos para retomar

Na branch remota do PR.

- apps/store/src/app/api/representatives/route.ts — buy_kit ainda retorna 409/RESALE_NOT_HOMOLOGATED.
- apps/store/src/app/api/representatives/kits/catalog/route.ts
- apps/store/src/app/api/representatives/kits/preview/route.ts e route.test.ts
- apps/store/src/app/api/representatives/kits/quote/route.ts e route.test.ts
- apps/store/src/app/api/representatives/kits/transactions/route.ts e route.test.ts
- apps/store/src/components/representative-kit-catalog.tsx
- apps/store/src/components/representative-kit-delivery.tsx
- apps/store/src/components/product-shipping-preview.tsx
- apps/store/src/lib/representative-resale.ts e representative-resale-scope.ts
- apps/store/src/lib/representative-test-transactions.ts e representative-test-jobs.ts, com testes.
- packages/integrations/src/index.ts — provider compartilhado e recusa de kit_orders produtivo.
- packages/integrations/src/bling-fiscal-preview.ts e testes fiscais de revenda/crédito/retorno.
- apps/store/src/lib/melhor-envio-server.ts — resolveShippingProducts e provider.

Migrations preparadas.

- 20261117110000_representative_resale_fiscal_rules.sql
- 20261117200100_representative_test_recipient_declaration.sql
- 20261118110000_representative_kit_shipping_checkout_quotes.sql
- 20261118114500_restrict_representative_kits_to_mg.sql
- 20261118143000_recheck_kit_quote_consumption.sql

Testes SQL relevantes.

- supabase/tests/representative_kit_shipping_checkout_quotes_test.sql
- supabase/tests/representative_resale_fiscal_rules_test.sql
- supabase/tests/representative_test_transactions_test.sql

## 6. Evidência já conferida

Consulta de produção em 18/11, somente leitura.

- 162 variantes de kits ativas com estoque e composição fiscal completa.
- 114 variantes de dois pares, em três produtos.
- 48 variantes de três pares, em dois produtos.
- Todos os componentes consultados têm NCM cadastrado 64022000.
- Hashes fiscais correspondem às composições atuais em todas as 162 variantes.
- Unidade comercial UN, production_type T e fiscal_unit_approved true no cadastro das 162 variantes.
- Zero registros de contrato em representative_contracts.
- Zero taxas de crédito da competência novembro na tabela privada de aprovação.

Esses resultados comprovam o estado cadastral consultado. A documentação do lote e a modalidade real continuam necessárias para determinar o enquadramento.

Naturezas consultadas anteriormente no Bling, de homologação.

| Cadastro | CFOP | ID |
| --- | --- | --- |
| MG não consumidor final | 5102 | 15111725693 |
| Interestadual contribuinte não consumidor | 6102 | 15111725714 |
| Não contribuinte não consumidor | 6108 | 15111725713 |
| Devolução PF MG | 1202 | 15111772281 |
| Devolução PF interestadual | 2202 | 15111772282 |

Os IDs são referências existentes. A ativação exige conferir a natureza apropriada ao perfil e à modalidade. O escopo atual exclui destinos interestaduais para kits.

## 7. Testes e CI

CI #743 do head 26f744113676d4efaf6a278a0e69bb12472bed93 confirmado como completed/success ao gerar este handoff. Inclui qualidade, banco/migrations, E2E desktop/mobile/responsivo/painel, segurança e builds OpenNext da loja e painel. Nos logs, representative_kit_shipping_checkout_quotes_test.sql passou e o PostgreSQL concluiu com Result PASS.

Também passaram em execuções anteriores locais.

- 86 testes focados de prévia, cotação, transações e composição no workspace store.
- 97 testes de integração fiscal em sete arquivos.
- 29 testes de frete após a seleção de endereço.
- Lint e typecheck da loja.

Esses testes verificam implementação e isolamento. Pagamento comercial, NF-e de revenda e despacho integrado continuam sem validação real completa.

## 8. Ferramentas, ambiente e limites

- Windows/PowerShell, 4 GB RAM. Executar builds e testes pesados um por vez.
- Node 24.19.0 e pnpm 10.14.0. Usar pnpm.cmd, porque pnpm.ps1 foi bloqueado pela política do PowerShell.
- Docker indisponível, o usuário não quer instalar. O CI do GitHub executou banco e migrations.
- Graphify fica na raiz principal, fora da cópia isolada. Usar GRAPHIFY_BACKEND=none antes de consultar e executar as consultas na raiz. Consultar AGENTS.md e skills aplicáveis.
- Nenhum subagente foi autorizado.
- Não ler ou publicar secrets, cookies, certificados, XMLs com documentos pessoais ou arquivos de ambiente.
- Supabase conectado Curti Z, projeto produtivo jfnkxdzusqymsvzckerl. Cópia de homologação existente cfendaazxctjmzpimadn. Confirmar o ambiente e seu estado antes de qualquer teste com escrita.
- GitHub conectado como curtiZ-Sistemas. Cloudflare e Supabase possuem plugins.
- As ferramentas Playwright voltaram a ficar disponíveis em 19/11. O proprietário autenticou-se diretamente para a conferência somente leitura no Bling. Se a sessão expirar, peça ao proprietário para fazer login no navegador.

O usuário pediu durante a conversa que testes não gerassem gastos nem notas fiscais produtivas. Depois autorizou nota de teste, mas a última orientação da meta anterior dispensava testes no Bling. O pacote MG mais recente exige XML autorizado em homologação para liberar cenário. Faça testes isolados e sem cobrança real. Se for indispensável nova emissão, use homologação, revalide a autorização e explique a necessidade concreta.

## 9. Pesquisa externa já feita

Buscas focadas em Drive, Gmail e Downloads não localizaram contrato comercial em uso nem comprovação específica de guarda/remessa de Nova Serrana. Foram encontrados relatórios técnicos e provas de homologação B2C. Evite reiniciar essa busca geral sem novo indício.

Referências oficiais para os pontos ainda dependentes da operação.

- RICMS/MG, arts. 82–85, modalidade porta a porta e equivalentes — https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexovii2023_3.html
- RICMS/MG, art. 9º, estabelecimento e guarda — https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/regulamento2023_1.html
- RICMS/MG, Anexo VIII, guarda e movimentação — https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexoviii2023_3.html
- LC 123/2006, art. 23 — https://www2.camara.leg.br/legin/fed/leicom/2006/leicomplementar-123-14-dezembro-2006-548099-normaatualizada-pl.html

## 10. Prompt para o próximo chat

Continue a tarefa de kits de representantes da curti Z exclusivamente em MG. Leia primeiro este documento e `AGENTS.md`. Revalide o PR #136 e preserve os worktrees e as alterações existentes. Parta da revisão validada na seção 12. Quando o backup recuperável estiver disponível, siga o procedimento de publicação com as compras fechadas e verifique a versão da loja e do painel. Valide a ativação somente com os documentos operacionais do proprietário e as evidências fiscais e dos provedores da seção 12. Trabalhe com baixo uso de RAM, sem Docker e sem pedir novamente autorização geral para publicação.

## 11. Retomada técnica do PR #136

- Cópia isolada em `.tmp/revenda-mg-pr136`, criada a partir de `26f744113676d4efaf6a278a0e69bb12472bed93`. A raiz estava em `a658ab6646d7bcc6cd3dadd1aa127d65cf179638` e a cópia anterior em `5078686258e36b27a0a6964270baf53a15d33795`, ambas com alterações preexistentes preservadas. O GitHub confirmou o CI #743 para o head original.
- Entrega de cotação e reserva em `2da60beb2a96e391bea1a121b217a97d18f94cfc` no PR. A migration `20261118150000` vincula a cotação ao CEP de saída, preço e embalagem, consome-a na mesma transação que grava o pedido e reserva o estoque compartilhado. A operação privada verifica titularidade, elegibilidade atual, MG, regra fiscal do SKU, evidências operacionais e validade. A chave é vinculada aos dados da requisição. O cancelamento pré-pagamento devolve a reserva uma vez. O agregado comercial fica no schema privado.
- O commit remoto tem a mesma árvore `cbcb14e8c3573b5d56dfefdcabbf51dd6078ef9c` que o commit local `2ba02a9`. O conector GitHub atualizou a referência com verificação do SHA anterior após o Git Credential Manager não concluir a autenticação do push.
- `git diff --cached --check` e análise de sintaxe TypeScript passaram para a primeira entrega. O cache local estava incompleto, e a revisão automática rejeitou baixar o lockfile por restrição do AGENTS.md. O comando Vitest na cópia isolada ficou sem executável. Os casos reais de PostgreSQL e os testes da aplicação foram encaminhados ao CI do PR.
- Para aprovar um cadastro comercial, a IE ativa, a atividade e o regime de revenda do comprador fiscal em MG dependem de prova oficial. Para aprovar a regra aplicável a um SKU, faltam a comprovação da modalidade e ST, a documentação do lote e da guarda ou remessa em Nova Serrana, e XML de homologação autorizado com protocolo para a regra efetiva. A aprovação comercial e fiscal depende dessas evidências. Nenhuma aprovação foi cadastrada pela migration.
- O CI #750 concluiu com sucesso no commit de cotação e reserva, incluindo PostgreSQL efêmero, lint, tipos, OpenNext, E2E e segurança. O head de Pix `98d487def7c71a7707e7a84c21c4b9e5c97d3d31` acrescentou pagamento, webhook com namespace separado, cancelamento e recuperação de criação incerta. Banco e E2E passaram no CI #752. Lint falhou no teste do adaptador e foi corrigido.
- O head `9413685911915252f38785466c664eaea928ced2` acrescentou portal, pré-validação fiscal, verificação de XML, rastreio e fila de estornos. Passaram 86 testes locais e o job de banco do CI #753, que incluiu concorrência real com duas sessões, sem overselling. O teste global do Worker precisou reconhecer as duas filas novas. A réplica de testes e as alterações adicionais continuam na cópia isolada.
- A leitura de produção mostrou migrations existentes até `20261118030000` no histórico consultado. As migrations da compra de kits continuam pendentes de aplicação em produção. O registro do CI cobre banco efêmero, sem cobranças, NF-e ou gastos logísticos reais.
- A automação passou a gerar e conferir a venda e o rascunho no Bling, exigir revisão do espelho antes de transmitir e conferir XML com protocolo antes de preparar expedição. O Melhor Envio recebe a nota do pedido e a etiqueta usa o custo da cotação. O painel operacional recebeu revisão de NF-e, preparação de impressão, inspeção de devolução e aprovação de estorno. O retorno financeiro usa recibo conciliado e o estoque recebe apenas unidades autorizadas após inspeção ou cancelamento confirmado antes de uma operação externa.
- A versão em produção, lida nos dois endpoints públicos `/api/version`, é `665e455f1639b6715b611cc1cc62ccb45c962727`, build `44402930577-1`. O PR foi atualizado com essa `main` no head `3381bf9ec1b3aa0e7b692a5f294e912d11a2d3ce`. As migrations ainda inéditas `20261117110000` e `20261117200100` foram movidas para `20261118040000` e `20261118040100`, após a linha de base de produção.
- O Supabase respondeu com zero backups na lista física e PITR desativado. A consulta somente leitura confirmou que as tabelas novas de pedidos, cotação e regras fiscais ainda estão ausentes em produção. O procedimento local usa `scripts/supabase-production-migrations.ps1` e os 85 registros de `supabase/production-baseline.json` para evitar reaplicar migrations históricas. A publicação depende de backup recuperável e da simulação e validação do head final.
- A simulação vinculada de produção retornou código zero e selecionou exatamente as 16 migrations novas de `20261118040000` a `20261118175000`. O histórico de 85 versões foi preservado. Nenhum seed, papel ou marcador histórico foi selecionado e nenhuma migration foi aplicada nessa consulta.
- O proprietário confirmou que precisa preparar o backup antes da publicação. A operação de produção continua à espera desse backup. A habilitação posterior continua dependente dos documentos e da homologação dos provedores.
- Outra consulta de produção confirmou 162 variantes ativas de kits, zero contratos e zero linhas de crédito de novembro. Bling e Melhor Envio constam como conectados no cadastro. A última verificação de API registrada para o Bling foi em 03/11/2026. Esses registros não substituem a conferência atual das séries, da natureza e do XML autorizado para revenda.

### Revisão de segurança dos fluxos comerciais

| Controle | Evidência ou limite |
| --- | --- |
| Acesso ao pedido e preço | A rota valida origem, sessão, escopo de rate limit e formato estrito. Os testes exercitam cliente sem sessão, tentativa de enviar identidade e preço, e novas compras com a liberação desligada. O pedido usa apenas o valor de catálogo e o frete persistido. |
| Concorrência e estoque | Cotação consumida, pedido e reserva compartilham a transação. O teste PostgreSQL por duas sessões verifica que apenas um dos pedidos concorrentes consome o estoque disponível e o perdedor conserva a cotação. O contrato SQL verifica replay, reversão e baixa. |
| Identidade fiscal | A revisão identificou que alterar o cadastro fiscal após a reserva poderia alterar a identidade usada por etapas posteriores. O snapshot fiscal passou a ser gravado no pedido, comparado no início da cobrança e usado para validar a devolução. Há um caso de regressão no contrato SQL. |
| Provedores e recuperação | O webhook mantém autenticação e registro de eventos. Consultas canônicas verificam referência, conta arrecadadora, ambiente, moeda e valor. O envio, a etiqueta e o estorno exigem trava de escrita persistente. Retornos de identidade incerta interrompem a escrita e preservam conciliação. |
| RLS e painel | As tabelas novas usam schema privado e RLS forçada. A aprovação fiscal, inspeção, impressão e estorno usam permissões existentes e validação no servidor. O teste de devolução inclui a recusa de aprovação pelo próprio comprador. |

As evidências técnicas usam banco efêmero, navegador do CI e respostas simuladas dos provedores. Continua necessária a conferência das contas, da emissão de homologação e da operação logística real.

## 12. Estado verificado em 19/11/2026

- A revisão `628460bd71e178f21d3f490d03de30e94dc20cce` está no PR #136, em rascunho. O `git diff --check` da base até a revisão local equivalente passou e a cópia isolada está limpa. O teste de catálogo foi atualizado para isolar as integrações utilizadas pela rota. Os 24 testes locais de catálogo, cotação e pedido passaram após o ajuste.
- O CI #758 concluiu com sucesso nos 12 jobs, incluindo qualidade, banco e migrations, quatro perfis E2E, três verificações de segurança e os builds OpenNext da loja e do painel. O PostgreSQL efêmero passou em 2.319 asserções em 99 arquivos, além de 15 asserções de atualização segura e verificações de concorrência. Os contratos de kits exercitaram disputa de duas sessões pela mesma disponibilidade, reserva atômica, repetição de requisição, cancelamento, estorno conciliado e retorno ao estoque. O checkout E2E usou dados e respostas de provedores controlados. Os quatro perfis registraram 122 testes de navegador aprovados e um teste pulado no perfil móvel.
- O Bling estava configurado para emissão NF-e 4.00 em **1 – Produção**. A tela de controle de numeração mostrou a série `001` com próximo número `2` e a série `003` com próximo número `3`. A série `002`, exigida pelo fluxo de venda de kits, ficou ausente dessa tela. Confirme a configuração e a numeração próprias da série antes do aceite fiscal. A mera presença de `003` no cadastro deixa em aberto seu uso e a autorização de NF-e para devoluções. A consulta na lista de notas ficou restrita aos filtros da interface. Nenhum XML autorizado de venda ou devolução comercial do canal foi verificado.
- A natureza com nome de homologação **MG não consumidor final** exibiu Simples Nacional, CFOP `5102` e CSOSN `102`, com destino e produto `Qualquer` na regra cadastrada. A natureza com nome de homologação **devolução PF MG** exibiu entrada, CFOP `1202` e CSOSN `102`. O cadastro conferido em tela serve para identificar as regras existentes. A devolução do comprador fiscal de revenda tem de usar a regra aprovada para seu perfil e gerar XML autorizado com vínculo da NF-e original.
- Foi feita somente leitura no Bling. O ambiente de emissão, as séries e as naturezas permaneceram como encontradas. Nenhuma cobrança, compra de etiqueta, emissão de NF-e ou mudança produtiva foi realizada durante os testes.
- O Supabase ainda reportou zero backups físicos e PITR desativado. O proprietário informou que precisa preparar o backup. O banco de produção mantém os 85 registros de migration até `20261118030000`. A simulação selecionou as 16 novas. A última versão conferida nos endpoints produtivos da loja e do painel continua em `665e455f1639b6715b611cc1cc62ccb45c962727`, build `44402930577-1`. As 16 migrations e o deploy continuam pendentes.

| Validação pendente | Evidência necessária |
| --- | --- |
| Publicação com compras fechadas | Backup recuperável de produção, com data e recuperação verificáveis. Revalidar a linha de base e a lista das 16 migrations, manter a liberação fechada, aplicar em ordem e verificar o commit publicado nos dois Workers e os acessos representativos do varejo. |
| Cadastro comercial do comprador | Contrato e evidências da operação real, identificação do comprador fiscal em MG, IE ativa e atividade compatível. Conferir se a venda é revenda em nome próprio e se o endereço fiscal e de entrega cumprem os requisitos do cenário. |
| Produto, estoque fiscal e ST | Documentos de aquisição, origem e lote dos componentes, guarda ou remessa em Nova Serrana e enquadramento de ST por item. Conferir os 162 SKUs existentes contra a rota fiscal aprovada. |
| Crédito de ICMS, quando aplicável | Competência ativa e percentual comprovado pelo responsável fiscal para o cenário aprovado. A consulta em produção encontrou zero registros para novembro. O cenário CSOSN `102` não concede crédito. |
| NF-e e devoluções | Validar a série `002`, o uso efetivo da `003` e as naturezas aprovadas por cenário e perfil. Obter XML autorizado em homologação, com protocolo, emitente, destinatário, CFOP e CSOSN compatíveis, local de entrega quando distinto e vínculo à nota original na devolução. |
| Pagamento e logística com provedores | Verificar na conta de teste do Mercado Pago criação Pix, webhook, conciliação, cancelamento e recibo de estorno. No Melhor Envio, verificar serviço, custo, vínculo fiscal, etiqueta e rastreio com transações controladas que não gerem despesa. Esses passos dependem de contas, configuração e respostas dos provedores. A expedição de kits também depende do XML autorizado. |

O fluxo comercial implementado começa por Pix e pelos cenários MG01/MG02 documentados de revenda de mercadoria de terceiros sem ST. A entrada de novos cenários depende do enquadramento e da respectiva homologação.

O proprietário adiou o backup e pediu primeiro uma proposta das melhorias. A nova consulta confirmou a versão anterior nos dois Workers e zero registros no fluxo TEST de kits. As mudanças de cadastro, fichas, exclusão, retirada do fluxo TEST e pagamento no recebimento aguardam aprovação do proprietário. Os detalhes e o resultado da nova busca no Bling estão no [plano de melhorias](planos/2026-11-19-kits-representantes-mg.md).

## 13. Aprovação das melhorias e implementação local

- O proprietário aprovou o plano e forneceu as quantidades exatas de três fichas de 12 pares. Padrão: 34×1, 35×2, 36×3, 37×3, 38×2, 39×1. Reposição baixa: 34×1, 35×3, 36×4, 37×4. Reposição alta: 37×4, 38×4, 39×4.
- O inventário somente leitura encontrou 162 SKUs de pacotes de dois ou três pares e 246 SKUs de pares avulsos com os tamanhos 34 a 39. As fichas usam o vínculo explícito da linha avulsa no cadastro do kit para preservar a composição exata. O sistema conserva os pacotes originais e o varejo.
- Na cópia isolada estão o slug automático, exclusão com confirmação e preservação de dependências, seletor de fichas, reserva por tamanho e retirada do fluxo TEST para novas transações em produção. O recebimento usa rota própria configurada, com Pix, débito, crédito à vista ou dinheiro e troco derivado do total. O fluxo integra NF-e, registro da entrega, confirmação do valor com Point ou recibo de numerário, e estorno após verificação fiscal.
- Verificação local até este ponto. 40 testes de rotas e frete, quatro testes de domínio monetário e dois testes de rateio da composição passaram. Foram acrescentados casos de PostgreSQL para as fichas, reserva por tamanho, troco, repetição e cancelamento. Os resultados de execução do banco e do deploy serão registrados após confirmação.
- O commit local `db2864c` e o head remoto `1a7a6c0c53338e1a80c80315beecdea898fa08b0` têm a mesma árvore. O PostgreSQL do CI #759 passou com o contrato de reserva por tamanho e troco. O lint da primeira revisão apontou que o pacote de integrações não dependia de Zod. A leitura das respostas do Point passou a validar dados com os recursos já usados no pacote, e os seis testes do adaptador passaram localmente. A próxima rodada de CI inclui essa correção e a conciliação agendada do Point.
- O Supabase listou zero backups, nenhum dado de recuperação física e PITR desativado. A simulação vinculada selecionou 25 migrations, incluindo as primeiras nove das melhorias, sem reexecutar o histórico, seeds ou papéis. A migration incremental da conciliação agendada foi acrescentada após essa simulação.
- Em 19/11 o proprietário identificou “Completo” como cadastro de teste e autorizou a remoção. A conferência achou zero SKUs, pedidos e regras de nível vinculados, e o kit não estava marcado como obrigatório para ativação. A remoção pontual em produção foi executada com esses filtros. A leitura posterior mostrou zero registros do kit e zero cadastros em `public.kits`. Nenhuma conta foi modificada. As fichas ficam prontas para os próximos cadastros reais após a publicação e a homologação.
- O modo TEST de novas transações foi desativado no Worker `curtiz-ecommerce` por atualização de `REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED` para `false`. A versão `44fb4f73-aeb0-4ffc-bc56-0631a0758360` recebe 100% do tráfego e preservou os 97 nomes e tipos de binding. Na primeira tentativa, o Wrangler aplicou o sufixo `-production` ao nome explícito e criou um Worker temporário. A inspeção confirmou que ele só tinha a flag desta tentativa. A exclusão exata do temporário retornou sucesso. Os endpoints públicos da loja e do painel responderam com o commit de código `665e455f1639b6715b611cc1cc62ccb45c962727`, build `44402930577-1`.
- Head do PR #136 `db6955fa73a3babf3bb6be3a957e19e5000d2f31`, equivalente ao commit local `7d53ac6` pela árvore `8a66ff41581422deff4998de1e4ae13e111c10b3`. No CI #760 passaram lint, typecheck, 2.335 asserções de banco, 15 verificações de atualização segura, todos os perfis de navegador e as verificações de segurança. O caso novo passou no desktop e no celular. Seis testes unitários de sandbox herdaram o `APP_ENV=production` do CI e receberam `403`. A revisão atual fixa o ambiente de homologação desses fixtures, com os casos produtivos mantidos. A execução local com `APP_ENV=production` passou os 30 testes e acionou o CI #761.
- A simulação final do Supabase selecionou exatamente 26 migrations de `20261118040000` a `20261119173000`, sem seeds, papéis ou reaplicação histórica. Backup recuperável continua indisponível para verificação. A publicação do PR e a ativação comercial aguardam os controles já registrados, incluindo as evidências fiscais de cada ficha nova e a confirmação da rota de recebimento, do terminal Point e das formas de pagamento do Bling.
- O CI #761 concluiu com sucesso no head `db6955fa73a3babf3bb6be3a957e19e5000d2f31`. Os 12 jobs passaram. O PostgreSQL efêmero executou 2.335 asserções em 99 arquivos, as verificações concorrentes e 15 asserções de atualização segura. Qualidade, segurança, navegadores e builds OpenNext da loja e do painel concluíram. A cópia isolada está limpa e a revisão passou em `git diff --check`.
- Após o novo login do proprietário, a lista de saída do Bling exibiu a NF-e `000002` de 19/11 como **Emitida DANFE** e a `000001` como **Cancelada**. A emitida usa série `003`, emissão própria, finalidade NF-e normal, Simples Nacional, destinatário em MG e natureza **Venda de mercadoria a não contribuinte**. O primeiro item conferido exibia unidade `PR`, NCM `64022000`, CFOP `5102`, CSOSN `101`, origem `0` e valor aplicável de crédito `0,00`. A leitura foi em tela e por amostragem. O XML e o protocolo não foram verificados. A configuração observada não comprova a série `002`, a autorização fiscal das fichas para o comprador contribuinte ou o caso de devolução.

## 14. Publicação técnica em 19/11/2026

- Após a orientação do proprietário para prosseguir com a publicação sem aguardar o backup, foi executado o procedimento oficial de migrations com `-Apply`. O Supabase listou zero backups e PITR desativado antes da aplicação. Foram aplicadas as 26 migrations de `20261118040000` a `20261119173000`, sem seed ou reaplicação histórica. O projeto remoto de homologação retornou `INVALID_ARGUMENT` até para `select 1`. Os testes de banco e navegador da revisão seguiram pelo CI do GitHub.
- A consulta pós-migration confirmou 26 versões novas e as seguintes fichas de 12 pares no banco produtivo. Padrão: 34×1, 35×2, 36×3, 37×3, 38×2, 39×1. Reposição baixa: 34×1, 35×3, 36×4, 37×4. Reposição alta: 37×4, 38×4, 39×4. A consulta verificou RLS forçada para as tabelas de pedidos comerciais, rotas de recebimento e pagamentos no recebimento.
- O PR #136 foi mesclado com o commit `aaa625f06015d28dcfd890610b477627d5ea20ca`. Os 12 jobs do CI #762 passaram, incluindo a publicação dos dois Workers, o preflight remoto do Supabase e o smoke test da loja sem cobrança. Os dois endpoints públicos `/api/version` retornaram esse commit e o build `44552877568-1`, com loja publicada às 12h20min22s e painel às 12h20min57s no horário de São Paulo.
- A loja, a página de compra para representantes e o painel responderam HTTP `200`. A API de fichas e a API administrativa de kits responderam HTTP `401` sem sessão. As consultas remotas confirmaram zero kits ativos, zero pedidos de kits, zero pedidos TEST, zero aprovações comerciais e zero rotas de pagamento no recebimento.
- O Wrangler confirmou 100% do tráfego na versão `e6e76369-8a5a-4aec-a6cd-20f1a6cb3760` da loja e na `f9268d61-c00f-4145-bfb3-283aaafd495a` do painel. Os bindings `REPRESENTATIVE_KIT_CHECKOUT_ENABLED` e `REPRESENTATIVE_KIT_COLLECTION_ENABLED` estão ausentes nos dois Workers. O binding TEST da loja permanece registrado como secret. A alteração anterior para `false` e o bloqueio no código produtivo foram preservados.
- A ativação comercial depende de kits reais com preço e linha de estoque, aprovações fiscais para os compradores e as fichas, e validação do Bling, da entrega e do Point para o cenário efetivo. Nenhuma cobrança, compra de etiqueta ou emissão fiscal produtiva foi feita nesta validação.

## 15. Conferência de estoque e dependências de ativação

- A consulta de produção concentrou cada modelo e cor com seis SKUs avulsos distintos em tamanhos 34 a 39. Há 41 linhas elegíveis, todas com estoque suficiente para montar as três fichas. Entre as linhas de maior disponibilidade está **Chinelo Feminino Liso – Praia, Piscina e Dia a Dia**, cor **Azul**. A quantidade máxima de fichas vendidas isoladamente no momento da consulta foi de 16 padrão, 12 reposição baixa e 12 reposição alta. As fichas disputam o estoque dos tamanhos em comum, portanto os limites não são somáveis.
- O Google Drive retornou relatórios anteriores de homologação e reembolso B2C. As buscas por preço de kits de revenda e operação Point não localizaram aprovação comercial ou logística aplicável às fichas. O proprietário foi consultado sobre o preço aprovado por ficha e a linha inicial antes de gravar o cadastro.
- O Wrangler confirmou, por nome de binding na versão ativa, que o token de acesso do Mercado Pago existe na loja e está ausente no painel. O identificador `REPRESENTATIVE_KIT_MP_COLLECTOR_ID` não consta em nenhum dos dois Workers. Esses resultados indicam presença ou ausência de configuração, sem verificar o conteúdo dos secrets ou o terminal. O banco continua com zero kits comerciais ativos, zero aprovações e zero rotas de recebimento.
- A revisão dirigida do dossiê, da política, das matrizes CSV e XLSX e do roteiro de aceite do pacote informado pelo proprietário confirmou que o material descreve cenários e evidências fiscais. O material não fornece preço comercial aprovado por ficha nem dados de rota própria ou terminal Point. O aceite do pacote exige a conferência das séries, da numeração e do protocolo de autorização em homologação para o cenário correspondente. A nova leitura de produção ainda retornou zero kits ativos, zero aprovações e zero rotas no recebimento.

## 16. Preços definidos por ficha no cadastro

- O proprietário determinou que a equipe definirá manualmente, em cada kit, os preços da ficha padrão, da reposição baixa e da reposição alta. Ao escolher uma linha de estoque no cadastro, o painel solicita os três valores. Kits sem fichas continuam com o campo de preço único. Para fichas antigas ainda sem configuração individual, o catálogo preserva o preço único existente.
- O catálogo mostra o preço da ficha selecionada. A cotação de frete e a de pagamento no recebimento usam esse valor no servidor. Alterar o preço da ficha invalida a cotação anterior daquela ficha. A reserva já concluída preserva seu valor, inclusive em nova tentativa com a mesma chave de idempotência. A identificação fiscal da composição permanece válida quando se altera apenas o preço.
- Typecheck local do painel e da loja, lint dos TypeScript alterados e revisão de whitespace passaram. A simulação vinculada selecionou somente `20261119180000_representative_kit_grade_prices.sql`, sem reaplicar histórico, seeds ou papéis. Implementação em `codex/kits-precos-por-ficha`, commit local `aa4335d8ea72d49f67381b48acd35adb4fb9f00b` e head com mesma árvore no PR #152 `53007db85fafbdbd1bbe0d86e53a8dcbf6f0e204`. O PR aciona verificações de banco efêmero e navegador antes da publicação.
- Os seis testes locais de valores monetários e rateio passaram. Os 12 jobs do CI #763 passaram, com 2.343 asserções em 99 arquivos do banco, 15 asserções de atualização segura, verificações de concorrência e E2E dos quatro perfis. O cenário de seleção entre duas fichas com preços diferentes e cálculo de troco passou no navegador.
- A migration `20261119180000` foi aplicada isoladamente e consta no histórico de produção. A consulta posterior confirmou três colunas de preço e RLS ativa em `public.kits`. A função de catálogo continua sem execução anônima. A consulta encontrou zero kits comerciais ativos, pedidos comerciais, aprovações válidas e rotas de recebimento válidas. O PR #152 foi mesclado como `0c165fd85acba61c958d2f2f40465c7a773d8c9e` e iniciou o CI #764 de publicação.
- Os 12 jobs do CI #764 passaram. Os dois endpoints públicos de versão retornaram `0c165fd85acba61c958d2f2f40465c7a773d8c9e`, build `44588619711-1`. A página de compra e a entrada do painel responderam HTTP 200. Suas APIs de fichas e cadastro de kits devolveram HTTP 401 sem sessão. O Cloudflare confirmou 100% do tráfego nas versões `bf800778-1695-4f45-bdd4-0b39843d4c7b` da loja e `8d8af431-cf3f-46d8-9bda-38b8e295fb8b` do painel.
- As flags `REPRESENTATIVE_KIT_CHECKOUT_ENABLED` e `REPRESENTATIVE_KIT_COLLECTION_ENABLED` estão ausentes das duas versões publicadas. O cadastro pode receber os três valores comerciais reais por ficha quando a equipe escolher a linha de estoque. Seguem pendentes para venda o cadastro dos kits reais, a documentação do comprador e do estoque fiscal, a homologação de NF-e e devolução por cenário, o trajeto com o Melhor Envio e a configuração da rota própria e do recebimento via Mercado Pago Point. As pendências fiscais e de provedores da seção 12 continuam aplicáveis. Nenhum preço, pedido, cobrança, etiqueta ou nota fiscal foi criado em produção nesta revisão.

## 17. Habilitação do canal para cadastro posterior

- O proprietário autorizou habilitar o canal agora e reservou o cadastro dos kits e de seus preços à equipe da curti Z. Nenhum kit ou preço foi criado.
- Na loja de produção, `REPRESENTATIVE_KIT_CHECKOUT_ENABLED` e `REPRESENTATIVE_KIT_COLLECTION_ENABLED` foram definidos como `true`. O Cloudflare confirmou 100% do tráfego na versão `8b0372d2-3c57-43f4-9c0f-9d5ea5198ced`, com os 97 bindings anteriores e somente os dois acréscimos. O painel não exigiu mudança para permitir o cadastro. A loja segue no commit `0c165fd85acba61c958d2f2f40465c7a773d8c9e`, build `44588619711-1`. A página inicial e a página de kits responderam HTTP 200. A API de fichas sem sessão respondeu HTTP 401.
- A habilitação dessas duas opções não libera cobranças por si só. A loja ainda não tem `REPRESENTATIVE_KIT_MP_COLLECTOR_ID`, `REPRESENTATIVE_KIT_FULFILLMENT_ENABLED` e `REPRESENTATIVE_KIT_REFUNDS_ENABLED`. O banco retornou zero aprovações fiscais válidas e zero rotas válidas de recebimento. A ativação das rotinas de expedição e estorno e a operação do Point dependem da verificação fiscal e dos provedores registrada nas seções anteriores. Nenhuma nota, etiqueta ou cobrança foi gerada.

## 18. Conta recebedora, webhook e verificação de estornos

- Na conta empresarial CURTI Z FOOTWEAR LTDA, a aplicação existente **curti Z Ecommerce** exibe Checkout Bricks. A configuração produtiva do webhook tem o evento **Pagamentos (legacy)** selecionado e aponta para `https://curtiz.com.br/api/webhooks/mercadopago`. A configuração no Mercado Pago foi conferida sem alteração.
- O identificador da conta recebedora, confirmado pela troca para a conta empresarial no Mercado Pago, foi registrado como `REPRESENTATIVE_KIT_MP_COLLECTOR_ID` no Worker da loja. A versão Cloudflare `ff9701e2-2099-4078-ad2f-f92bf4953e72` está ativa com 100% do tráfego e somente esse binding adicional. O endpoint de versão conserva o commit `0c165fd85acba61c958d2f2f40465c7a773d8c9e`. O webhook publicado respondeu HTTP 401 a uma requisição sem assinatura e sem identificador de pagamento.
- Passaram 49 testes locais das rotas de webhook e pedidos e dos adaptadores de pagamento comercial, cancelamento e Point. Os testes usam respostas controladas. Os contratos de banco do CI #763 já cobriram bloqueio de estorno antes da validação do XML, estorno parcial, idempotência e reposição de estoque após confirmação. A leitura em produção encontrou zero pedidos, devoluções e solicitações de estorno de kits e zero eventos processados no namespace produtivo do Mercado Pago.
- Ainda falta observar a identidade devolvida por `/users/me` com a credencial produtiva usada pela loja e uma notificação assinada reconciliando um pedido real de kit. O código compara a conta recebedora com `/users/me` antes da primeira criação de Pix. O proprietário adiou o fiscal e o Melhor Envio. O estorno produtivo e a devolução de um kit faturado não foram executados. Nenhuma cobrança, nota, etiqueta ou movimentação financeira foi criada.

## 19. Entrega própria dos kits de atacado em MG

- O proprietário aprovou a execução do plano enquanto aguarda a contabilidade. O PR #153 implementa a cotação pela rota própria para Pix antecipado e pagamento no recebimento, o cadastro de rotas administrativas, a confirmação separada de entrega e pagamento e a retirada aprovada antes da inspeção de devolução. O estorno pelo Mercado Pago exige duas pessoas autorizadas distintas, além das condições fiscais existentes. O varejo mantém o Melhor Envio.
- A cópia isolada partiu de `0c165fd85acba61c958d2f2f40465c7a773d8c9e`. O commit local `d3d3c480d69d200c6f5d3186a3ccfb24bd5e753f` e o head do PR `f6a3adeb3ef7ca21d750919f62b8c0d19b14a7f9` têm a mesma árvore. O typecheck local passou e as 41 verificações locais relacionadas a pedido, cotação e webhook passaram. O CI #765 valida migrações no banco efêmero, permissões, concorrência e navegadores sem movimentação financeira.
- A simulação vinculada selecionou exatamente `20261119191000`, `20261119192000` e `20261119193000`, sem seed ou reaplicação do histórico. A aplicação e publicação aguardam os resultados do CI. Dados das rotas reais, meios de recebimento e evidência do Bling continuam sujeitos à validação.
- O primeiro CI encontrou uma inserção duplicada no teste, pois a reserva já cria o registro sintético de expedição. O teste passou a atualizar a linha existente. No head corrigido `d2648f67a577688e250403fd67c4f8a00012d8ec`, os 12 jobs do CI #766 passaram, incluindo 2.354 asserções SQL, 15 asserções de atualização segura, concorrência, navegadores, segurança e builds OpenNext.
- As três migrations foram aplicadas e conferidas no histórico produtivo. As funções de gestão de rotas e devoluções estão bloqueadas para o papel anônimo. A leitura confirmou zero pedidos comerciais de kits, zero rotas vigentes e zero aprovações fiscais vigentes. O merge do PR #153 produziu `5162ade0cfca64a51134890e63976cb3103fc7eb` e iniciou o CI #767 de publicação.
- Os 12 jobs do CI #767 passaram. Os dois domínios servem `5162ade0cfca64a51134890e63976cb3103fc7eb`, build `44599257619-1`. A página de compra de kits e a entrada do painel responderam HTTP 200. A API de fichas respondeu HTTP 401 sem sessão. A API operacional de rotas respondeu HTTP 403 sem sessão, conforme o controle dessa rota, e a API administrativa de kits respondeu HTTP 401. O Cloudflare confirmou 100% do tráfego nas versões `8a388f7f-00a8-47e9-a599-64cfb6b5e8e4` da loja e `353a2c9d-2155-4cc9-ae7f-5b4775518d31` do painel.
- A loja preservou os bindings do canal, do pagamento no recebimento e do identificador Mercado Pago. As flags de processamento fiscal e estorno dos kits continuam ausentes. Para operar, faltam rotas reais com taxa, prazo, terminal Point e IDs de recebimento no Bling, a verificação da configuração do Point no painel e a homologação fiscal. Nenhum pedido real, cobrança, estorno, etiqueta ou nota fiscal foi criado na validação.

## 20. Encaminhamento fiscal

- O proprietário informou que os kits usam os mesmos produtos e os mesmos processos de produção, montagem, acabamento e armazenamento. Ribeirão das Neves/MG é a sede fiscal de referência e Nova Serrana/MG é o local da retirada física. A primeira informação segue registrada no [handoff fiscal](HANDOFF-FISCAL-KITS-MG-2026-11-19.md), com o alcance das evidências existentes, as pendências e as fontes para a nova conversa. Nenhuma configuração fiscal foi alterada nesta etapa.

## 21. Publicação do atacado em 20/11/2026

- O proprietário autorizou mudanças, commit, publicação e ativação dos cenários comprovados. O checkout pede somente o endereço em MG e usa entrega própria de taxa zero. Pix antecipado e dinheiro no recebimento seguem os controles de pagamento e conciliação. Maquininha, cobertura por região e prazo tabelado ficaram fora desta entrega. A devolução parcial vincula SKU, quantidade e valor ao documento original e controla a reposição no estoque. Recusa e devolução após recebimento seguem fluxos separados.
- Na homologação, foram aplicadas 74 migrações pendentes e preservadas as 49 existentes. As 145 asserções PostgreSQL passaram com rollback. Em produção, as sete migrações do PR #154 foram aplicadas após backup lógico conferido de public, private e supabase_migrations. A leitura confirmou 122 versões, última versão 20261120133000, funções novas presentes, zero pedidos e zero aprovações comerciais ativas.
- O backup privado local supabase-prod-20261120-115113.dump tem manifesto SHA-256 e leitura integral verificada pelo pg_restore. Uma recuperação de banco deve começar pela restauração em base isolada e prosseguir por dados afetados. Em incidente de aplicação, reverter os Workers às versões da seção 19 e verificar /api/version, preservando o banco e as transações posteriores.
- As duas naturezas de venda série 003 no Bling estão configuradas com 5102 e CSOSN 101 e 102. A regra elegível de novembro utiliza o crédito de 1,36%. A série de devolução confirmada é 004. Faltam o histórico integral para verificar a numeração, os XMLs de venda e devolução com protocolos reais de homologação e o documento existente que vincule os SKUs ao estabelecimento de guarda em Nova Serrana. O Bling usa uma configuração de ambiente compartilhada pelo varejo. O checkout de atacado permanece bloqueado até comprovação. Nenhuma NF-e de teste foi emitida em produção e nenhum pagamento real foi movimentado.

- O PR #154 foi integrado na main com o commit b52ec5cc796868b39ef3f40857bc9f60b50c30f5. O CI oficial #772 concluiu os 12 jobs. A loja e o painel serviram esse commit em /api/version. No Cloudflare, 100% do tráfego foi confirmado nas versões c2bdc522-92f3-4365-a3e1-a787296dc586 (loja) e 604a58b7-c194-46e0-8dac-70131c6824eb (painel). As páginas principais responderam HTTP 200. As APIs do atacado e operacional sem sessão responderam HTTP 401 e 403. O checkout comercial continua fechado.

## 22. Prontidão para entrega à equipe em 20/11/2026

- A nova conferência do Supabase de produção retornou zero regras fiscais de revenda, zero aprovações comerciais ativas e zero pedidos de atacado. A migration final continua em 20261120133000. A loja e o painel já têm os fluxos técnicos. A entrega pode ser demonstrada em ambiente isolado, incluindo pedido por endereço em MG, Pix ou dinheiro no recebimento, entrega própria, recusa e devolução parcial por SKU.
- Na loja, as configurações compartilhadas de envio fiscal do Bling estão presentes. Os controles específicos de faturamento e estorno do atacado, REPRESENTATIVE_KIT_FULFILLMENT_ENABLED e REPRESENTATIVE_KIT_REFUNDS_ENABLED, continuam inativos. A mera presença dos controles de checkout e recebimento como segredos no Worker não demonstra que os seus valores habilitam o canal. Nenhuma configuração de produção foi alterada nesta conferência.
- A equipe fiscal deve fornecer o XML autorizado de homologação da venda série 003 e da devolução aplicável, com os protocolos da SEFAZ, junto com o documento fiscal ou escrituração vigente de guarda e retirada de Nova Serrana e os SKUs cobertos. Vincular cada evidência à composição exata, ao cenário tributário, ao emitente e à vigência. A regra de dinheiro no recebimento tem homologação própria e usa a forma Dinheiro já identificada no Bling. Para a série 004, conferir no emissor o histórico aplicável antes de fixar o próximo número.
- O painel atual opera pedidos já autorizados. Ainda não possui cadastro das evidências de liberação nem aprovação de compra por representante e composição. Até esse fluxo existir, a liberação requer registrar as regras e aprovações no Supabase após a conferência dos documentos e habilitar os controles do atacado. A entrada de documentos, sozinha, não muda a situação comercial.


## 23. Reavaliação do documento de guarda em 20/11/2026

- O proprietário pediu a liberação antes da entrega do documento de guarda. A minuta de termo de guarda é apenas uma fonte possível. Não se exige um novo termo específico se a escrituração ou a NF-e existente comprovar o enquadramento e o local da saída. O cadastro logístico identifica Nova Serrana, a contagem confirma quantidades físicas e a referência à NF-e 11.624 sustenta a classificação dos chinelos documentados. As fontes disponíveis não identificaram o vínculo fiscal de guarda e retirada para uma composição liberável. O RICMS/MG, Anexo VIII, distingue o tratamento de armazém-geral e depósito fechado.
- A revisão do ZIP de liberação localizou a matriz e o dossiê, sem XML ou protocolo de autorização. A leitura de produção confirmou zero regras fiscais, zero aprovações vigentes e zero pedidos do atacado. Os protocolos dos cenários de venda e devolução continuam como requisito independente de validação do fluxo. Nenhum cenário foi liberado nesta revisão.


## 24. Conferência no Bling antes da liberação

- A origem física confirmada pelo proprietário coincide com o registro do Melhor Envio. Rua Antônio Pedro da Silva, 753, Romeu Duarte, Nova Serrana/MG, CEP 35524-168. A sede fiscal de referência permanece em Ribeirão das Neves.
- No Bling, a tela de numeração mostrou próximo número 000003 para a série 003 e nenhuma linha para a série 004. Antes de usar 000001, confirmar que a série de devolução não foi usada em outro emissor da empresa. O ambiente consultado está em Produção.
- A consulta de notas de entrada pelo número 11624 não retornou resultado na listagem consultada. Estoque > Depósitos mostra somente Geral como depósito padrão. Preservar esse cadastro. A listagem operacional de depósitos não identifica o estabelecimento fiscal de retirada nem comprova como o endereço será transmitido no XML.
- Ordem de liberação. Confirmar no XML de homologação a retirada em Nova Serrana, o vínculo com a origem fiscal e as autorizações de venda e devolução. Reutilizar os registros existentes que cubram os itens. Em seguida, registrar no Supabase as regras e aprovações por composição e comprador, habilitar os controles do atacado no Worker e conferir as travas de MG e do varejo. Se a operação exigir que a equipe libere cenários por conta própria, o painel ainda precisa dessa função. Nesta revisão nenhuma configuração de produção foi alterada.


## 25. Preparação da entrega à contabilidade

- O texto recebido reforça a conferência do grupo estruturado de retirada e da homologação de venda e devolução. O MCP oficial do Bling existe, mas não está disponível nesta sessão. A documentação pública localizada não confirma o campo de retirada no contrato da API. O acesso ao Bling nesta sessão permanece pelo navegador.
- O Supabase de produção retornou zero regras fiscais, zero aprovações ativas e zero pedidos de atacado. A revisão automática rejeitou a tentativa de preparar os dois controles de faturamento e estorno no Worker, considerando o risco de ativação na ausência de cenários comprovados. A leitura posterior confirmou os mesmos 100 vínculos e a mesma versão ativa do Worker. Nenhuma mudança de produção foi aplicada nesta etapa.
- Os três arquivos de teste de pedidos, catálogo e rascunho fiscal passaram em 64 testes. As instruções para a contabilidade estão em CONFERENCIA-BLING-CONTABILIDADE-KITS-MG.md. Após a conferência dos XMLs e do enquadramento da retirada, cabe à equipe técnica registrar as aprovações no Supabase e habilitar os controles restritos ao atacado. A contabilidade pode fazer sua parte no Bling.


## 26. Busca nos módulos e conferência dos XMLs em 20/11/2026

- No Bling, a listagem de saída ampliada para 01/07 a 20/11/2026 mostrou as notas 000002 e 000001. A 000002, série 003, de 19/11/2026, é venda a consumidor final em produção. O XML processado tem protocolo, cStat 100, chave coincidente, CFOP 5102 em todos os 28 itens e NCM 64022000. O emitente indica Ribeirão das Neves. Não há grupo retirada ou entrega e a modalidade de frete no XML é 0.
- O arquivo disponibilizado para a nota 000001 é o evento de cancelamento da série 003, tpEvento 110111 e cStat 135, com protocolo em produção.
- Na aba Notas de compra, de 01/07 a 20/11, consta a NF-e 011491, série 002, com XML autorizado em produção, destinatário com o mesmo CNPJ do emitente da 000002, endereço fiscal em Ribeirão das Neves e 24 linhas no NCM 64022000, unidade PR. O fornecedor está em Nova Serrana, em endereço diferente do ponto de retirada. Não constam os grupos retirada ou entrega. Os códigos de produto desse fornecedor e os da venda não coincidem diretamente. A referência à compra 011624 não foi localizada no Bling consultado.
- A aba Notas recebidas exige configurar a busca automática e selecionar unidade. O filtro só mostrava Nenhuma unidade. A função não foi ativada. Consultaram-se também Pedidos de venda, Pedidos de compra, Dados da empresa, Minhas instalações, Depósitos e uma amostra de Lançamentos de estoque. O cadastro fiscal mostra Ribeirão das Neves. Minhas instalações mostrou a integração da curti Z. O depósito Geral e o lançamento de sincronização da amostra não identificam o estabelecimento de retirada.
- Os XMLs baixados ficaram na pasta local de navegação ignorada pelo Git. Nenhuma nota foi emitida ou alterada, nenhum ambiente foi trocado e a consulta não localizou XML homologado de venda de atacado 003 ou devolução própria 004.


## 27. Guarda própria e teste sem emissão

- O proprietário confirmou que a própria curti Z guarda os produtos e os retira no mesmo endereço de Nova Serrana já registrado. Esta é a confirmação da guarda operacional. A identificação fiscal do local e a forma de registrar a saída permanecem como itens de conferência, sem exigir uma nova declaração do proprietário.
- A especificação OpenAPI efetivamente carregada pela referência oficial do Bling foi consultada. O contrato de POST /nfe e a consulta individual GET /nfe/{idNotaFiscal} não expõem campo estruturado de retirada. O endereço que consta em transporte.etiqueta pertence à etiqueta. O formulário da nota 000002 já emitida foi consultado em leitura. Ele apresentou transportador, frete e informações adicionais, sem campo de retirada visível.
- Foram reexecutados 85 testes em três arquivos de validação de XML, política fiscal e rascunho Bling. Todos passaram sem transmissão. A operação de atacado em produção continua bloqueada. Nenhuma NF-e foi criada, transmitida ou alterada. A validação técnica local confirma o comportamento da aplicação, enquanto a aceitação do XML pelo Bling e pela SEFAZ no cenário de retirada ainda não foi demonstrada.


## 28. Busca de XML fiscal reaproveitável em 21/11/2026

- A análise dos arquivos locais encontrou três NF-e distintas autorizadas em homologação, números 1, 2 e 3 da série 002. Os três XMLs indicam venda a consumidor final e nenhum registra o grupo retirada. O destinatário do primeiro documento está em MG e os demais estão em SP. Essa evidência confirma a homologação do varejo, sem cobrir retirada em Nova Serrana ou devolução de atacado.
- A busca no Drive retornou relatórios de outubro e referências à homologação do varejo. A busca no Gmail por endereço, série e anexos fiscais pertinentes não retornou correspondências. O pacote fiscal local não contém XML.
- Após novo login, o Bling mostrou as mesmas notas de saída 000002 e 000001 e a nota de entrada 011491 no período até 21/11/2026. A consulta do Supabase de produção retornou zero regras fiscais, aprovações ativas e pedidos de atacado. Nenhuma NF-e foi emitida ou alterada e nenhum cenário foi ativado.


## 29. Caminhos de homologação separados do varejo em 21/11/2026

- O Bling publicou em 18/11 a simulação de NF-e para Simples Nacional e MEI. A documentação afirma que a simulação é restrita ao usuário logado. A chave Simular com dados da Reforma Tributária não apareceu em Notas fiscais de saída da conta consultada. Em Dados da empresa também não apareceu a opção Usuário testador descrita na ajuda sobre Beta. A consulta não alterou o ambiente geral. [Simulação do Bling](https://ajuda.bling.com.br/hc/pt-br/articles/44825458093207--Atualiza%C3%A7%C3%B5es-da-vers%C3%A3o-Simula%C3%A7%C3%A3o-da-Reforma-Tribut%C3%A1ria-para-Simples-Nacional-e-MEI) · [Isolamento por usuário](https://ajuda.bling.com.br/hc/pt-br/articles/33954454841751-Como-emitir-NF-e-com-os-dados-da-Reforma-Tribut%C3%A1ria-no-Bling)
- A SEF/MG publica autorização de NF-e 4.00 em domínio exclusivo de homologação, com certificado ICP-Brasil. A Nuvem Fiscal documenta o grupo de retirada, o ambiente por solicitação e a prévia de XML sem assinatura. Essa alternativa exige acesso autorizado ao emissor e validação ponta a ponta. Um XML de teste emitido por outro sistema não comprova a geração do grupo retirada pelo Bling. O Bling documenta a importação de NF-e já emitida em outro emissor, que pode ser avaliada se o atacado passar a usar essa rota. [Homologação oficial MG](https://portalsped.fazenda.mg.gov.br/spedmg/nfe/webservices/) · [API alternativa](https://dev.nuvemfiscal.com.br/docs/api/) · [Importação no Bling](https://ajuda.bling.com.br/hc/pt-br/articles/360036992594-Como-importar-XML-de-notas-de-sa%C3%ADda)
- Encaminhamento técnico ao Bling, ainda sem envio. A conta tem emissão de varejo em produção. A chave de simulação isolada anunciada para Simples Nacional não aparece. Podem habilitá-la neste usuário ou indicar um ambiente isolado para o mesmo emitente? Qual tela ou campo da API v3 gera o grupo retirada em uma NF-e de saída quando a sede fiscal fica em Ribeirão das Neves e o estoque próprio sai de Nova Serrana? Precisamos exportar e conferir a NF-e de venda série 003 e a devolução própria 004 em homologação, com os protocolos da SEFAZ.
- O endereço e a guarda própria continuam registrados conforme confirmação do proprietário. O cadastro público consultado indica a consulta SINTEGRA por identificação do estabelecimento e com reCAPTCHA. O arquivo resumido descrito na página oficial não apresentou link de download. A pesquisa pública não trouxe comprovação adicional do cadastro do local de retirada. Não foi transmitida NF-e nem alterado o checkout.


## 30. Teste isolado no Supabase e conferência no Cloudflare

- O projeto de homologação do Supabase executou novamente as 145 asserções do atacado com dados sintéticos e rollback. A execução cobriu os contratos de pedido, estoque, recebimento, entrega, recusa e devolução. O ensaio independe do Bling e não cria um protocolo da SEFAZ.
- A conta atual do Cloudflare não lista os Workers curtiz-ecommerce-staging ou curtiz-panel-staging. Os aliases workers.dev da loja e do painel publicados são do ambiente produtivo. O CI oficial #772 registra 12 verificações aprovadas, incluindo os dois builds dos Workers. Não houve nova publicação nem alteração dos controles produtivos.
- Os XMLs antigos de teste são de varejo. Para a liberação fiscal, falta um XML autorizado do cenário de atacado que demonstre a retirada em Nova Serrana e sua devolução aplicável. O Supabase e o Cloudflare verificam a aplicação. A autorização fiscal é emitida pela SEFAZ em homologação.


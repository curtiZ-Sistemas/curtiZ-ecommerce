# Bling — conclusão controlada

## Plano de execução

1. Reutilizar as homologações; consultar conexão, regras, filas e respostas reais sem transmitir documentos produtivos.
2. Corrigir apenas falhas comprovadas: vínculo de webhooks, diagnóstico seguro e liberação fiscal condicionada ao XML/DANFE correto.
3. Conferir no provedor séries 002/003, naturezas B2C/devolução e cadastro documentado; preservar contadores sem prova de disponibilidade e crédito 101 limitado à competência comprovada.
4. Executar testes fiscais/integração, tipos e lint; revisar o diff, commitar, enviar e preparar PR/deploy sem ativar emissão comercial.

## Confirmações recebidas nesta tarefa

- Chinelos documentados: NCM 64022000, unidade PR, origem 0; referência contábil NF-e de entrada 11.624. Não aplicar por inferência a produtos de composição desconhecida.
- UpSeller permanece intocado: série 001, NF-e 40 autorizada.
- Venda B2C: 5102/MG ou 6108/não contribuinte interestadual, CSOSN 102.
- Devolução: 1202/2202, PIS/COFINS 98 e alíquotas zero, preservando o tratamento homologado de entrada.
- Crédito CSOSN 101: 1,36% somente para operações elegíveis de outubro/2026; sem extrapolação para novembro.
- Séries 002/vendas e 003/devoluções: número 1 apenas com prova de ausência de utilização/inutilização em produção.
- Sem cobrança, emissão/transmissão produtiva, compra de etiquetas ou ativação automática comercial.

## Evidência atual

- Conexão real da empresa confirmada pelo painel em 01/11; renovação OAuth concluída pelo servidor sem ler valores.
- Banco já contém os CFOPs/CSTs acima; crédito mensal cadastrado exclusivamente em outubro.
- Falhas antigas de geração possuem job já concluído; não reexecutar como se ainda estivessem pendentes. Recusa histórica registrada com código de campo 0 exige resposta atual para determinar sua causa.
- Sete eventos fiscais sem pedido vinculado estão falhos; não criar vínculos por semelhança nem transmitir novamente.
- A sessão foi restabelecida e a consulta temporária em produção foi autorizada, sem criar, mover ou transmitir notas. Saídas: zero registros de 01/01/2006 a 01/11/2026, todas as lojas, sem filtro de situação selecionado. Isso não comprova inutilizações externas.
- Conferidas diretamente no Bling as naturezas B2C MG (15111725655, série 2, 5102/102), B2C interestadual (15111725692, série 2, 6108/102) e devoluções PF MG/interestadual (15111772281/282, série 3, 1202/2202, PIS/COFINS 98, alíquotas zero). Não foram regravadas nem substituídas.
- Os 162 SKUs de kits já têm 372 componentes; nenhum tem origem, NCM, unidade, soma de pares ou hash de origem divergente. A unidade comercial UN do kit é preservada; a decomposição fiscal em PR já existe.

## Correções e revisão focada

- Webhooks: consulta privada por ID fiscal ou código exato, com confirmação da venda no provedor antes de vincular nota nova. Ausência de referência não autoriza inventar vínculo. Evento externo é ignorado; conflito e falha de banco continuam bloqueados.
- Recusas: data de operação, condições de pagamento, certificado, série/numeração e tributos ganham motivos fixos no painel. Não são armazenadas mensagens livres, valores recusados, documentos pessoais ou corpos de resposta.
- Arquivo: XML autorizado deve corresponder à chave, modelo 55, emitente, série, número e total do pedido. Protocolo, ambiente, rateio e unidades são lidos pelo parser existente; DANFE deve ser PDF. Replays verificam hashes dos arquivos existentes, sem sobrescrevê-los.
- Expedição: com a política fiscal exigida, somente XML de produção verificado e DANFE arquivados da mesma nota liberam o fluxo. A autorização no Bling apenas agenda arquivamento. Homologação não libera despacho comercial; conciliação comercial volta a bloqueá-lo.
- Revisão de segurança (`differential-review`): base 37489b2; origem da validação removida rastreada em 4e1624f. Dois consumidores de produção do parser (prévia de devolução e arquivo); um arquivador; observação usada por consulta, fila e webhook. Mantidos RLS, grants exclusivos do serviço, leases, idempotência, comparação do pedido e guardas de transmissão. Sem leitura de segredos nem novas rotas públicas.
- Risco remanescente: o parser verifica conteúdo/protocolo fornecido pelo Bling, não uma assinatura XML de forma independente. Alterações de banco ainda precisam passar no PostgreSQL isolado do CI e ser aplicadas antes do Worker.

## Validação e publicação

- Reproduzidas falhas de XML recusado e identidade divergente antes da correção; regressões passaram depois.
- Bateria fiscal: 299 testes/13 arquivos; APIs de painel: 55/5; regressão adicional de webhook/catálogo/fila/contratos: 337/80; frete: 34. Há sobreposição entre baterias, não somar como testes únicos.
- TypeScript de loja/painel aprovado; ESLint dos arquivos alterados aprovado com resolução temporária das fontes locais. Dependências instaladas foram reutilizadas, sem instalações, atualização de versões ou silenciamento de regras. `git diff --check` aprovado.
- As duas migrations são incrementais e não emitem notas, não alteram contadores, não reprocessam cobranças nem ativam flags. Aplicar antes de publicar o Worker. O banco deste computador está indisponível; os testes pgTAP vão pelo CI isolado.
- Antes da emissão comercial: comprovar séries/contadores e inutilizações, aprovar a política fiscal com o hash conferido, exigir a nota para expedição e sair do escopo de pedido único de homologação. A primeira transmissão produtiva continua exigindo autorização específica.

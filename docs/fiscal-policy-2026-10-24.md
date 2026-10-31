# Orientações fiscais recebidas em 24/10/2026

Fonte: texto do contador encaminhado pelo responsável nesta conversa. Trata-se da
política de parametrização; não confirma uma nota individual, série produtiva,
composição ainda não conferida ou autorização da SEFAZ.

## Devolução de consumidor final pessoa física

- CFOP 1202/MG ou 2202/interestadual, mantendo a referência à NF-e original.
- IPI CST49, cEnq999; PIS98 e COFINS98; alíquotas e valores de imposto zero.
- O seletor exige declaração explícita de PF/consumidor final/não contribuinte.
  Não estende essa orientação a devoluções de empresas ou destinatários indefinidos.
- A prévia XML usa IPITrib/CST49, conserva as bases explícitas e não numera nem
  transmite NF-e. A regra de saída IPI99 é preservada.
- O abatimento de receita no PGDAS-D informado pelo contador é uma atividade de
  apuração mensal. Esta mudança não gera crédito tributário nem altera a contabilidade.

## Venda de kits para revenda

- Natureza distinta da venda B2C: CFOP5102/MG ou6102/interestadual, consumidor
  final=false, presença2/internet. NCM64022000, pares individuais e rateio em
  centavos por composição cadastrada; o estoque continua no SKU comercial próprio.
- CSOSN102 para operação sem direito a crédito. Ser contribuinte ou PJ não prova
  direito a crédito. Uma classificação expressa é exigida para contribuintes.
- CSOSN101 exige PJ, IE ativa, regime normal, destinação compatível, elegibilidade expressa e alíquota mensal aprovada de
  crédito vinculada à competência da venda e à apuração do mês anterior. A alíquota não veio nas informações recebidas; nenhum valor
  foi inventado. Cenários com crédito permanecem sem parametrização operacional.
- ICMS/IPI/PIS/COFINS principais zero; saída mantém PIS49/COFINS49/IPI99/cEnq999
  anteriormente confirmados. A alíquota de crédito do Simples é um campo separado.
- Regras de revenda independentes impedem reutilizar CFOP6108 de consumidor final.
  Naturezas do provedor devem ser verificadas e vinculadas; IDs não são copiados
  entre cenários por suposição.

## Pendências preservadas

O texto não confirmou histórico e próximo número produtivo das séries2/3 nem a
alíquota aplicável de crédito do CSOSN101. A parametrização conserva as séries
existentes para prévias; não reinicia contadores nem autoriza uso produtivo.
Homologação do provedor/XML, validação dos espelhos, rejeição da nota reservada,
cadeia logística e gates comerciais continuam independentes desta orientação.

Referências técnicas conferidas:

- [Bling: configuração do aproveitamento de crédito](https://ajuda.bling.com.br/hc/pt-br/articles/360043712894-Como-fa%C3%A7o-para-configurar-a-mensagem-padr%C3%A3o-de-aproveitamento-de-cr%C3%A9ditos-do-Simples-Nacional): exige ativar a mensagem e preencher a alíquota aplicável na natureza.
- [Portal NF-e: leiaute do grupo IPI](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=9bznzUXCXr0%3D): CST49 utiliza IPITrib, assim como99. Este vínculo técnico não substitui o parecer fiscal recebido.


## Consumo mensal e auditoria

`private.bling_monthly_credit_rates` mantém aprovações por mês de aplicação,
mês de apuração, revisão, responsável, instante e referência privada da evidência.
O histórico é imutável: correções acrescentam revisão; não sobrescrevem a anterior.
RLS forçada e ausência de grants impedem cadastro pelo navegador e pelo runtime.
O cadastro é uma operação contábil privilegiada e revisada, sem endpoint público.
Nenhum percentual ou destinatário é criado pela migration.

O operador deve registrar `application_month` no primeiro dia do mês da venda,
`reference_month` no primeiro dia do mês anterior, `revision` crescente, `rate`
validado, `evidence_reference` privada e `approved_by` do responsável. Faça o
registro em transação, serializando revisões da mesma competência. O responsável
não deve ser inferido de metadados editáveis do cliente. Zero não é preenchimento
provisório permitido. Sem a competência aplicável, somente o cenário101 é bloqueado.

A RPC de leitura existente continua exclusiva do backend e retorna a última revisão
por mês. A prévia exige data civil explícita da operação; não usa a data do computador,
nem a taxa fixa antiga. Alterações da evidência entram no hash de aprovação fiscal.
O cálculo usa bases por item conferidas no contrato do provedor, arredonda em
centavos por item e soma os resultados. Sem bases conferidas, não preenche a mensagem
legal. A prévia permanece não transmissível e exige conferência do XML do provedor.

Todos os fluxos atuais do portal/checkout são pela internet: presença2. A biblioteca
só usa9 quando o chamador informa explicitamente `other_non_presential`; esse canal
não está disponível no endpoint do portal. O papel de representante não define canal,
regime tributário ou direito ao crédito.

A atualização das entradas está separada em
`supabase/operations/update-return-entry-cst98.sql`. Aplicar depois da migration,
testes no isolado e CI aprovado. A operação mantém séries e IDs do provedor e não
recria aprovações invalidadas pelo novo hash. Nenhum contador é reiniciado.
O documento empresarial de origem e os dados contábeis ficam fora do Git.
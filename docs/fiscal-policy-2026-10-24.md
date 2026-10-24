# Orientações fiscais recebidas em 24/10/2026

Fonte: texto do contador encaminhado pelo responsável nesta conversa. Trata-se da
política de parametrização; não confirma uma nota individual, série produtiva,
composição ainda não conferida ou autorização da SEFAZ.

## Devolução de consumidor final pessoa física

- CFOP 1202/MG ou 2202/interestadual, mantendo a referência à NF-e original.
- IPI CST49, cEnq999; PIS49 e COFINS49; alíquotas e valores de imposto zero.
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
- CSOSN101 exige PJ, contribuinte, elegibilidade expressa e alíquota aplicável de
  crédito configurada. A alíquota não veio nas informações recebidas; nenhum valor
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


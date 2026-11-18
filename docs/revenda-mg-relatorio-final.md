# Revenda de kits em Minas Gerais

## Situação

Em 18/11/2026, o proprietário restringiu o canal de kits de representantes a Minas Gerais. O pacote de liberação indica aprovação do escopo MG e informa crédito de 1,36% para a competência de novembro, com referência a outubro. A operação comercial continua bloqueada até haver comprovação por cenário. A restrição de UF foi implementada no catálogo, nas APIs próprias dos kits e nas regras de endereço e cotação do banco. O checkout varejista nacional usa suas rotas e tabelas existentes.

## Regras candidatas, versão 2026-11

| Perfil | Condição para analisar a liberação |
| --- | --- |
| MG01, PJ regime normal | IE ativa e atividade comprovadas. Crédito de 1,36% somente de 01/11/2026 a 30/11/2026 e somente nos itens elegíveis a 101 ou 201. Conferir referência de outubro e aprovação no cadastro fiscal. |
| MG02, PJ Simples | IE ativa e atividade comprovadas, com rota própria sem crédito. |
| MG03, MEI com IE | Cadastro e atividade comprovados. A aplicação de ST depende da modalidade efetiva. |
| MG04, PF com IE | Exceção condicionada à comprovação de aptidão e homologação específica. |
| MG05–MG07, PF ou MEI sem IE e PJ não contribuinte | Bloqueados no escopo inicial de revenda. |
| MG08, PJ dispensada | Exceção condicionada a prova legal específica e XML homologado. |

5.102/101 ou 102 é candidato para revenda de mercadoria adquirida de terceiros em cenário comprovadamente sem ST. 5.101 requer comprovação de produção própria. Rota porta a porta ou equivalente exige enquadramento e tratamento próprios. O catálogo é composto por kits comerciais. A NF-e precisa conferir os pares de cada SKU e o rateio de frete e desconto no XML. O crédito informado para novembro não é renovado automaticamente. [RICMS/MG, Anexo VII](https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexovii2023_3.html) · [LC 123/2006, art. 23](https://www2.camara.leg.br/legin/fed/leicom/2006/leicomplementar-123-14-dezembro-2006-548099-normaatualizada-pl.html)

## Evidências e pendências por gate

| Gate | Estado e evidência |
| --- | --- |
| G01 · Escopo | Catálogo e prévia com destino MG. APIs recusam as outras 26 UFs e CEPs incompatíveis. Cotação de checkout exige estado do endereço salvo e CEP de MG. Nova transação de teste recusa declaração interestadual e o banco restringe o endereço capturado. |
| G02 · Elegibilidade | A declaração do portal é informativa. Falta cadastro oficial conferido de IE, regime, atividade e titularidade/endereço fiscal para cada perfil a ativar. |
| G03 · Mercadoria | O dossiê identifica a classificação do chinelo PVC documentado. Ainda é preciso vincular os SKUs que serão vendidos à classificação aprovada e comprovar se houve montagem caracterizada como produção própria. |
| G04 · Modalidade e ST | A consulta de 18/11 ao Supabase de produção retornou zero registros em `representative_contracts`. O portal tem indicação, equipe e comissões. Esses elementos, isolados, não demonstram como o revendedor opera. Falta o contrato/regulamento comercial em uso e a confirmação do tratamento de ST para esse modelo. |
| G05 · Origem física | Sede fiscal em Ribeirão das Neves e coleta em Nova Serrana conforme o pacote. Falta a evidência de titularidade/guarda do estoque, contrato se houver terceiro e documento fiscal de remessa/depósito/retirada aplicável. |
| G06 · Crédito | O parâmetro de 1,36% de novembro foi informado no pacote. Em consulta de 18/11, havia zero registros para novembro na tabela de taxas aprovadas em produção. A configuração fiscal produtiva depende da prova da faixa de outubro e da aprovação registrada. |
| G07 · Nota | As naturezas consultadas anteriormente eram cadastros de homologação. Ainda são necessários o vínculo produtivo por cenário, as séries 002 e 003 com numeração conferida e o XML correspondente autorizado em homologação, com protocolo SEFAZ. |
| G08 · Pagamento, estoque e retorno | O fluxo de kits que cria transações continua exclusivo de teste. Falta consumir a cotação no mesmo commit do pedido, validar fiscalmente antes da cobrança, fechar a conciliação de estoque e implementar nota, despacho e devolução por perfil. |
| G09 · Segurança | Cotação e regras fiscais usam tabelas privadas. Rotas de kit conferem escopo no servidor. O webhook atual de kits atende transações de teste. A validação do futuro fluxo comercial deve incluir idempotência e isolamento da venda varejista. |
| G10 · Deploy | O trabalho está no [PR #136](https://github.com/curtiZ-Sistemas/curtiZ-ecommerce/pull/136). O CI da revisão de frete já passou. A produção ainda não contém as tabelas novas de cotação e de regras versionadas. |

### Próximos documentos necessários

1. Contrato vigente ou regulamento comercial dos representantes e descrição de como revendem aos clientes. Registrar o parecer correspondente para atacado, venda direta e ST.
2. Comprovante de quem guarda o estoque em Nova Serrana e documentos de movimentação ou retirada. Vincular a prova de aquisição ou produção e a classificação fiscal aos SKUs selecionados.
3. Para MG01, evidência da faixa de outubro. Para os perfis que forem homologados, consulta oficial do cadastro do comprador, natureza do Bling, série disponível e XML com protocolo SEFAZ. Guardar comprovantes em local privado.

### Verificações da revisão MG

- 86 testes focados de prévia, frete, transações e composição passaram localmente, incluindo a recusa das 26 UFs fora de MG. Lint dos arquivos alterados e checagem de tipos da loja passaram.
- Os testes SQL verificam restrição de endereço e cotação, uso único e isolamento de regras. A suíte de navegador cobre a mensagem de escopo e o frete MG. Consulte o workflow ligado à revisão no PR para o resultado dessas verificações.
- Reversão após publicação futura. Fechar o canal de kits antes de reverter o código. Preservar pedidos iniciados, permitir conciliação e reembolso e manter os registros fiscais e financeiros. Monitorar recusas fiscais, divergências de estoque, capturas e reembolsos pendentes, sem registrar documentos pessoais nos logs.

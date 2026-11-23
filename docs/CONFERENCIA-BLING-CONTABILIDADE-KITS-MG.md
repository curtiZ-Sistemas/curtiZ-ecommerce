# Conferência no Bling para o atacado da curti Z em MG

Olá! Preciso da sua ajuda com duas conferências no Bling para concluir a venda dos kits para revenda em Minas Gerais.

1. **Local de retirada.** O emitente fiscal fica em Ribeirão das Neves/MG. A saída física é pela Rua Antônio Pedro da Silva, 753, Romeu Duarte, Nova Serrana/MG, CEP 35524-168. Identifique no Bling qual estabelecimento responde fiscalmente por esse local e como o endereço deve aparecer no grupo `<retirada>` do XML da NF-e. Se houver uma NF-e ou escrituração de entrada/remessa que já registre esse local, indique o número ou envie o arquivo. O cadastro de entrega do varejo fica como está.
2. **NF-e de venda e devolução em homologação.** Procure a venda de atacado na série `003` em **Vendas → Notas fiscais de saída**. Procure a devolução própria na série `004` em **Estoque → Notas fiscais de entrada**. Se já estiverem autorizadas em homologação, selecione as notas e use **Exportar XML**. Preciso dos XMLs completos com os protocolos e da confirmação de qual foi a última utilização da série `004` em outro emissor da empresa, se houver.

Se os testes ainda não existirem, preciso saber qual ambiente do Bling pode homologar com esse emitente sem alterar o ambiente de emissão usado pelo varejo. A conta atual está em produção. A ideia é reaproveitar o que já existe e fazer somente os testes faltantes no ambiente separado.

A venda usa as naturezas já cadastradas da série `003`, com CFOP `5.102` e CSOSN `101` ou `102` conforme o cenário. A devolução própria usa a série `004` e referencia a chave da venda original. O endereço, os itens e os protocolos serão conferidos nos XMLs antes da liberação.

[Exportar XMLs no Bling](https://ajuda.bling.com.br/hc/pt-br/articles/360035753933-Como-exportar-o-XML-das-notas) · [Ambiente de emissão no Bling](https://ajuda.bling.com.br/hc/pt-br/articles/360035353594-Como-alterar-o-ambiente-de-emiss%C3%A3o-da-nota)

## Conferência já feita no Bling

- A NF-e de venda `000002`, série `003`, de 19/11/2026, foi localizada. O XML processado tem protocolo de autorização em produção, com status `100`, venda a consumidor final, CFOP `5.102` e 28 linhas no NCM `6402.20.00`. O emitente está em Ribeirão das Neves e o XML não contém o grupo `<retirada>`. Pode servir como referência do cadastro fiscal e dos itens cobertos.
- A NF-e de compra `011491`, série `002`, consta autorizada e documenta a aquisição de chinelos de um fornecedor de Nova Serrana pela curti Z. O destinatário no XML tem endereço em Ribeirão das Neves. O fornecedor consta em endereço diferente do ponto de retirada informado. O XML também não informa local específico de entrega ou retirada.
- No Bling, o depósito operacional disponível é `Geral`. A tarefa pendente do local de retirada é identificar qual estabelecimento responde pelo endereço confirmado e onde o vínculo fiscal aparece. Em homologação, continuam pendentes a venda de atacado com a retirada e a devolução própria vinculada à venda.

## Aprovação informada pelo proprietário em 22/11/2026

O proprietário informou que a contabilidade confirmou a operação de atacado em MG e aprovou o uso do grupo estruturado `<retirada>` para a saída física em Nova Serrana. A confirmação relatada orienta a configuração. O protocolo de autorização de cada nota deverá vir da SEFAZ.

- **MG02** usa `resale_in_state_no_credit`, natureza `15111725693`, CFOP `5102`, CSOSN `102` e série `003`. O Supabase de produção associa essa natureza a venda a não consumidor final.
- **Devolução própria** usa, quando a curti Z for responsável pela NF-e de entrada, a natureza informada `15111772281`, CFOP `1202` e série `004`. O cadastro atual em `private.bling_fiscal_natures` associa esse ID a consumidor final. Confirmar no emissor a natureza aplicável à devolução de revenda antes de vinculá-la ao MG02. A devolução emitida pelo comprador referencia a venda original; cancelamento antes da circulação segue o fluxo de evento da NF-e.
- **MG01** só usa CSOSN `101` quando houver crédito aplicável, com natureza e alíquota validadas para a competência. O percentual informado de novembro/2026 não se estende a outras competências. MG03 e demais perfis dependem de validação própria.
- O suporte do Bling informou que ainda não gera o grupo `<retirada>`. A conta da loja no Cloudflare não tem vínculo identificado para outro emissor. A rota de emissão precisa receber o endereço estruturado antes da assinatura e obter o XML processado e o protocolo diretamente do emissor. Conferir a numeração da série `003` e o histórico da `004` antes de autorizar o novo emissor a transmitir.


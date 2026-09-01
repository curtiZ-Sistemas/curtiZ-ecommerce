# Google Merchant Center

## Fonte automática

A loja expõe um feed XML público e atualizado em **https://curtiz.com.br/google-merchant.xml**.

O feed consulta o Supabase a cada geração e publica somente produtos e variações ativos. Preço, promoção e disponibilidade são calculados a partir dos dados atuais. Produto arquivado/excluído ou variação inativa deixa de aparecer; estoque zero permanece com `out_of_stock`.

Cada variação usa seu UUID como `id` estável e o UUID do produto como `item_group_id`. Cor e tamanho são enviados separadamente. O link inclui `?variant=<uuid>` e a página seleciona essa combinação, enquanto a canonical permanece no produto.

## Elegibilidade

No painel, abra o produto e acesse **Google Merchant**. O status mostra quantas variações estão elegíveis e os motivos reais de exclusão. Um produto incompleto continua publicado normalmente na loja.

Para entrar no feed, cada variação ativa precisa ter:

- título, descrição, categoria interna, cor, tamanho e preço válidos;
- imagem pública HTTPS de pelo menos 500 x 500 pixels;
- condição, gênero e faixa etária confirmados;
- confirmação sobre a existência de identificadores;
- GTIN/EAN real com checksum válido ou MPN real, quando o fabricante os fornecer.

Nunca use o SKU interno como GTIN/MPN e nunca invente identificadores. Se o fabricante realmente não fornecer GTIN nem MPN, selecione a opção correspondente. A categoria Google é opcional; vazia, a classificação automática é usada.

## Configuração no Merchant Center

1. Verifique e reivindique `https://curtiz.com.br` no Merchant Center.
2. Confirme Brasil, português e os programas de listagens gratuitas desejados.
3. Crie uma fonte de dados principal por busca programada usando a URL do feed acima.
4. Programe a busca diária; não é necessário usuário ou senha para essa URL.
5. Configure frete e política de devolução no nível da conta com as regras comerciais oficiais da empresa. O feed não fabrica esses valores.
6. Confira Diagnósticos, correspondência de preço/estoque e elegibilidade das listagens gratuitas antes de ativar campanhas.

A busca programada não exige nova variável de ambiente nem credencial do Google. As variáveis Supabase públicas já usadas pela loja continuam sendo as únicas necessárias para gerar o feed.

## Integração por API futura

Se uma sincronização via Merchant API for implementada futuramente, armazene o identificador da conta como variável server-side (`GOOGLE_MERCHANT_ACCOUNT_ID`) e a credencial da conta de serviço como secret do Cloudflare (`GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON`). Nunca use prefixo `NEXT_PUBLIC_` para credenciais e nunca grave o JSON no repositório.

## Operação

Os logs do Worker usam o evento `google-merchant-feed`, request ID, totais elegível/rejeitado e contagens agregadas por motivo. Eles não registram GTIN, MPN nem o catálogo completo. Falhas de Supabase retornam 503 para evitar que uma fonte vazia acidental substitua o catálogo; um catálogo legitimamente vazio retorna XML 200 sem itens.

Referências oficiais: [especificação de dados de produtos](https://support.google.com/merchants/answer/7052112), [variantes e item group ID](https://support.google.com/merchants/answer/6324507), [fontes programadas](https://support.google.com/merchants/answer/14991445) e [listagens gratuitas](https://support.google.com/merchants/answer/13889434).

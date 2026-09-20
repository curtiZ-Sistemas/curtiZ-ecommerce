# Homologação do Melhor Envio (Sandbox)

## Configuração

1. Crie conta e aplicativo próprios no Sandbox do Melhor Envio. Sandbox e produção são ambientes separados.
2. Cadastre a callback `https://<painel>/api/integrations/melhor-envio/callback` e o webhook
   `https://<loja>/api/webhooks/melhor-envio` no mesmo aplicativo.
3. Configure `SHIPPING_PROVIDER=melhorenvio`, `MELHOR_ENVIO_ENABLED=true`,
   `MELHOR_ENVIO_ENVIRONMENT=sandbox`, `MELHOR_ENVIO_BASE_URL=https://sandbox.melhorenvio.com.br`,
   Client ID/Secret, Redirect URI, nome da aplicação, contato
   técnico, chave AES-256 em base64 e todos os campos reais `MELHOR_ENVIO_ORIGIN_*`.
4. Acesse o painel técnico com MFA, inicie a conexão OAuth e confira o status sanitizado. Tokens não
   são copiados para `.env`, navegador ou logs.
5. Depois de cadastrar o webhook no aplicativo, defina `MELHOR_ENVIO_WEBHOOK_CONFIGURED=true`.

Nos Workers da loja e do painel, mantenha `MELHOR_ENVIO_CLIENT_SECRET`,
`MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY` e um entre `MELHOR_ENVIO_ORIGIN_DOCUMENT`/
`MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT` como secrets. As demais opções `MELHOR_ENVIO_*` são variáveis
server-side do ambiente; nenhuma delas usa prefixo `NEXT_PUBLIC_`.

No deploy deste repositório, configure as opções não secretas (`SHIPPING_PROVIDER`,
`MELHOR_ENVIO_ENABLED`, `MELHOR_ENVIO_ENVIRONMENT`, `MELHOR_ENVIO_BASE_URL`,
`MELHOR_ENVIO_REDIRECT_URI`, `MELHOR_ENVIO_CLIENT_ID`, `MELHOR_ENVIO_APP_NAME`,
`MELHOR_ENVIO_TECHNICAL_CONTACT`, `MELHOR_ENVIO_WEBHOOK_CONFIGURED` e campos de origem não
documentais) como variáveis do GitHub Actions; o workflow as passa ao build e aos dois Workers.
Configure os três tipos de segredo acima separadamente **em cada Worker** da loja e do painel.
Se usar build direto no Cloudflare, replique ali apenas as opções não secretas como Build Variables;
elas não substituem os secrets de runtime e os valores reais destes nunca devem ser Build Variables
em texto simples. O CI usa placeholders somente para validar o build, não como credenciais de runtime.

## Roteiro E2E

1. Adicione ao carrinho produtos ativos com peso e dimensões válidos.
2. No checkout, informe o CEP, calcule o frete, selecione uma cotação e confirme que alteração de CEP,
   item, variante ou quantidade exige nova cotação.
3. Pague com credenciais de teste do Mercado Pago. Pagamento pendente/rejeitado/cancelado não pode
   criar nem comprar etiqueta.
4. Após aprovação server-side, aguarde o cron (até cinco minutos) e confirme a criação automática da
   remessa Sandbox. No painel operacional, execute separadamente compra, geração, visualização/impressão
   e sincronização. Uma criação com resultado incerto exige reconciliação, nunca repetição automática.
5. Confira webhook válido, repetido e fora de ordem; a remessa não pode regredir e a etiqueta não pode
   ficar pública permanentemente.
6. Valide postagem e entrega automáticas do Sandbox. Teste cancelamento antes da compra, depois da
   compra quando cancelável e o encaminhamento operacional quando não cancelável.
7. Teste múltiplos volumes; serviços 1, 2 e 17 e transportadoras J&T/Loggi geram uma remessa por volume,
   com os produtos declarados daquele pacote. Outros serviços mantêm o conjunto de volumes aceito pela API.

Sem credenciais externas, os testes automatizados cobrem configuração/allowlist, parsing de cotação,
refresh, criptografia, falha incerta, assinatura e ordenação de webhook, além dos contratos estáticos
da migration. O ciclo remoto só pode ser homologado com conta, aplicativo e saldo Sandbox reais.

## Dados a solicitar aos sócios

- razão social/nome, e-mail e telefone do remetente;
- CPF ou CNPJ, Inscrição Estadual e CNAE quando aplicáveis;
- endereço completo e CEP de origem;
- contato técnico que constará no `User-Agent`;
- conta e aplicativo Sandbox; posteriormente, conta/aplicativo de produção separados;
- decisão fiscal documentada com o contador. Em produção comercial, a logística aguarda NF-e
  autorizada e sua chave real; CNPJ e Inscrição Estadual são obrigatórios nesse modo.

## Referências oficiais

- [Introdução, hosts e limitações do Sandbox](https://docs.melhorenvio.com.br/reference/introducao-api-melhor-envio)
- [OAuth e permissões](https://docs.melhorenvio.com.br/reference/fluxo-de-autoriza%C3%A7%C3%A3o)
- [Cotação por produtos](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos)
- [Inserção do envio e regras fiscais/DC-e](https://docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho)
- [Contrato e assinatura dos webhooks](https://docs.melhorenvio.com.br/docs/webhooks)

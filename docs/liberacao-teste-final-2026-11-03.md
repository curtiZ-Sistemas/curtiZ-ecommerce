# Preparação para compra real — 03/11/2026

## Situação

**Não liberar vendas reais ainda.** A revisão encontrou pendências fiscais e jurídicas que não podem ser resolvidas presumindo aprovação ou alterando flags para contornar os bloqueios. A compra, a emissão de NF-e e a etiqueta paga não foram executadas nesta conferência.

- A produção verificada estava no commit `522f4ff` da main, com o relatório do PR #115 publicado. Checkout estava desativado; Mercado Pago e Melhor Envio configurados para produção, prévia de frete e Resend habilitados. As flags fiscais estavam desativadas e a transmissão fiscal em homologação. A compra de etiqueta não tinha habilitação explícita.
- Não há política de automação fiscal aprovada no banco; cinco produtos ativos têm unidade fiscal ainda não aprovada. Validar unidades e classificação com o responsável fiscal, conferir a numeração efetivamente disponível das séries com todos os emissores e aprovar a política antes de habilitar a emissão. A validade do certificado informada no painel era 31/07/2027; isso não comprova a autorização da primeira nota.
- Os dois vínculos de produtos Bling ainda apareciam pendentes, sem jobs correspondentes pendentes ou com falha. Conferir os dados reais no Bling pelo fluxo autorizado antes de concluir a conciliação. Não marcar como sincronizados sem evidência nem reenviar dados fiscais não aprovados.
- A política de privacidade publicada ainda tem marcadores a completar, inclusive informações sobre transferências internacionais; a minuta e o levantamento existentes precisam de revisão jurídica e publicação. Backup recente tem evidência de integridade, mas falta restauração recente em destino isolado e vazio.
- O Resend comercial estava habilitado e há evidência histórica de entrega; confirmar a entrega do e-mail da compra real. E-mails transacionais são distintos do SMTP e dos templates do Supabase Auth. Um webhook real assinado de frete e o fluxo completo de pagamento e expedição ainda não foram comprovados nesta etapa.

## Ajuste preparado nesta etapa

O prazo informado na prévia e no checkout passa a incluir até cinco dias úteis de preparação, coerente com a política publicada, e o prazo total é salvo na cotação para acompanhar o pedido. O Melhor Envio pode retornar um prazo personalizado que já inclui acréscimos configurados na plataforma; somar a preparação é conservador e pode contar parte da margem duas vezes. Conferir a configuração do provedor antes de reduzir essa margem. O preço de frete e o estoque não são alterados por esse ajuste.

As quatro views públicas analisadas filtram conteúdo público e suas tabelas de origem não concedem SELECT ao visitante. Alterá-las diretamente para `security_invoker` quebraria essas consultas. Foi preparado um teste adicional em banco isolado para acesso anônimo, filtros e campos internos; ele não substitui a análise dos demais avisos do Advisor.

## Roteiro para os sócios após saneamento e liberação

1. Confirmar política de privacidade, fiscal, certificado, numeração, estoque e prévia de frete; habilitar checkout e emissão apenas após esses requisitos e autorizações aplicáveis. Conferir flags nos Workers e manter identificados os dados de rollback.
2. Fazer a primeira compra real: conferir valor e prazo antes de pagar, aprovação no Mercado Pago, webhook e idempotência, reserva/baixa de estoque uma vez e entrega do e-mail transacional. Conferir pedido no painel e no Bling.
3. Somente com autorização aplicável para emissão e custos, emitir a primeira nota e verificar sua autorização e vinculação ao pedido; só então comprar a etiqueta, conferir rastreio, acompanhar webhook assinado e entrega e validar o e-mail de avaliação.
4. Em uma segunda compra, validar cancelamento e eventual reembolso real somente com autorização aplicável. Conferir estado no Mercado Pago e na loja, liberação de estoque uma vez e ausência de cobranças ou mensagens duplicadas.

Os testes automatizados locais são sintéticos. Eles não demonstram que uma cobrança, uma nota, uma etiqueta ou um webhook real foram processados.

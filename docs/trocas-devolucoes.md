# Trocas, devoluções e reembolsos

O cliente inicia em `/minha-conta/trocas`, escolhendo item entregue, quantidade, tipo e solução desejada. Motivo, descrição e até três fotos são opcionais, para que o arrependimento não dependa de justificativa ou prova de defeito. Fotos JPG, PNG e WebP de até 5 MB são validadas e regravadas como WebP; ficam em bucket privado e são acessíveis por autorização temporária ao titular e à equipe autorizada.

## Responsabilidades

- Administração e gerência: `/administracao/devolucoes` e `/gerencia/devolucoes`, respeitando `returns.approve` e `returns.refund`. Avaliam, respondem ao cliente, autorizam retorno, fornecem instruções de postagem e solicitam o reembolso.
- Operação: `/operacional/trocas` e `/operacional/devolucoes`, respeitando `returns.inspect`. Registra postagem, recebimento e inspeção física. A inspeção registra o destino proposto; não aumenta estoque automaticamente. Use o processo existente de ajuste de estoque e sua aprovação.
- Cliente: acompanha histórico, resposta, autorização de postagem, rastreio do retorno, envio da troca e situação do reembolso. Pode acrescentar fotos enquanto a solicitação estiver em análise.

## Regras e orientações ao consumidor

No arrependimento de compra online, o cliente deve comunicar sua decisão em até sete dias corridos do recebimento. A devolução é gratuita e o reembolso integral inclui o frete pago. Abrir a embalagem ou experimentar para conhecer o produto não elimina esse direito. Não condicione o direito a fotos, embalagem inviolada, justificativa ou crédito na loja. O código permite registrar solicitações fora do período ou sem data confiável para análise humana; não rejeita automaticamente nem presume perda de garantia.

Para defeitos aparentes em calçados, o prazo para reclamar é de 90 dias. Para vício oculto, conta-se da descoberta. Em regra, há até 30 dias para sanar o vício, observadas as exceções do CDC para solução imediata. Troca por preferência fora do arrependimento segue as condições comerciais informadas na compra; este fluxo não cria um prazo promocional ou uma gratuidade comercial adicional.

O cliente deve aguardar a autorização/etiqueta de retorno, embalar o produto, postar no ponto indicado e guardar o comprovante. A equipe emite a autorização no serviço logístico contratado e informa código, local, validade e instruções no painel. Não há compra automática de logística reversa. O código de autorização de postagem é distinto do código de rastreamento.

## Reembolso e confirmação

A solicitação de reembolso exige autorização humana. O Worker processa a fila em seu agendamento existente, valida ambiente, titularidade, referência, moeda, valor original e estornos anteriores no provedor. O valor vem do banco, com rateio dos valores pagos e do frete original; a alocação acumulada conserva centavos e limita o total ao pagamento. O crédito na loja continua sendo uma solução solicitada pelo cliente, sem criar saldo fictício: sua concessão precisa de implementação financeira própria antes de ser confirmada.

Cada solicitação financeira tem uma chave estável. Um timeout, erro de confirmação ou lease expirado interrompe novas tentativas automáticas e exige conciliação. “Reembolsado” só aparece após uma confirmação validada do provedor; a disponibilização em conta/fatura depende do meio de pagamento. O fluxo de cancelamento anterior ao despacho permanece separado. Não reutilize sua finalização para devoluções parciais.

Os comprovantes de devolução ficam em `returns.refund_amount` e `refund_provider_id`, com histórico e auditoria; `payment_refunds` permanece dedicado ao contrato anterior de cancelamento. Não altere essa tabela para liberar estornos repetidos. Em caso de conciliação, confira a operação no provedor antes de qualquer nova solicitação.

## Publicação e notificações

Aplicar a migration incremental e os testes de banco antes dos Workers. O novo processamento usa as credenciais já existentes, sem expor secrets ao navegador. `RETURNS_EMAIL_ENABLED=true` habilita exclusivamente os avisos de troca/devolução pelo Resend; `EMAIL_ENABLED` mantém seu significado para os e-mails comerciais já existentes. Os avisos não incluem fotos ou descrições pessoais e direcionam para a conta autenticada. Não há envio retroativo para solicitações antigas.

O checkout remoto estava configurado em modo de teste durante a investigação de 28/10/2026. Isso não comprova habilitação ou homologação de reembolsos reais. Preserve as travas existentes do Mercado Pago.

O ambiente de homologação tinha uma minuta; a produção já tinha uma política publicada com regras compatíveis. A política vigente e seu histórico são preservados. As orientações deste arquivo não registram uma nova revisão jurídica.

Referências consultadas em 28/10/2026: [CDC, arts. 18, 26 e 49](https://presidencia.gov.br/ccivil_03/leis/l8078compilado.htm), [Procon-SP — comércio eletrônico](https://www.procon.sp.gov.br/wp-content/uploads/2020/11/GuiadeComercioEletronicoELEICOES2020-2.pdf), [Senacon — arrependimento e restituição](https://www.gov.br/mj/pt-br/assuntos/arquivos-imprensa/senacon/cartilha-black-friday-senacon-2025).

# Cartões salvos e checkout

`MERCADO_PAGO_SAVED_CARDS_ENABLED` é uma flag **somente do servidor**, desativada por padrão.
O checkout tradicional continua disponível quando a flag está ausente, quando Customers/Cards
falha ou quando o cliente não é compatível com o ambiente de teste. Nenhum guard TEST foi removido.
Não definir essa variável com prefixo `NEXT_PUBLIC_`.

## Contrato oficial e sequência

Referências oficiais consultadas em 13/09/2026:

- [Customers/Cards e pagamento com cartão salvo](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/how-tos/payment-approval/saved-cards)
- [Payment Brick: customerId e cardsIds](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/advanced-features/customers-cards)
- [Card Payment Brick e tokenização](https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md)
- [Criar Customer](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/customers/create-customer/post)

O Payment Brick continua responsável pelo pagamento. Apenas no envio de um cartão novo,
com a funcionalidade habilitada, aparece a opção de salvar, inicialmente desmarcada. Pix e
boleto não oferecem essa opção. Após aprovação e opt-in, um **Card Payment Brick separado**
pede confirmação do cartão e gera um token novo exclusivamente para salvamento. Esse callback
chama somente `POST /api/customer/cards`; nunca cria pagamento. Não reutiliza o token consumido
pela compra. O cliente pode continuar sem salvar. Falhas de salvamento mantêm a aprovação.
Esta etapa adicional de confirmação é intencional: não assumimos reutilização de CardToken.
Se o cartão gerar pagamento pendente, o acompanhamento existente tem prioridade; não tentamos
salvar com o token usado nem criamos tarefa que retenha esse token.

Na próxima sessão, o backend consulta os cartões do Customer associado ao usuário autenticado,
filtra vencidos/inválidos e retorna só id, bandeira, last4 e validade. O Payment Brick recebe
`payer.customerId` / `payer.cardsIds`. Um cartão salvo exige um token novo emitido pelo SDK;
o backend confere o `card_id` do token contra a lista do Customer próprio. A API de pagamento
envia `payer.type=customer` / `payer.id` somente depois dessa verificação. CVV e sua validação
continuam exclusivamente nos campos oficiais e no provider.

A associação do Customer é conferida no banco antes da criação lógica do checkout. A validação
do token novo ocorre somente quando uma cobrança nova será enviada; retries de pagamentos
conhecidos consultam o provider e não exigem revalidar um token já consumido. Falhas de consulta
do token antes do envio da cobrança recusam somente aquela tentativa e permitem uma chave nova.

## Persistência, ownership e concorrência

A migration `202609130002_mercadopago_saved_cards.sql` adiciona:

- `payment_provider_customers`: user/profile, provider, modo, customer_id e estado/chave de criação.
- `payment_provider_card_operations`: chave da operação, Customer local, pedido aprovado,
  estado, referência do cartão e timestamps. Nenhum token, CPF ou campo de cartão.
- Limite de 20 requests/minuto por usuário em tabela privada acessível somente por RPC do servidor.

As tabelas públicas têm RLS para leitura própria. Clientes não possuem permissão de escrita nem
execução das RPCs de associação. Todas as mutações usam service_role após autenticação, origem,
ownership e rate limit. `GET/POST/DELETE /api/customer/cards` são no-store. Exclusão verifica a
associação do Customer e o cartão nele, e usa `audit_logs` com referências sanitizadas.
A seção Cartões salvos fica em Minha conta → Perfil, aparecendo apenas quando disponível.

O Customer é criado com email **confirmado pelo auth**, nunca um email ou Customer arbitrário do
browser, e um marcador definido pelo servidor contendo o usuário/modo. Recuperação por email
também exige esse marcador. Constraints e claims sob lock serializam criação e salvamento.
`X-Idempotency-Key` é enviado defensivamente; a garantia local não presume suporte não documentado
desse header nas APIs Customers/Cards. Respostas incertas não liberam um segundo POST.

Se uma resposta de criação de Customer se perder, a próxima chamada pode recuperar o Customer
pela busca oficial com email e marcador exatos. Se não houver confirmação, permanece `creating`.
Se uma resposta de salvamento se perder, a operação permanece `processing` e impede novo
salvamento automático. Não há retry de token, nem liberação por timeout. A reconciliação exige
verificação pelo operador da lista oficial de cartões/Customer e atualização controlada do estado,
sem recriar associação às cegas. Isso não bloqueia pagamento/checkout tradicional.

PAN, CVV, trilha, dados Secure Fields e tokens temporários nunca são persistidos no banco,
storage do navegador, logs ou analytics. Tokens são usados apenas na memória da requisição/callback.
Cartões ficam armazenados exclusivamente no Mercado Pago. Não há cache local de metadata de cartões
além da referência de uma operação concluída; a lista é consultada no provider.

Voltar antes de uma tentativa restaura o snapshot em memória do formulário e mantém endereço,
cupom, carrinho e chave lógica. Desmonta o Brick antes da transição, sem reload. Durante request,
Voltar é bloqueado; após pedido vinculado ou resposta incerta, acompanha/verifica o mesmo pedido
em vez de permitir novo checkout. Nenhuma regra de criação de pedidos/idempotência foi substituída.

## Validação e ativação

Aplicar a migration de cartões e a anterior de identidade/tentativas antes de habilitar a flag.
Os testes automatizados isolam SDK, API e banco; não constituem homologação real do Mercado Pago.
As RPCs/RLS também possuem teste pgTAP para execução em Supabase local/CI.

Customers TEST exige email no formato documentado `test_payer_[0-9]{1,10}@testuser.com`.
Na configuração atual, clientes com emails comuns não ativam cartões salvos. É necessário
homologar com usuário de teste apropriado, email confirmado, Customer da mesma aplicação e
credenciais TEST compatíveis. Validar criação/listagem/exclusão, token novo para salvar,
pagamento com cartão salvo/CVV, recusas, respostas perdidas e isolamento entre usuários.
Não alterar credenciais ou guards existentes para habilitar isso à força.

Produção está **preparada no modelo de dados**, separando referências TEST/produção, mas o provider
continua aceitando somente TEST. A liberação futura requer homologação real, revisão dos guards
e consentimento, além de credenciais/customer da aplicação produtiva. Esta implementação não
declara cartões salvos prontos para produção.

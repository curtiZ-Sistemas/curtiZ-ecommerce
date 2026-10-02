# E-mails transacionais da curti Z

A integração envia somente compra confirmada e solicitação de avaliação, 24 horas após a confirmação da entrega integral. Os triggers capturam novas transições persistidas, e o cron da loja processa os envios. Não existe endpoint público para enviar mensagens ou escolher destinatários.

## Configuração e ativação

Aplique primeiro `supabase/migrations/202610020002_resend_transactional_email.sql` em um banco isolado e execute `supabase test db`. A migration depende das migrations atuais, inclusive a do Bling. Depois da validação, aplique-a no ambiente de destino pelo processo habitual, antes de publicar o Worker. Esta tarefa não aplica migrations remotas nem envia mensagens reais.

Configure no Worker **da loja** `curtiz-ecommerce` (produção) ou `curtiz-ecommerce-staging` (staging). Use o Supabase isolado de homologação em staging: política de ativação, filas e indicador pertencem ao banco, e não devem ser compartilhados entre os dois ambientes.

| Binding | Tipo no Cloudflare | Valor/configuração |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret | Chave do Resend para enviar e consultar os e-mails; a consulta de recibos precisa de permissão de leitura (`Full access`). |
| `EMAIL_PROVIDER` | Variável comum | `resend` |
| `EMAIL_ENABLED` | Variável comum | `true` para ativar; `false` interrompe envios |
| `EMAIL_FROM` | Variável comum | Remetente do domínio verificado; aceita endereço ou `curti Z <endereço>` |
| `EMAIL_REPLY_TO` | Variável comum, opcional | Caixa de atendimento real; na ausência usa o endereço de `EMAIL_FROM` |
| `NEXT_PUBLIC_STORE_URL` | Variável comum de runtime, além do build existente | Origem HTTPS real da loja, sem caminho, query ou credenciais |
| `SUPABASE_URL` | Variável comum existente | Origem do projeto Supabase |
| `SUPABASE_SECRET_KEY` | Secret existente | Chave exclusiva do servidor; aceita o nome legado `SUPABASE_SERVICE_ROLE_KEY` |

Não copie `RESEND_API_KEY` para o Worker do painel. O indicador técnico lê `integration_health.provider=resend_store`, atualizado pelo cron da loja; após 15 minutos sem verificação mostra indisponibilidade. Não mostra chave, endereço de cliente ou conteúdo da mensagem.

`RESEND_FROM_EMAIL` é somente fallback quando `EMAIL_FROM` está ausente. O envio fiscal existente `sendInvoiceEmail`, `BLING_INVOICE_EMAIL_ENABLED` e suas configurações permanecem separados e inalterados. Os dois novos modelos não enviam nem anunciam outra nota fiscal.

No Resend, adicione o domínio/subdomínio remetente. Copie **os valores apresentados pelo Resend** para os registros DNS de DKIM (TXT) e SPF (TXT), e o MX do subdomínio de retorno exigido para envio. Verifique os registros até o domínio ficar confirmado. Se usar Cloudflare DNS, registros de correio devem ficar sem proxy. DMARC é recomendado; preserve e concilie a política existente, sem criar registros SPF duplicados no mesmo nome. Não altere o MX principal da caixa de atendimento para habilitar recebimento no Resend: esta integração só envia. O endereço de resposta precisa receber mensagens pelo serviço de e-mail da loja. Veja a [documentação oficial de domínio](https://resend.com/docs/dashboard/domains/introduction).

O GitHub Actions continua construindo com `EMAIL_PROVIDER=disabled` e `EMAIL_ENABLED=false`; a chave não é necessária no build. O handler agendado usa diretamente os bindings recebidos do Cloudflare. Preserve `keep_vars: true` e `--keep-vars`, existentes nos comandos de deploy; não acrescente flags de e-mail desativadas em `wrangler.jsonc` nem sobrescreva bindings de runtime com os valores do build.

Depois da configuração e publicação, aguarde a primeira execução do cron de cinco minutos e confira o indicador Resend. Ela registra a ativação; pedidos já aprovados/entregues não são importados. Pagamentos que estavam pendentes e forem aprovados depois dessa ativação são eventos novos e geram confirmação. Se desativar, tarefas ainda não enviadas são canceladas; tarefas com tentativa anterior ficam para reconciliação. Reativar não recupera mensagens antigas canceladas.

## Garantias e diagnóstico

- Pagamento aprovado precisa existir em `payments` com provider Mercado Pago e identificador do pagamento, e o pedido precisa ter aprovação persistida e estado comercial compatível. A página de sucesso não agenda e-mail.
- A entrega final de todas as remessas atualiza `orders.status=delivered` e seu histórico, respeitando os bloqueios fiscais e estados terminais. Remessa parcialmente entregue não libera avaliação. Atrasos e repetições não regridem remessas entregues nem reiniciam o prazo.
- A solicitação utiliza `/minha-conta/avaliacoes`. A tela existente direciona ao login com retorno seguro à mesma seção. Produtos já avaliados, inclusive com avaliação em moderação, são excluídos. Quando todos estão avaliados, a tarefa é cancelada antes do envio.
- `background_jobs.queue=transactional_email` contém somente identificadores. Payload e destinatário ficam em tabelas privadas com RLS e sem acesso dos clientes. A mensagem e sua chave são únicas por pedido e tipo.
- O lease de cinco minutos impede dois Workers de enviar simultaneamente. Antes de cada envio, a elegibilidade é verificada novamente. O primeiro payload fica congelado para repetir exatamente os mesmos parâmetros com a chave de idempotência persistida.
- Timeout, respostas incertas e indisponibilidade têm retentativas progressivas, no máximo oito tentativas de envio. `Retry-After` é respeitado. Falha ao guardar um recibo também é incerta. Respostas permanentes não entram em repetição infinita.
- Uma tentativa iniciada há 23 horas ou mais não pode ser reenviada automaticamente: fica `reconciliation_required`. A margem evita ultrapassar a [janela de 24 horas do Resend](https://resend.com/docs/dashboard/emails/idempotency-keys). O registro local permanece depois dessa janela.
- O ID do Resend é persistido como **aceito**, e depois consultado pela API para distinguir entrega, bounce, reclamação e supressão. `suppressed` registra falha definitiva de entrega e encerra as consultas, sem reenviar. A consulta não faz novo POST. O acompanhamento tem até 48 verificações; sem confirmação, o estado permanece aceito, sem inventar entrega. Falhas na consulta ficam visíveis na fila. A [API de consulta](https://resend.com/docs/api-reference/emails/retrieve-email) fornece `last_event`.

Para um resultado incerto sem recibo salvo, um técnico deve verificar o Resend e conferir a tag `curtiz_message` com o UUID da mensagem, tipo e pedido. Se encontrar uma mensagem aceita, pode anexar o ID real com a RPC **exclusiva de serviço** `reconcile_transactional_email(p_message_id,p_provider_id)`. Essa operação não envia mensagem e habilita somente consultas de entrega. Não resete a tarefa para forçar um novo envio nem invente IDs. Se não for possível provar o resultado, mantenha o bloqueio.

Falhas de armazenamento na captura do evento geram o aviso sanitizado `transactional_email_enqueue_failed` e preservam a transação comercial. Não há backfill automático para esses casos: investigue esse aviso antes da ativação ampla. Nenhum sistema pode prometer entrega na caixa de entrada; bloqueios do destinatário e indisponibilidade externa continuam possíveis.

## Validação antes de publicar

Execute os testes relacionados de config, templates, adaptador, runner e indicador; execute typecheck/lint/build dos workspaces afetados sequencialmente. Rode `supabase/tests/resend_transactional_email_test.sql` em banco isolado migrado para validar triggers, permissões, prazo, leases e recibos. Testes com mocks não comprovam execução SQL ou concorrência entre sessões reais.

No staging, valide o bundle OpenNext/Worker e o cron com bindings reais, use somente destinatários de teste autorizados e confirme o retorno após login. Revise HTML e texto em clientes móveis e desktop. Sem Docker/banco local, pgTAP precisa ser executado no CI/banco isolado antes da ativação. Nenhum teste automatizado desta integração envia e-mails reais.

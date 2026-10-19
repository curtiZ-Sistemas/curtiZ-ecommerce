# Preparação de produção — verificação de 19/10/2026

Escopo: somente leitura (Cloudflare, Supabase, Resend via MCP; código e git local). Nenhuma escrita em serviços externos, nenhum valor sensível lido ou registrado. Vendas reais **não** foram habilitadas.

Legenda: **Configurado** · **Testado** · **Homologado** · **Publicado** · **Ativado comercialmente** · **Pendente de autorização**.

## 1. Cloudflare
- O MCP expõe só nome e id dos Workers (`curtiz-ecommerce`, `curtiz-painel`). **Variáveis, secrets, cron e rotas não são legíveis** por essa via; nada foi alterado.
- Proteção do checkout comprovada no código (`packages/config/src/mercadopago.ts:6-19`): `test` só aceita credenciais `TEST-`; `production` só vale com `MERCADO_PAGO_PRODUCTION_READY=true` e credenciais `APP_USR-`. `CHECKOUT_ENABLED` sozinho não autoriza cobrança real (`packages/config/src/integrations.ts:157`).
- Pendência do proprietário: conferir no painel Cloudflare os valores do quadro de variáveis esperado (flags comerciais, ambientes `test`/`sandbox`, `EMAIL_ENABLED=false`, flags fiscais `false`, `AUTH_RATE_LIMIT_ENABLED=true`) nos dois Workers.

## 2. Mercado Pago (via Supabase)
| Item | Evidência |
|---|---|
| Pagamentos | 12 `cancelled`, 7 `pending` (mais antigo 08/09). Nenhum aprovado. |
| Pedidos presos | 5 `pending_payment` + 2 `cancellation_requested` com pagamento `pending`, de 08–14/09 (testes antigos). |
| Tentativas | 10 canceladas com `provider_request_rejected` (última 17/10 13:22), 1 `by_collector`, 1 `expired`, 1 `pending_waiting_transfer`. |
| Webhooks | 4 eventos, todos `processed` e `signature_valid=true`; último 15/10. |
| Código `10111` | Não aparece em nenhum campo armazenado (`status_detail` guarda só o rótulo genérico). Sem diagnóstico novo; ver recomendação ao Codex. |
| Saúde | Não existe linha `mercadopago` em `integration_health`. |
- Webhook esperado `https://curtiz.com.br/api/webhooks/mercadopago` não é verificável sem acesso ao painel do Mercado Pago.

## 3. Melhor Envio
- Credencial `melhorenvio/sandbox` conectada; saúde `online` (painel 15/10, loja 17/10); origem completa; webhook configurado; sem reencriptação pendente.
- 40 cotações, todas `sandbox`, última 17/10 19:47. Nenhum evento em `shipping_webhook_events` (esperado: nenhuma etiqueta criada).
- Nada de produção migrado; nenhuma etiqueta criada.

## 4. Bling / fiscal
- Credencial `bling/production` conectada; conta `api_healthy=true`, verificada em 15/10.
- 6 linhas em `bling_fiscal_natures` (3 cenários × consumidor final sim/não), todas com `external_nature_id`.
- `bling_fiscal_automation_policy` **vazia**: não há hash de configuração aprovado, portanto a automação fiscal segue **não aprovada**.
- Jobs: 3 533 `completed`, 1 `reconciled`, 5 `failed` (4 `external_sku_changed`, 1 `uncertain_write`). 1 782 webhooks, todos `ignored`.
- Certificado digital e flags `BLING_*` não verificáveis por MCP. Nada emitido ou transmitido.

## 5. Resend
- `curtiz.com.br`: **verified**, envio habilitado, região `sa-east-1`. DKIM, SPF (MX/TXT) e CNAME de retorno: verified.
- **DMARC não aparece** nos registros do Resend; precisa ser conferido no DNS (`_dmarc.curtiz.com.br`).
- 0 templates hospedados (o HTML é gerado pelo app — esperado). 2 chaves de API (nomes não sensíveis): "curtiZ loja — email 20261012" e "curtiZ loja - transacionais e consulta de entrega"; confirmar qual está em uso e revogar a obsoleta.
- **0 webhooks** configurados: sem acompanhamento de bounce/complaint.
- `private.transactional_emails` vazia; `email_deliveries` vazia; `transactional_email_runtime.enabled=false`; `integration_health.resend_store=not_configured (email_disabled)`. Último envio real foi controlado (2 `POST /emails`, 17/10, via MCP).
- Remetente e Reply-To só são verificáveis no código/Worker.

## 6. Supabase / segurança
- 17 migrations aplicadas (última `bling_kit_fiscal_decomposition`, 17/10 20:00). Comparação com migrations locais/pendentes **não feita** (Codex tem migrations em andamento).
- Advisors de segurança:
  - ERROR `security_definer_view` ×4: `current_store_promotion_messages`, `published_homepage_sections`, `published_help_contents`, `published_legal_documents` (provável intencional para leitura pública; revisar).
  - WARN funções SECURITY DEFINER executáveis por `anon` ×24 (RPCs públicas da loja) e por `authenticated` ×143.
  - WARN `auth_leaked_password_protection` desligado (ação no painel do Auth).
  - INFO 34 tabelas com RLS e sem policy (`private.*` e outras): padrão deny-all, coerente se acesso é só por funções.
- Nenhuma alteração aplicada.

## 7. Recuperação de senha / SMTP
- Os MCPs não oferecem leitura/edição de SMTP, templates, redirect URLs ou limites do Supabase Auth. **Limitação registrada**; sem SQL em configuração interna do Auth.

## 8. Backup e restauração
- Os branches `ops/verified-isolated-restore-20261018`, `ops/isolated-native-restore-20261018` e `fix/restore-managed-default-privileges-20261018` (commits de 18/10) já constam como mesclados em `origin/main`; isso comprova código e procedimento, não uma execução. **Não há registro de restauração isolada aprovada** (relatório com contagens e decisão `aprovado`). Não considerar o backup validado.

## 9. Políticas jurídicas
Confirmado: 19 documentos `draft`, 0 publicados, 0 versões, 0 revisões; `company_legal_information.completeness_status=review`.

**Bloqueios de publicação**
1. `company_legal_information` sem e-mail, telefone, canal de privacidade, encarregado/contato de privacidade e canal de suporte (existem razão social, nome fantasia, CNPJ e endereço). Isso alimenta `[EMAIL_ATENDIMENTO]`, `[CANAL_PRIVACIDADE]`, `[CONTATO_PRIVACIDADE]`.
2. Placeholders restantes, que dependem de decisão do proprietário:
   - `entrega`: `[PRAZO_PREPARACAO_CONFIRMADO]`.
   - `aviso-de-privacidade`: `[DESTINOS_INTERNACIONAIS_CONFIRMADOS]`, `[MECANISMOS_LGPD_CONFIRMADOS]`, `[PRAZOS_ANALISE_CONFIRMADOS]`.
   - `politica-de-cookies`: `[INVENTARIO_TERCEIROS_CONFIRMADO]`.
   - `termos-representante` (seção 14): `MODALIDADE_E_ATIVIDADES`, `PRODUTOS_CANAIS_TERRITORIO_EXCLUSIVIDADE`, `QUALIFICACAO_E_NIVEIS`, `CONDICOES_DOS_KITS`, `ATRIBUICAO_DAS_VENDAS`, `REGRA_DE_REMUNERACAO`, `CALENDARIO_E_PAGAMENTO`, `PRAZO_E_ENCERRAMENTO`, `AUTORIZACOES_DE_MARCA`, `IDENTIFICACAO_E_ACEITE`.
3. 11 das 19 minutas são modelo de 430 caracteres (3 seções): acessibilidade, atendimento, avaliações, avisos legais, cancelamento, comissões, criativos, cupons e promoções, direito de arrependimento, kits e qualificação, segurança. `direito-de-arrependimento` e `cancelamento` precisam de conteúdo ou de remissão explícita às políticas de trocas e termos, que já tratam do tema.

**Revisão das 8 principais** (sem certificação jurídica; vigência das normas e referências "acesso em 3 out. 2026" exigem confirmação externa)
- `termos-de-uso`, `trocas-e-devolucoes`, `garantia`, `entrega`, `pagamento`: coerentes entre si e com o funcionamento descrito (sem retirada presencial, endereço empresarial não é ponto de devolução, arrependimento de 7 dias com frete original, 90 dias para vício aparente, 5 dias para resposta). Ajustes: (a) preencher placeholders; (b) em `pagamento` §2, manter Pix/cartão/débito/boleto como "conforme exibido no checkout" e confirmar quais estão realmente habilitados no Mercado Pago antes de publicar; (c) confirmar que `/atendimento`, `/minha-conta` e `/privacidade/solicitacoes` existem em produção.
- `aviso-de-privacidade`: §6 afirma que o Resend armazena dados nos EUA, enquanto o domínio de envio está em `sa-east-1`; validar a informação com a documentação do fornecedor. Completar destinos internacionais (Supabase, Cloudflare), mecanismo do art. 33 da LGPD e prazos de análise. Resoluções ANPD citadas (inclusive "nº 32/2026") e a Lei 15.211/2025 precisam de conferência.
- `politica-de-cookies`: inventário coerente com o código descrito; completar `[INVENTARIO_TERCEIROS_CONFIRMADO]` (Mercado Pago e Cloudflare no navegador).
- `termos-representante`: cautelosos com Lei 4.886/1965; só podem ser aceitos com o Quadro de Participação (seção 14) preenchido. Recomendação: não publicar até definir a modalidade e a remuneração.

**Mecanismo de edição:** não foi usado nenhum caminho de escrita. Edições devem passar pelo fluxo de versionamento do sistema (`legal_document_versions`/painel). Nenhuma tabela foi modificada.

## 10. Recomendações ao Codex (sem implementação paralela)
1. Persistir o código de erro do provedor (ex.: `10111`) em `payment_attempts`/`payment_events` para diagnóstico; hoje `status_detail` guarda só `provider_request_rejected`.
2. Registrar `integration_health` para `mercadopago` e `bling`.
3. Limpar/expirar os 7 pagamentos `pending` de teste de setembro pelo fluxo de cancelamento existente.
4. Revisar as 4 views `SECURITY DEFINER` (preferir `security_invoker` onde não precisar contornar RLS).
5. Criar webhook do Resend para bounce/complaint quando o e-mail for ativado.

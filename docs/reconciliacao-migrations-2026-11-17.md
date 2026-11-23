# Conferência de migrations de produção — 17/11/2026

Atualização após o PR #143, na main `cf9040f48ea8139013639c5da92cb5bd05a9b45e`: a comparação de leitura encontrou 215 arquivos SQL e 81 registros em produção. Há 26 pares com versão e conteúdo coincidentes, incluindo 9 migrations de segurança com versões de 17/11. Outros 21 pares têm conteúdo idêntico sob versões diferentes e estão na tabela abaixo.

Dos demais registros de produção, 12 têm a mesma versão de um arquivo, mas o conteúdo armazenado não bate pelo método de comparação. Outros 22 não têm uma versão correspondente nem uma correspondência única pelo conteúdo. No repositório, 168 arquivos ainda não têm correspondência comprovada por essa verificação. Esses números incluem possíveis diferenças no registro histórico e não determinam quais mudanças faltam no schema.

A reconciliação exige validar os registros divergentes contra a origem e o estado do banco. Não marcar arquivos como aplicados nem reaplicar migrations antigas sem essa evidência.

## Comparação complementar sem espaços externos

Para os registros armazenados como um único elemento, foram normalizadas as quebras de linha e removidos apenas espaços, tabulações e quebras de linha no início e no fim do SQL. O conteúdo intermediário foi preservado. A comparação identificou mais 29 pares únicos: 10 com o mesmo número de versão e 19 com números diferentes. Esses pares se somam aos 47 da comparação anterior, que não removia espaços externos.

| Produção | Arquivo na main |
| --- | --- |
| 20261015142727 | `20261015135129_fix_published_help_expiration.sql` |
| 20261017175643 | `20261017175643_part1_fiscal_automation.sql` |
| 20261017200032 | `20261017200032_bling_kit_fiscal_decomposition.sql` |
| 20261021222155 | `20261021220001_cancel_refund_webhook_race.sql` |
| 20261021230354 | `20261021225251_bling_order_homologation_scope.sql` |
| 20261022114721 | `20261022112116_representative_resale_preflight_gate.sql` |
| 20261022165651 | `20261022162930_representative_existing_kit_catalog.sql` |
| 20261023191307 | `20261023160000_representative_test_transactions.sql` |
| 20261023191329 | `20261023161000_representative_test_transaction_context.sql` |
| 20261023191335 | `20261023162000_representative_test_reconciliation.sql` |
| 20261023191341 | `20261023163000_representative_test_stock_audit.sql` |
| 20261023191346 | `20261023164000_representative_test_payment_creation_guard.sql` |
| 20261023191354 | `20261023165000_representative_test_expiration.sql` |
| 20261023191359 | `20261023170000_representative_test_order_identity.sql` |
| 20261024203304 | `20261024200616_bling_monthly_credit_and_return_policy.sql` |
| 20261025114033 | `20261025111315_bling_monthly_credit_legacy_rate_optional.sql` |
| 20261026120219 | `20261026112700_melhor_envio_homologation_scope.sql` |
| 20261026172424 | `20261026170000_bling_return_archive_context.sql` |
| 20261026172428 | `20261026170100_bling_return_balance_lock_order.sql` |
| 20261029094356 | `20261029094356_return_review_status_cast.sql` |
| 20261101130136 | `20261101121439_intelligence_retention_worker.sql` |
| 20261101130147 | `20261101123450_reconcile_production_function_drift.sql` |
| 20261103174235 | `20261103174235_bling_fiscal_approval_without_catalog_sync.sql` |
| 20261108153004 | `20261108153004_restrict_published_help_audiences.sql` |
| 20261108153226 | `20261108153226_protect_cookie_consent_release.sql` |
| 20261108153312 | `20261108153312_restrict_homepage_metric_rpc.sql` |
| 20261108153342 | `20261108153342_representative_portal_safety.sql` |
| 20261108210341 | `20261108210341_prepare_help_writes_server.sql` |
| 20261108210447 | `20261108210447_restrict_help_writes_client.sql` |

A comparação comprova a correspondência de conteúdo desses pares. Alterar o histórico exige confirmar a ordem de aplicação e resolver os pares restantes. Nenhuma migration foi executada ou marcada como aplicada.

## Revisão dos cinco registros restantes

| Registro de produção | Resultado |
| --- | --- |
| `202609080001` | Os três comandos de `202609080001_admin_catalog_select_grants.sql` coincidem após separar os comandos, desconsiderar comentários iniciais e normalizar os delimitadores. A ordem dos comandos coincide. |
| `20261108212529` | O comando de `20261108212529_restrict_intelligence_ingest_client.sql` coincide após desconsiderar o comentário inicial. |
| `20261107230756` | Os 685 tokens SQL de `202611070001_delete_representative_sale.sql` coincidem ao desconsiderar espaços e comentários fora de literais, inclusive no corpo da função. As versões são diferentes. |
| `20261009151903` | Registro exclusivo de produção. Contém duas revogações, uma para a view materializada `creative_usage_daily_metrics` e outra para a função de gatilho `rls_auto_enable()`. |
| `20261012210536` | Corresponde a `202610100001_integration_credential_key_rotation.sql`. Os 197 tokens coincidem após desconsiderar comentários, espaços e os delimitadores `BEGIN;` e `COMMIT;` do arquivo. |

Resultado atualizado: **80 dos 81 registros de produção** têm um arquivo correspondente identificado. O último registro foi identificado como exclusivo de produção. No corte de 215 arquivos, há 135 sem correspondência comprovada no histórico remoto.

### Controles atuais dos últimos dois registros

- `20261009151903`: o histórico registra revogações que citam a view materializada `creative_usage_daily_metrics` e a função `rls_auto_enable()`. O catálogo de produção confirma que `anon` e `authenticated` não têm leitura da view nem execução da função. O gatilho de eventos associado à função está habilitado. A revogação de leitura da view também existe na migration `202607310004_representative_creatives.sql`; isso não estabelece equivalência do registro completo.
- `20261012210536`: o corpo da função de rotação em produção coincide com o arquivo. Os metadados confirmam `search_path` fixo, permissão de execução para `service_role` e ausência de execução por `anon` e `authenticated`.

### Comparação com banco reconstruído no CI em 18/11/2026

O job de banco do PR #144 aplicou as migrations no Supabase efêmero. A comparação de funções nos schemas `public` e `private` usou a assinatura, o hash do corpo, `SECURITY DEFINER` e a configuração. Dos 463 registros no CI, 461 coincidiram com produção. As diferenças estão em `private.owns_representative(uuid)`, alterada pelo PR #144, e `public.delete_representative_sale(uuid, text)`. A função `public.rls_auto_enable()` existe somente em produção. Essa comparação cobre as definições finais de funções. A origem dos 135 arquivos, a ordem no histórico existente e eventuais efeitos sobre dados exigem evidência adicional antes de `supabase db push`.

O corpo de `public.delete_representative_sale(uuid, text)` em produção, registrado sob `20261107230756`, tem os mesmos 625 tokens do arquivo `202611070001_delete_representative_sale.sql` após excluir comentários e espaços fora de literais. A diferença no hash dessa função é de formatação.

### Ordem das versões

A ordem diverge mesmo entre pares confirmados. Em produção, `20261029150718` antecede `20261029152609`. Os arquivos correspondentes são `20261029120000` e `20261028164942`, que têm a ordem inversa. Também há inversão entre `20261101130136` e `20261101132857`, associados respectivamente a `20261101121439` e `20261030000426`. O replay do CI valida a ordem dos arquivos em um banco novo. Para reconciliar produção, ainda é preciso verificar as dependências e os efeitos dos arquivos sem registro em uma cópia representativa do estado atual.

O histórico anterior aos quatro PRs permanece intacto.

### Migrations dos PRs #144, #147, #148 e #149

Após autorização específica, as quatro migrations foram aplicadas em produção na ordem `20261117220000`, `20261118010000`, `20261118020000` e `20261118030000`. Os quatro registros tiveram o SQL comparado com os arquivos da `main` antes do alinhamento das versões. A conferência final encontrou 85 registros, as três políticas restritivas de representantes, a checagem de conta ativa e não encerrada na função de vínculo e as três projeções públicas atualizadas. As quatro migrations estão fora da contagem histórica de 215 arquivos.

### Linha de base para novas migrations de produção

O manifesto `supabase/production-baseline.json` fixa os 85 registros de produção e a assinatura dos 219 arquivos históricos. O script `scripts/supabase-production-migrations.ps1` monta a pasta usada pelo Supabase CLI, preserva os números registrados e inclui somente migrations posteriores ao corte para execução. Arquivos marcadores interrompem qualquer tentativa de reaplicação histórica. Veja o procedimento em [Deploy](deployment.md#migrations-de-produção-a-partir-da-linha-de-base-de-18112026).

A simulação contra produção retornou `Remote database is up to date` com zero migrations pendentes. O procedimento permite seguir a partir do estado atual do banco. Os 135 arquivos continuam no histórico de referência para reconstrução e testes, com a origem em produção documentada individualmente conforme a evidência disponível.

### Inventário conferido no commit de produção em 18/11/2026

O commit `665e455f1639b6715b611cc1cc62ccb45c962727` contém 219 arquivos SQL conferidos pelos hashes Git. Dos 85 registros de produção, 84 correspondem a arquivos e um é exclusivo de produção. São 42 correspondências com a mesma versão e 42 com versões diferentes. Há sete pares de arquivos cuja ordem relativa difere da ordem no banco.

A simulação `supabase db push --dry-run --linked`, feita com os 219 arquivos desse commit, conectou-se à produção e parou em `LegacyDbPushMissingLocalError`. O CLI encontrou 43 versões de produção ausentes no checkout por número. O histórico e os dados permaneceram intactos. Alterações de versão exigem preservar a correspondência e a ordem confirmadas.

Dos 135 arquivos sem correspondência comprovada, 37 contêm comandos explícitos de escrita de dados e 20 contêm blocos `DO` ou chamadas `CALL`, com sobreposição de oito arquivos. Por exemplo, `202608090004_auth_identity_backfill.sql` preenche perfis e papéis a partir das identidades existentes, `202608080014_panel_permission_baseline.sql` atribui permissões e `202608100001_initial_editable_catalog.sql` grava catálogo e estoque. A triagem identifica comandos no nível superior. Blocos, funções, gatilhos e instruções indiretas ainda exigem revisão antes de uma reaplicação.

Atribuir execução a esses arquivos antigos exigiria registros de implantação que os cubram. A ordem do CI em um banco recém-criado permite verificar a reconstrução desde o início. A linha de base de produção usa os registros reais do Supabase e conserva a ordem de aplicação existente.

<details>
<summary>43 versões de produção ausentes por número</summary>

- `20261009151903` — registro exclusivo de produção (`restore_existing_database_security_grants_20261009`)
- `20261012210536` → `202610100001_integration_credential_key_rotation.sql`
- `20261012210542` → `202610100005_fix_transactional_email_job_reference.sql`
- `20261012210548` → `202610100006_delete_expired_product_import_sessions.sql`
- `20261015142727` → `20261015135129_fix_published_help_expiration.sql`
- `20261015220339` → `20261015213500_fix_singleton_runtime_safeupdate.sql`
- `20261015220348` → `20261015220500_fix_campaign_package_storage_correlation.sql`
- `20261016183341` → `20261016182000_fix_catalog_net_available_stock.sql`
- `20261016190102` → `20261016193500_prepare_mercadopago_production_checkout.sql`
- `20261017125346` → `20261017122238_bling_catalog_metadata.sql`
- `20261017125351` → `20261017122913_bling_fiscal_scenarios.sql`
- `20261019105018` → `20261017203511_part2_fulfillment_safety.sql`
- `20261019105023` → `20261017220005_confirmed_fiscal_tax_parameters.sql`
- `20261021222145` → `20261021220000_cancel_remaining_refund.sql`
- `20261021222155` → `20261021220001_cancel_refund_webhook_race.sql`
- `20261021230354` → `20261021225251_bling_order_homologation_scope.sql`
- `20261022114721` → `20261022112116_representative_resale_preflight_gate.sql`
- `20261022165651` → `20261022162930_representative_existing_kit_catalog.sql`
- `20261023191307` → `20261023160000_representative_test_transactions.sql`
- `20261023191329` → `20261023161000_representative_test_transaction_context.sql`
- `20261023191335` → `20261023162000_representative_test_reconciliation.sql`
- `20261023191341` → `20261023163000_representative_test_stock_audit.sql`
- `20261023191346` → `20261023164000_representative_test_payment_creation_guard.sql`
- `20261023191354` → `20261023165000_representative_test_expiration.sql`
- `20261023191359` → `20261023170000_representative_test_order_identity.sql`
- `20261023202658` → `20261023200529_transactional_email_test_scope.sql`
- `20261024150907` → `20261024144559_bling_accountant_resale_policy.sql`
- `20261024201804` → `20261024195245_remove_authenticator_product_option.sql`
- `20261024203304` → `20261024200616_bling_monthly_credit_and_return_policy.sql`
- `20261025114033` → `20261025111315_bling_monthly_credit_legacy_rate_optional.sql`
- `20261025134329` → `20261025120000_devtools_block_flag.sql`
- `20261026120219` → `20261026112700_melhor_envio_homologation_scope.sql`
- `20261026172424` → `20261026170000_bling_return_archive_context.sql`
- `20261026172428` → `20261026170100_bling_return_balance_lock_order.sql`
- `20261029150718` → `20261029120000_public_company_identification.sql`
- `20261029152609` → `20261028164942_isolated_review_test_scope.sql`
- `20261029231620` → `20261029231000_fix_email_test_scope_safeupdate.sql`
- `20261101130136` → `20261101121439_intelligence_retention_worker.sql`
- `20261101130147` → `20261101123450_reconcile_production_function_drift.sql`
- `20261101132857` → `20261030000426_fix_financial_payment_timezone.sql`
- `20261101193253` → `20261101190000_bling_invoice_order_resolution.sql`
- `20261101193259` → `20261101191000_bling_verified_documents_shipping.sql`
- `20261107230756` → `202611070001_delete_representative_sale.sql`

</details>

<details>
<summary>135 arquivos sem correspondência comprovada</summary>

- `202607290001_extensions_and_types.sql`
- `202607290002_identity_catalog_commerce.sql`
- `202607290003_support_operations_finance.sql`
- `202607290004_functions_rls_storage.sql` — DO/CALL, DML
- `202607290005_content_integrations_reporting.sql` — DO/CALL
- `202607290006_rpc_wrappers.sql`
- `202607310001_support_chat_workflow.sql` — DML
- `202607310002_representative_types.sql`
- `202607310003_representative_core.sql` — DML, DO/CALL
- `202607310004_representative_creatives.sql` — DO/CALL, DML
- `202608010001_security_hardening.sql` — DO/CALL
- `202608010002_representative_sale_transaction.sql`
- `202608010003_referral_attribution.sql`
- `202608020001_homepage_sections.sql`
- `202608030001_catalog_search.sql`
- `202608030002_authenticated_cart_sync.sql`
- `202608030003_public_storefront_product.sql`
- `202608030004_customer_account.sql` — DML
- `202608030005_representative_portal.sql`
- `202608030006_operational_panel.sql` — DML
- `202608030007_authenticated_user_roles.sql`
- `202608030008_admin_management.sql` — DML, DO/CALL
- `202608080001_admin_inventory_restock.sql` — DML
- `202608080002_manager_panel.sql` — DML
- `202608080003_technical_panel.sql` — DML
- `202608080004_banner_review_management.sql` — DML
- `202608080005_legal_compliance_center.sql` — DML, DO/CALL
- `202608080006_help_center_reform.sql` — DML
- `202608080007_professional_homepage_builder.sql` — DML, DO/CALL
- `202608080008_catalog_inventory_stability.sql` — DO/CALL
- `202608080009_product_management_stability.sql`
- `202608080010_panel_data_access_stability.sql` — DO/CALL
- `202608080011_auth_rate_limit_recovery.sql`
- `202608080012_payment_integration_hardening.sql`
- `202608080013_privacy_request_abuse_protection.sql`
- `202608080014_panel_permission_baseline.sql` — DML
- `202608080015_operational_metrics_scaling.sql`
- `202608090001_restore_audit_log_write_protection.sql`
- `202608090002_auth_cookie_runtime_stability.sql`
- `202608090003_cookie_consent_coalesce_stability.sql`
- `202608090004_auth_identity_backfill.sql` — DML
- `202608100001_initial_editable_catalog.sql` — DML
- `202608110001_operational_inventory_pagination.sql`
- `202608120001_product_management_permissions.sql`
- `202608160001_exact_customer_cart_sync.sql`
- `202608160002_help_center_brand_hardening.sql` — DML
- `202608160003_exact_cart_quantity_sync.sql`
- `202608170001_worker_resource_optimization.sql`
- `202608200001_homepage_social_proof_and_best_sellers.sql`
- `202608210001_intelligence_engine.sql` — DML
- `202608210002_database_function_lint_fixes.sql`
- `202608230001_store_promotion_bar.sql` — DML
- `202608230002_store_search_relevance.sql`
- `202608230003_internal_access_management.sql` — DML
- `202608230004_product_recommendation_purchase_filter.sql`
- `202608230005_product_management_drawer_delete.sql` — DML
- `202608310001_storefront_cookie_inventory.sql` — DML
- `202609010001_google_merchant_catalog.sql`
- `202609010002_variant_storefront.sql`
- `202609010003_product_video_media.sql` — DML
- `202609020001_financial_control.sql` — DML
- `202609020002_global_activity_audit.sql` — DML, DO/CALL
- `202609020003_manager_panel_repair.sql`
- `202609070001_internal_mfa.sql` — DML
- `202609070002_latest_user_access_history.sql`
- `202609070003_catalog_simplification.sql` — DML
- `202609070004_catalog_reliability_and_navigation.sql`
- `202609070005_catalog_public_column_hardening.sql`
- `202609080002_product_size_guide.sql`
- `202609080003_mercadopago_bricks_test_checkout.sql`
- `202609080004_fixed_shipping_checkout.sql` — DML
- `202609090001_simplify_banners.sql` — DML
- `202609100001_catalog_available_variants.sql`
- `202609100002_customer_account_closure.sql` — DO/CALL
- `202609100003_cart_unavailable_products.sql` — DO/CALL
- `202609100004_product_cart_deletion_eligibility.sql`
- `202609100005_professional_checkout.sql`
- `202609110001_financial_category_hierarchy.sql` — DML
- `202609110002_payment_intent_checkout.sql`
- `202609110003_mercadopago_financial_integration.sql` — DO/CALL
- `202609120001_public_banner_select_grant.sql`
- `202609120002_paid_sales_lifecycle.sql`
- `202609120003_product_seo_source_of_truth.sql` — DML
- `202609120004_finalize_paid_sales_metrics.sql`
- `202609120005_serialize_customer_address_delete.sql`
- `202609120006_production_checkout_operations.sql`
- `202609130001_sandbox_payment_attempt_identity.sql`
- `202609130002_mercadopago_saved_cards.sql`
- `202609130003_private_api_rate_limits.sql`
- `202609130004_checkout_cpf_identity.sql`
- `202609140001_public_size_guide_permissions.sql`
- `202609140002_customer_order_cancellations.sql`
- `202609140003_security_abuse_hardening.sql`
- `202609140004_customer_order_history_retention.sql`
- `202609140005_customer_return_authority.sql`
- `202609140006_public_api_budgets.sql`
- `202609140007_support_attachment_scan_queue.sql` — DML
- `202609140008_payment_reconciliation_cooldowns.sql`
- `202609140009_payment_webhook_leases.sql` — DML
- `202609160001_auth_rate_limit_result_contract.sql`
- `202609160002_catalog_facets_from_available_variants.sql`
- `202609160003_melhor_envio_shipping.sql`
- `202609200001_reconcile_product_save_schema.sql`
- `202609200002_product_specifications.sql`
- `202609200003_catalog_color_facets.sql`
- `202609200004_two_tone_product_colors.sql`
- `202609200005_product_editor_drafts.sql`
- `202609210001_product_bulk_imports.sql`
- `202609210002_product_import_sessions.sql`
- `202609220001_product_import_reliability.sql`
- `202609220002_product_import_taxonomy.sql`
- `202609220003_product_import_image_queue.sql`
- `202609230001_product_import_sync.sql`
- `202609230002_catalog_visual_cards.sql`
- `202609230003_product_media_publish_guard.sql`
- `202609230004_store_config_navigation_faq.sql` — DO/CALL
- `202609230005_storefront_reliability.sql` — DO/CALL
- `202609230006_product_delete_and_public_navigation.sql` — DO/CALL
- `202609240001_catalog_visual_representative.sql`
- `202609240002_homepage_self_publication.sql`
- `202609240003_homepage_direct_publication.sql`
- `202609240004_product_image_indexing.sql`
- `202609240005_recommendation_diversity.sql`
- `202609240006_variant_display_titles.sql` — DO/CALL
- `202609240007_store_config_archived_home_sections.sql` — DO/CALL
- `202609240009_home_category_storage_images.sql`
- `202609300001_shipping_quote_rate_limit.sql`
- `202609300002_shipping_quote_rate_limit_readiness.sql`
- `202610020001_bling_integration.sql` — DML, DO/CALL
- `202610020002_resend_transactional_email.sql` — DML
- `202610030001_legal_policy_import_publication.sql` — DML
- `202610100002_fix_admin_delete_product_greatest.sql`
- `202610100003_fix_financial_control_mutate_ambiguity.sql`
- `202610100004_fix_store_navigation_source_key_ambiguity.sql`
- `20261019120000_publish_incomplete_legal_policies.sql`

</details>

Consulta somente de leitura ao histórico do projeto de produção: 74 registros. A comparação usou os 207 arquivos SQL presentes no checkout isolado da main no commit `076579a`; as duas migrations de segurança integradas depois desse commit já têm versões alinhadas em produção.

Os pares abaixo têm conteúdos idênticos pela comparação MD5, após normalizar CRLF para LF. A primeira coluna é a versão registrada em produção; a segunda é o prefixo do arquivo correspondente no checkout. A igualdade de conteúdo comprova o par, mas não comprova o estado atual dos objetos, nem a execução das demais migrations.

| Produção | Arquivo | Identificação |
| --- | --- | --- |
| 20261012210542 | 202610100005 | fix_transactional_email_job_reference |
| 20261012210548 | 202610100006 | delete_expired_product_import_sessions |
| 20261015220339 | 20261015213500 | fix_singleton_runtime_safeupdate |
| 20261015220348 | 20261015220500 | fix_campaign_package_storage_correlation |
| 20261016183341 | 20261016182000 | fix_catalog_net_available_stock |
| 20261016190102 | 20261016193500 | prepare_mercadopago_production_checkout |
| 20261017125346 | 20261017122238 | bling_catalog_metadata |
| 20261017125351 | 20261017122913 | bling_fiscal_scenarios |
| 20261019105018 | 20261017203511 | part2_fulfillment_safety |
| 20261019105023 | 20261017220005 | confirmed_fiscal_tax_parameters |
| 20261021222145 | 20261021220000 | cancel_remaining_refund |
| 20261023202658 | 20261023200529 | transactional_email_test_scope |
| 20261024150907 | 20261024144559 | bling_accountant_resale_policy |
| 20261024201804 | 20261024195245 | remove_authenticator_product_option |
| 20261025134329 | 20261025120000 | devtools_block_flag |
| 20261029150718 | 20261029120000 | public_company_identification |
| 20261029152609 | 20261028164942 | isolated_review_test_scope |
| 20261029231620 | 20261029231000 | fix_email_test_scope_safeupdate |
| 20261101132857 | 20261030000426 | fix_financial_payment_timezone |
| 20261101193253 | 20261101190000 | bling_invoice_order_resolution |
| 20261101193259 | 20261101191000 | bling_verified_documents_shipping |

Não foi alterado o histórico nesta conferência. Ainda existem arquivos sem correspondência comprovada e um registro remoto sem arquivo nominal conhecido. Antes de qualquer `supabase db push` ou reparo em lote, é preciso reconciliar também esses casos, a ordem das versões e o estado efetivo do banco; não inferir que uma migration ausente do histórico precisa ser reaplicada. Ver também `docs/migrations-reconciliacao-2026-10-31.md`.

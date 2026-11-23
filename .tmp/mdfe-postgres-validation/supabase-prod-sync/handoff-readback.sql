select
  (select count(*) from private.representative_resale_fiscal_rule_versions) as fiscal_rules,
  (select count(*) from private.representative_kit_checkout_approvals where revoked_at is null and valid_until > now()) as active_approvals,
  (select count(*) from private.representative_kit_orders) as wholesale_orders,
  (select max(version) from supabase_migrations.schema_migrations) as latest_migration;

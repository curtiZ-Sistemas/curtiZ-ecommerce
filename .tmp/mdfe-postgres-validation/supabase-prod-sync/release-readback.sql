select
  (select count(*) from supabase_migrations.schema_migrations) as migration_count,
  (select max(version) from supabase_migrations.schema_migrations) as latest_migration,
  (select count(*) from private.representative_kit_checkout_approvals where revoked_at is null and valid_until > now()) as active_checkout_approvals,
  (select count(*) from private.representative_kit_orders) as wholesale_orders,
  to_regprocedure('public.request_representative_kit_pair_return(uuid,uuid,jsonb,text,uuid)') is not null as pair_return_rpc,
  to_regprocedure('public.schedule_representative_kit_cash_delivery(uuid,date)') is not null as cash_schedule_rpc;

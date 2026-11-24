-- Keep the fiscal approval's start time consistent with the same statement's lookup.
-- Enforce a 13-digit MG taxpayer registration at the protected RPC boundary.
do $migration$
declare
  old_definition text;
  new_definition text;
begin
  old_definition := pg_get_functiondef('private.ensure_representative_kit_grade_mg02_rules()'::regprocedure);
  new_definition := replace(old_definition, 'clock_timestamp(),''infinity''::timestamptz', 'statement_timestamp(),''infinity''::timestamptz');
  if old_definition = new_definition then
    raise exception 'Expected MG02 timestamp expression not found';
  end if;
  execute new_definition;
  old_definition := pg_get_functiondef('public.create_wholesale_kit_invoice(uuid,uuid,text,integer,integer,text,jsonb)'::regprocedure);
  new_definition := replace(old_definition, '(v_registration <> '''' and v_registration !~ ''^[0-9]{2,14}$'')', '(v_registration !~ ''^[0-9]{13}$'')');
  if old_definition = new_definition then
    raise exception 'Expected wholesale registration expression not found';
  end if;
  execute new_definition;
end;
$migration$;

-- Compute totals over the complete history under the caller's existing RLS.
create or replace function public.get_representative_portal_totals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'confirmed_sales_in_cents', coalesce((
      select sum(s.total_in_cents) from public.representative_sales s
      join public.representatives r on r.id = s.representative_id
      where r.user_id = auth.uid() and s.status = 'confirmed'
    ), 0),
    'available_commission_in_cents', coalesce((
      select sum(c.commission_in_cents) from public.commission_entries c
      join public.representatives r on r.id = c.representative_id
      where r.user_id = auth.uid() and c.status in ('approved', 'payable')
    ), 0),
    'kit_count', (
      select count(*) from public.kit_orders k
      join public.representatives r on r.id = k.representative_id
      where r.user_id = auth.uid() and k.status in ('paid', 'separating', 'ready_to_ship', 'shipped', 'delivered')
    )
  );
$$;
revoke all on function public.get_representative_portal_totals() from public, anon;
grant execute on function public.get_representative_portal_totals() to authenticated;

-- Do not silently invalidate a settled or closed commission. Such cases
-- require a financial adjustment through the authorized management process.
create or replace function private.prevent_settled_representative_sale_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed' and new.status = 'cancelled' then
    perform 1 from public.commission_entries where sale_id = old.id for update;
    if exists (
      select 1 from public.commission_entries c
      where c.sale_id = old.id and (
        c.status = 'paid' or exists (
          select 1 from public.commission_closing_entries ce where ce.commission_entry_id = c.id
        )
      )
    ) then
      raise exception 'sale has a settled or closed commission' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_settled_representative_sale_cancellation() from public, anon, authenticated;
create trigger prevent_settled_representative_sale_cancellation
before update of status on public.representative_sales
for each row execute function private.prevent_settled_representative_sale_cancellation();

-- Serialize closing creation with cancellation and recheck the current status
-- after acquiring the same commission row lock.
create or replace function private.validate_commission_closing_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare current_status public.commission_status;
begin
  select status into current_status from public.commission_entries
  where id = new.commission_entry_id for update;
  if current_status is null or current_status not in ('approved', 'payable') then
    raise exception 'commission is not eligible for closing' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_commission_closing_entry() from public, anon, authenticated;
create trigger validate_commission_closing_entry
before insert on public.commission_closing_entries
for each row execute function private.validate_commission_closing_entry();

-- Recheck the current commission row under its DELETE lock. A prior check in
-- delete_representative_sale can become stale while another transaction pays it.
create or replace function private.protect_commission_history_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'paid' then
    raise exception 'sale commission is already paid' using errcode = '23514';
  end if;
  if old.reversal_of is not null
    or exists (select 1 from public.commission_entries reversal where reversal.reversal_of = old.id)
    or exists (select 1 from public.commission_adjustments adjustment where adjustment.commission_entry_id = old.id)
    or exists (select 1 from public.commission_closing_entries closing_entry where closing_entry.commission_entry_id = old.id) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke all on function private.protect_commission_history_on_delete() from public, anon, authenticated;
create trigger protect_commission_history_on_delete
before delete on public.commission_entries
for each row execute function private.protect_commission_history_on_delete();

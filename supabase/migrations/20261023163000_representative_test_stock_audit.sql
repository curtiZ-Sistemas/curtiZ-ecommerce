create function public.release_kit_test_lease(p_order uuid,p_lock uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update private.kit_test_transactions set lock_id=null,locked_until=null where order_id=p_order and lock_id=p_lock;
  return found;
end;
$$;
revoke all on function public.release_kit_test_lease(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_kit_test_lease(uuid,uuid) to service_role;

create function private.audit_kit_test_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare movement text; delta integer; available integer;
begin
  if old.stock_state=new.stock_state then return new; end if;
  if old.stock_state='reserved' and new.stock_state='sold' then movement:='sale'; delta:=-new.quantity;
  elsif old.stock_state='reserved' and new.stock_state='released' then movement:='release'; delta:=new.quantity;
  elsif old.stock_state='sold' and new.stock_state='released' then movement:='return'; delta:=new.quantity;
  else raise exception 'kit_stock_transition'; end if;
  select available_quantity into available from public.inventory where variant_id=new.variant_id;
  insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,reference_type,reference_id,performed_by)
    values(new.variant_id,movement,delta,available-delta,available,'Transacao de kit TEST','kit_order',new.order_id,new.actor_id);
  return new;
end;
$$;
revoke all on function private.audit_kit_test_stock() from public,anon,authenticated,service_role;
create trigger kit_test_stock_audit after update of stock_state on private.kit_test_transactions
  for each row execute function private.audit_kit_test_stock();

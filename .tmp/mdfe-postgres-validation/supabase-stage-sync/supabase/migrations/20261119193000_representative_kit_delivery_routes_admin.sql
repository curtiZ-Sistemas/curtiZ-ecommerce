create function public.list_representative_kit_delivery_routes()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_permission('representatives.rules.manage');
  return (select coalesce(jsonb_agg(to_jsonb(routes)), '[]'::jsonb) from (
    select id,name,origin_postal_code,destination_from,destination_through,delivery_cents,estimated_days,valid_until,closed_at
    from private.representative_kit_collection_routes order by closed_at nulls first,valid_until desc,id limit 100
  ) routes);
end;
$$;

create function public.manage_representative_kit_delivery_route(p_close uuid,p_route jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
begin
  perform private.require_permission('representatives.rules.manage');
  if p_close is not null then
    update private.representative_kit_collection_routes set closed_at=clock_timestamp()
      where id=p_close and closed_at is null returning * into route;
    if not found then return false; end if;
  else
    select * into route from jsonb_populate_record(null::private.representative_kit_collection_routes,p_route);
    if route.origin_postal_code is null or route.valid_until is null or route.valid_until <= clock_timestamp()
      or route.delivery_cents not between 0 and 100000000 then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('kit_route:'||route.origin_postal_code,0));
    if exists (select 1 from private.representative_kit_collection_routes r
      where r.origin_postal_code=route.origin_postal_code and r.closed_at is null and r.valid_until>clock_timestamp()
        and route.destination_from<=r.destination_through and route.destination_through>=r.destination_from)
      then return false; end if;
    insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
      delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
    values(route.name,route.origin_postal_code,route.destination_from,route.destination_through,route.delivery_cents,
      route.estimated_days,route.bling_method_ids,route.point_terminal_id,route.verified_evidence,route.valid_until)
    returning id into route.id;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),
      case when p_close is null then 'representative.kit.route.created' else 'representative.kit.route.closed' end,
      'representative_kit_delivery_route',route.id,jsonb_build_object('origin',route.origin_postal_code));
  return true;
end;
$$;
revoke all on function public.list_representative_kit_delivery_routes(),public.manage_representative_kit_delivery_route(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.list_representative_kit_delivery_routes(),public.manage_representative_kit_delivery_route(uuid,jsonb)
  to authenticated;

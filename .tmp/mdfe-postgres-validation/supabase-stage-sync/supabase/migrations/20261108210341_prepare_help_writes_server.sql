-- The application verifies the viewer's identity and content access before
-- calling these service-only helpers. Old callers remain valid until rollout.
grant execute on function public.record_help_search(text,text,integer,text),
  public.record_help_view(uuid) to service_role;

create function public.record_help_feedback_server(
  p_content_id uuid, p_session_id uuid, p_user_id uuid, p_helpful boolean,
  p_reason text default null, p_action text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.published_help_contents where id=p_content_id) then
    raise exception 'content unavailable';
  end if;
  insert into public.help_content_feedback(content_id,session_id,user_id,helpful,reason,action_taken)
  values(p_content_id,p_session_id,p_user_id,p_helpful,
    nullif(left(trim(coalesce(p_reason,'')),500),''),
    nullif(left(trim(coalesce(p_action,'')),120),''))
  on conflict(content_id,session_id) do update
    set helpful=excluded.helpful,reason=excluded.reason,
        action_taken=excluded.action_taken,created_at=now()
    where public.help_content_feedback.user_id is not distinct from excluded.user_id;
  if not found then raise exception 'feedback session belongs to another user' using errcode='42501'; end if;
  update public.help_contents
    set helpful_count=(select count(*) from public.help_content_feedback where content_id=p_content_id and helpful),
        unhelpful_count=(select count(*) from public.help_content_feedback where content_id=p_content_id and not helpful)
    where id=p_content_id;
end;
$$;
revoke all on function public.record_help_feedback_server(uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.record_help_feedback_server(uuid,uuid,uuid,boolean,text,text) to service_role;
notify pgrst, 'reload schema';

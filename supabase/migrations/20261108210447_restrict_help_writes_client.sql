-- Apply after the application uses the service-only helpers.
revoke execute on function public.record_help_search(text,text,integer,text),
  public.record_help_view(uuid),
  public.record_help_feedback(uuid,uuid,boolean,text,text) from public,anon,authenticated;
notify pgrst, 'reload schema';

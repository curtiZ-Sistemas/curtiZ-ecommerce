-- curti Z Intelligence Engine: sinais consentidos, agregados e recomendações seguras.
-- Eventos de compra nunca são aceitos do navegador; vendas vêm somente de pedidos aprovados.

insert into public.permissions(code, description) values
  ('intelligence.read', 'Ler indicadores agregados de descoberta e recomendação')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select role_name, permission.id
from unnest(array['admin'::public.app_role, 'manager'::public.app_role, 'technical'::public.app_role]) role_name
cross join public.permissions permission
where permission.code = 'intelligence.read'
on conflict do nothing;

insert into public.feature_flags(key, enabled, metadata) values
  ('intelligence.tracking', true, '{"rollout":100,"description":"Coleta consentida em lotes"}'::jsonb),
  ('intelligence.recommendations', true, '{"rollout":100,"description":"Ranking e vitrines inteligentes"}'::jsonb),
  ('intelligence.discovery', true, '{"rollout":100,"description":"Descoberta incremental"}'::jsonb),
  ('intelligence.insights', true, '{"rollout":100,"description":"Insights agregados no painel"}'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings(key, value, is_public) values
  ('intelligence_event_retention_days', '30'::jsonb, false),
  ('intelligence_weights', '{"product_impression":0.25,"product_view":1,"image_interaction":1.5,"variant_select":2,"favorite_add":4,"favorite_remove":-2,"cart_add":6,"cart_remove":-3,"recommendation_click":2.5,"checkout_start":8}'::jsonb, false)
on conflict (key) do nothing;

alter table public.marketing_events
  add column if not exists client_event_id uuid,
  add column if not exists event_weight numeric(8,3) not null default 0,
  add column if not exists search_query text,
  add column if not exists recommendation_source text,
  add column if not exists event_bucket bigint;

create unique index if not exists marketing_events_client_event_idx
  on public.marketing_events(client_event_id) where client_event_id is not null;
create unique index if not exists marketing_events_impression_dedupe_idx
  on public.marketing_events(anonymous_session_id, event_type, product_id, event_bucket)
  where event_type in ('product_impression', 'recommendation_impression');
create index if not exists marketing_events_retention_idx on public.marketing_events(occurred_at, id);
create index if not exists marketing_events_session_idx on public.marketing_events(anonymous_session_id, occurred_at desc);

create table public.product_metrics_daily (
  metric_date date not null,
  product_id uuid not null references public.products(id) on delete cascade,
  impressions bigint not null default 0 check (impressions >= 0),
  views bigint not null default 0 check (views >= 0),
  image_interactions bigint not null default 0 check (image_interactions >= 0),
  variant_selections bigint not null default 0 check (variant_selections >= 0),
  favorite_adds bigint not null default 0 check (favorite_adds >= 0),
  favorite_removes bigint not null default 0 check (favorite_removes >= 0),
  cart_adds bigint not null default 0 check (cart_adds >= 0),
  cart_removes bigint not null default 0 check (cart_removes >= 0),
  recommendation_impressions bigint not null default 0 check (recommendation_impressions >= 0),
  recommendation_clicks bigint not null default 0 check (recommendation_clicks >= 0),
  units_sold bigint not null default 0 check (units_sold >= 0),
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  updated_at timestamptz not null default now(),
  primary key(metric_date, product_id)
);
create index product_metrics_product_date_idx on public.product_metrics_daily(product_id, metric_date desc);

create table public.search_metrics_daily (
  metric_date date not null,
  normalized_query text not null check (char_length(normalized_query) between 1 and 120),
  searches bigint not null default 0 check (searches >= 0),
  no_result_searches bigint not null default 0 check (no_result_searches >= 0),
  result_clicks bigint not null default 0 check (result_clicks >= 0),
  updated_at timestamptz not null default now(),
  primary key(metric_date, normalized_query)
);
create index search_metrics_date_idx on public.search_metrics_daily(metric_date desc, searches desc);

create table public.recommendation_metrics_daily (
  metric_date date not null,
  source text not null check (char_length(source) between 1 and 40),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  updated_at timestamptz not null default now(),
  primary key(metric_date, source)
);

create table public.session_interest_profiles (
  session_id uuid primary key,
  user_id uuid references public.profiles(id) on delete set null,
  category_scores jsonb not null default '{}'::jsonb,
  price_min_cents integer,
  price_max_cents integer,
  recent_product_ids uuid[] not null default '{}'::uuid[],
  event_count integer not null default 0,
  last_event_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index session_interest_user_idx on public.session_interest_profiles(user_id, last_event_at desc)
  where user_id is not null;
create index session_interest_expiry_idx on public.session_interest_profiles(expires_at);

create table private.intelligence_rate_buckets (
  session_id uuid not null,
  window_start timestamptz not null,
  event_count integer not null check (event_count > 0),
  primary key(session_id, window_start)
);

alter table public.product_metrics_daily enable row level security;
alter table public.search_metrics_daily enable row level security;
alter table public.session_interest_profiles enable row level security;
alter table public.recommendation_metrics_daily enable row level security;
alter table public.product_metrics_daily force row level security;
alter table public.search_metrics_daily force row level security;
alter table public.session_interest_profiles force row level security;
alter table public.recommendation_metrics_daily force row level security;

revoke all on public.product_metrics_daily, public.search_metrics_daily, public.session_interest_profiles from public, anon, authenticated;
revoke all on public.recommendation_metrics_daily from public, anon, authenticated;
revoke all on private.intelligence_rate_buckets from public, anon, authenticated;

create or replace function private.intelligence_flag_enabled(p_key text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select flag.enabled from public.feature_flags flag where flag.key=p_key), false)
$$;

create or replace function private.intelligence_event_weight(p_event_type text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select case p_event_type
    when 'product_impression' then 0.25 when 'product_view' then 1
    when 'image_interaction' then 1.5 when 'variant_select' then 2
    when 'favorite_add' then 4 when 'favorite_remove' then -2
    when 'cart_add' then 6 when 'cart_remove' then -3
    when 'recommendation_click' then 2.5 when 'checkout_start' then 8
    else 0 end
$$;

create or replace function private.aggregate_intelligence_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_category text; v_price integer; v_decay numeric; v_existing numeric; v_scores jsonb;
begin
  if new.product_id is not null then
    insert into public.product_metrics_daily(
      metric_date, product_id, impressions, views, image_interactions, variant_selections,
      favorite_adds, favorite_removes, cart_adds, cart_removes,
      recommendation_impressions, recommendation_clicks
    ) values (
      (new.occurred_at at time zone 'America/Sao_Paulo')::date, new.product_id,
      (new.event_type='product_impression')::integer, (new.event_type='product_view')::integer,
      (new.event_type='image_interaction')::integer, (new.event_type='variant_select')::integer,
      (new.event_type='favorite_add')::integer, (new.event_type='favorite_remove')::integer,
      (new.event_type='cart_add')::integer, (new.event_type='cart_remove')::integer,
      (new.event_type='recommendation_impression')::integer, (new.event_type='recommendation_click')::integer
    ) on conflict(metric_date, product_id) do update set
      impressions=public.product_metrics_daily.impressions+excluded.impressions,
      views=public.product_metrics_daily.views+excluded.views,
      image_interactions=public.product_metrics_daily.image_interactions+excluded.image_interactions,
      variant_selections=public.product_metrics_daily.variant_selections+excluded.variant_selections,
      favorite_adds=public.product_metrics_daily.favorite_adds+excluded.favorite_adds,
      favorite_removes=public.product_metrics_daily.favorite_removes+excluded.favorite_removes,
      cart_adds=public.product_metrics_daily.cart_adds+excluded.cart_adds,
      cart_removes=public.product_metrics_daily.cart_removes+excluded.cart_removes,
      recommendation_impressions=public.product_metrics_daily.recommendation_impressions+excluded.recommendation_impressions,
      recommendation_clicks=public.product_metrics_daily.recommendation_clicks+excluded.recommendation_clicks,
      updated_at=now();
  end if;

  if new.search_query is not null then
    insert into public.search_metrics_daily(metric_date, normalized_query, searches, no_result_searches, result_clicks)
    values ((new.occurred_at at time zone 'America/Sao_Paulo')::date, new.search_query,
      (new.event_type='search')::integer, (new.event_type='search_no_results')::integer,
      (new.event_type='search_result_click')::integer)
    on conflict(metric_date, normalized_query) do update set
      searches=public.search_metrics_daily.searches+excluded.searches,
      no_result_searches=public.search_metrics_daily.no_result_searches+excluded.no_result_searches,
      result_clicks=public.search_metrics_daily.result_clicks+excluded.result_clicks,
      updated_at=now();
  end if;

  if new.recommendation_source is not null and new.event_type in ('recommendation_impression','recommendation_click') then
    insert into public.recommendation_metrics_daily(metric_date,source,impressions,clicks)
    values((new.occurred_at at time zone 'America/Sao_Paulo')::date,new.recommendation_source,
      (new.event_type='recommendation_impression')::integer,(new.event_type='recommendation_click')::integer)
    on conflict(metric_date,source) do update set
      impressions=public.recommendation_metrics_daily.impressions+excluded.impressions,
      clicks=public.recommendation_metrics_daily.clicks+excluded.clicks,updated_at=now();
  end if;

  if new.product_id is not null and new.event_weight<>0 then
    select category.id::text, round(product.base_price*100)::integer
      into v_category, v_price from public.products product join public.categories category on category.id=product.category_id
      where product.id=new.product_id;
    select profile.category_scores,
      power(0.5, greatest(0, extract(epoch from (new.occurred_at-profile.last_event_at))/604800))
      into v_scores, v_decay from public.session_interest_profiles profile where profile.session_id=new.anonymous_session_id;
    v_scores:=coalesce(v_scores, '{}'::jsonb); v_decay:=coalesce(v_decay, 1);
    v_existing:=coalesce((v_scores->>v_category)::numeric, 0)*v_decay+new.event_weight;
    v_scores:=jsonb_set(v_scores, array[v_category], to_jsonb(round(v_existing,3)), true);
    insert into public.session_interest_profiles(session_id,user_id,category_scores,price_min_cents,price_max_cents,recent_product_ids,event_count,last_event_at,expires_at)
    values(new.anonymous_session_id,new.user_id,v_scores,v_price,v_price,array[new.product_id],1,new.occurred_at,new.occurred_at+interval '30 days')
    on conflict(session_id) do update set
      user_id=coalesce(excluded.user_id,public.session_interest_profiles.user_id),
      category_scores=v_scores,
      price_min_cents=least(coalesce(public.session_interest_profiles.price_min_cents,v_price),v_price),
      price_max_cents=greatest(coalesce(public.session_interest_profiles.price_max_cents,v_price),v_price),
      recent_product_ids=(array[new.product_id] || array_remove(public.session_interest_profiles.recent_product_ids,new.product_id))[1:20],
      event_count=public.session_interest_profiles.event_count+1,
      last_event_at=new.occurred_at, expires_at=new.occurred_at+interval '30 days';
  end if;
  return new;
end $$;

drop trigger if exists aggregate_intelligence_event on public.marketing_events;
create trigger aggregate_intelligence_event after insert on public.marketing_events
for each row when (new.event_type in ('product_impression','product_view','image_interaction','variant_select','search','search_no_results','search_result_click','recommendation_impression','recommendation_click','favorite_add','favorite_remove','cart_add','cart_remove','checkout_start'))
execute function private.aggregate_intelligence_event();

create or replace function public.ingest_intelligence_events(p_session_id uuid, p_events jsonb, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare event jsonb; v_type text; v_product uuid; v_query text; v_source text; v_time timestamptz; v_inserted integer:=0; v_window timestamptz;
declare allowed_types constant text[]:=array['page_view','product_impression','product_view','image_interaction','variant_select','category_view','search','search_no_results','search_result_click','recommendation_impression','recommendation_click','favorite_add','favorite_remove','cart_add','cart_remove','checkout_start'];
begin
  if not p_consent or not private.intelligence_flag_enabled('intelligence.tracking') then return jsonb_build_object('accepted',0,'enabled',false); end if;
  if p_session_id is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 20 then raise exception 'invalid intelligence batch'; end if;
  v_window:=date_trunc('minute',clock_timestamp());
  insert into private.intelligence_rate_buckets(session_id,window_start,event_count) values(p_session_id,v_window,jsonb_array_length(p_events))
  on conflict(session_id,window_start) do update set event_count=private.intelligence_rate_buckets.event_count+excluded.event_count
    where private.intelligence_rate_buckets.event_count+excluded.event_count<=120;
  if not found then raise exception 'intelligence rate limit exceeded' using errcode='P0001'; end if;
  for event in select value from jsonb_array_elements(p_events) loop
    v_type:=event->>'type';
    if not (v_type=any(allowed_types)) then raise exception 'unsupported intelligence event'; end if;
    v_product:=nullif(event->>'productId','')::uuid;
    if v_product is not null and not exists(select 1 from public.products product where product.id=v_product and product.status='active') then continue; end if;
    v_query:=case when v_type in ('search','search_no_results','search_result_click') then left(lower(regexp_replace(trim(coalesce(event->>'query','')), '\s+', ' ', 'g')),120) else null end;
    if v_type in ('search','search_no_results','search_result_click') and coalesce(v_query,'')='' then continue; end if;
    v_source:=case when v_type like 'recommendation_%' then left(regexp_replace(coalesce(event->>'source','unknown'),'[^a-z0-9_-]','','g'),40) else null end;
    v_time:=least(clock_timestamp(),greatest(clock_timestamp()-interval '1 day',coalesce((event->>'occurredAt')::timestamptz,clock_timestamp())));
    insert into public.marketing_events(client_event_id,user_id,anonymous_session_id,event_type,product_id,device_category,context_sanitized,occurred_at,event_weight,search_query,recommendation_source,event_bucket)
    values((event->>'id')::uuid,auth.uid(),p_session_id,v_type,v_product,
      case when event->>'device' in ('mobile','tablet','desktop') then event->>'device' else null end,
      jsonb_strip_nulls(jsonb_build_object('path',left(event->>'path',200),'variantId',nullif(event->>'variantId','')::uuid,'resultCount',least(greatest(coalesce((event->>'resultCount')::integer,0),0),10000))),
      v_time,private.intelligence_event_weight(v_type),v_query,v_source,floor(extract(epoch from v_time)/30)::bigint)
    on conflict do nothing;
    if found then v_inserted:=v_inserted+1; end if;
  end loop;
  return jsonb_build_object('accepted',v_inserted,'enabled',true);
end $$;

revoke all on function public.ingest_intelligence_events(uuid,jsonb,boolean) from public;
grant execute on function public.ingest_intelligence_events(uuid,jsonb,boolean) to anon,authenticated;

create or replace function public.forget_intelligence_session(p_session_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare removed integer;
begin
  if p_session_id is null then return 0; end if;
  delete from public.marketing_events event
  where event.anonymous_session_id=p_session_id and (event.user_id is null or event.user_id=auth.uid());
  get diagnostics removed=row_count;
  delete from public.session_interest_profiles profile
  where profile.session_id=p_session_id and (profile.user_id is null or profile.user_id=auth.uid());
  return removed;
end $$;
revoke all on function public.forget_intelligence_session(uuid) from public;
grant execute on function public.forget_intelligence_session(uuid) to anon,authenticated;

create or replace function public.get_intelligence_recommendations(
  p_source text default 'personalized', p_session_id uuid default null, p_category text default null,
  p_seen uuid[] default '{}'::uuid[], p_seed text default 'curtiz', p_limit integer default 8,
  p_price_min integer default null, p_price_max integer default null, p_only uuid[] default '{}'::uuid[]
) returns jsonb language sql stable security definer set search_path = ''
as $$
with config as (select greatest(1,least(coalesce(p_limit,8),24)) result_limit),
profile as (select category_scores,price_min_cents,price_max_cents from public.session_interest_profiles where session_id=p_session_id and expires_at>now()),
signals as (
 select metric.product_id,
  sum((metric.views+metric.image_interactions*1.5+metric.variant_selections*2+metric.favorite_adds*4+metric.cart_adds*6+metric.recommendation_clicks*2.5+metric.units_sold*12)
      /(1+greatest(0,current_date-metric.metric_date)::numeric/7)) score,
  sum(metric.views) views,sum(metric.favorite_adds) favorites,sum(metric.units_sold) sold,
  sum(case when metric.metric_date>=current_date-1 then metric.views+metric.favorite_adds*4+metric.cart_adds*6+metric.recommendation_clicks*2.5+metric.units_sold*12 else 0 end) trending_score
 from public.product_metrics_daily metric where metric.metric_date>=current_date-30 group by metric.product_id
), eligible as (
 select product.id,product.slug,product.name,category.id category_id,category.name category,product.short_description description,
  round(product.base_price*100)::integer price_cents,case when product.compare_at_price is null then null else round(product.compare_at_price*100)::integer end compare_cents,
  product.featured,product.created_at,variants.colors,variants.sizes,variants.stock,image.storage_path image_path,
  coalesce(review_summary.rating,0) rating,coalesce(review_summary.reviews,0) reviews,
  coalesce(signals.score,0) signal_score,coalesce(signals.views,0) views,coalesce(signals.favorites,0) favorites,coalesce(signals.sold,0) sold,coalesce(signals.trending_score,0) trending_score,
  coalesce((select (profile.category_scores->>category.id::text)::numeric from profile),0) affinity
 from public.products product join public.categories category on category.id=product.category_id and category.active
 join lateral (select array_agg(distinct variant.color_name order by variant.color_name) colors,array_agg(distinct variant.size order by variant.size) sizes,
   coalesce(sum(greatest(coalesce(stock.available_quantity,0)-coalesce(stock.reserved_quantity,0),0)),0)::integer stock
   from public.product_variants variant left join public.inventory stock on stock.variant_id=variant.id where variant.product_id=product.id and variant.active having count(*)>0) variants on true
 join lateral (select product_image.storage_path from public.product_images product_image where product_image.product_id=product.id and nullif(trim(product_image.storage_path),'') is not null order by product_image.is_primary desc,product_image.sort_order,product_image.created_at limit 1) image on true
 left join lateral (select round(avg(review.rating)::numeric,1) rating,count(*)::integer reviews from public.reviews review where review.product_id=product.id and review.status='approved') review_summary on true
 left join signals on signals.product_id=product.id
 where private.intelligence_flag_enabled('intelligence.recommendations')
  and (p_source<>'discovery' or private.intelligence_flag_enabled('intelligence.discovery'))
  and product.status='active' and variants.stock>0
  and not(product.id=any(coalesce(p_seen,'{}'::uuid[])))
  and (cardinality(coalesce(p_only,'{}'::uuid[]))=0 or product.id=any(p_only))
  and (p_category is null or lower(category.name)=lower(p_category) or lower(category.slug)=lower(p_category))
  and (p_price_min is null or round(product.base_price*100)>=p_price_min) and (p_price_max is null or round(product.base_price*100)<=p_price_max)
), scored as (
 select eligible.*,
  case p_source when 'trending' then trending_score when 'most_wanted' then favorites*5+signal_score when 'most_viewed' then views*2+signal_score
    when 'newest' then greatest(0,30-extract(day from now()-created_at))*10+signal_score
    when 'price_range' then signal_score+affinity*3 else signal_score+affinity*10 end rank_score,
  row_number() over(partition by category_id order by signal_score desc,md5(id::text||p_seed)) category_rank
 from eligible
), ranked as (select * from scored order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(id::text||p_seed) limit (select result_limit from config))
select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'category',category,'description',description,'priceInCents',price_cents,
 'compareAtPriceInCents',compare_cents,'rating',rating,'reviews',reviews,'colors',colors,'sizes',sizes,'imagePath',image_path,'featured',featured,'stock',stock,
 'recommendationSource',p_source) order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(id::text||p_seed)),'[]'::jsonb) from ranked
$$;

revoke all on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) from public;
grant execute on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) to anon,authenticated;

create or replace function public.get_intelligence_insights(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
 perform private.require_permission('intelligence.read');
 if not private.intelligence_flag_enabled('intelligence.insights') then return jsonb_build_object('enabled',false); end if;
 select jsonb_build_object('enabled',true,'periodDays',greatest(1,least(p_days,90)),
  'overview',jsonb_build_object('views',coalesce(sum(views),0),'favorites',coalesce(sum(favorite_adds),0),'cartAdds',coalesce(sum(cart_adds),0),'recommendationClicks',coalesce(sum(recommendation_clicks),0),'unitsSold',coalesce(sum(units_sold),0),'revenue',coalesce(sum(revenue),0)),
  'topProducts',coalesce((select jsonb_agg(row_to_json(top_row)) from (select product.name,metric.product_id as "productId",sum(metric.views) views,sum(metric.favorite_adds) favorites,sum(metric.cart_adds) as "cartAdds",sum(metric.units_sold) as "unitsSold" from public.product_metrics_daily metric join public.products product on product.id=metric.product_id where metric.metric_date>=current_date-greatest(1,least(p_days,90))+1 group by product.name,metric.product_id order by sum(metric.views+metric.favorite_adds*4+metric.cart_adds*6+metric.units_sold*12) desc limit 15) top_row),'[]'::jsonb),
  'searches',coalesce((select jsonb_agg(row_to_json(search_row)) from (select normalized_query as query,sum(searches) searches,sum(no_result_searches) as "noResults",sum(result_clicks) clicks from public.search_metrics_daily where metric_date>=current_date-greatest(1,least(p_days,90))+1 group by normalized_query order by sum(searches) desc limit 20) search_row),'[]'::jsonb),
  'sources',coalesce((select jsonb_agg(row_to_json(source_row)) from (select source,sum(impressions) impressions,sum(clicks) clicks from public.recommendation_metrics_daily where metric_date>=current_date-greatest(1,least(p_days,90))+1 group by source order by sum(clicks) desc limit 20) source_row),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(row_to_json(day_row) order by day_row.date) from (select metric_date date,sum(views) views,sum(cart_adds) as "cartAdds",sum(units_sold) as "unitsSold" from public.product_metrics_daily where metric_date>=current_date-greatest(1,least(p_days,90))+1 group by metric_date) day_row),'[]'::jsonb)
 ) into result from public.product_metrics_daily where metric_date>=current_date-greatest(1,least(p_days,90))+1;
 return result;
end $$;

revoke all on function public.get_intelligence_insights(integer) from public;
grant execute on function public.get_intelligence_insights(integer) to authenticated;

create or replace function private.aggregate_approved_order_intelligence()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare direction integer:=0;
begin
 if new.payment_status='approved' and new.status not in ('cancelled','returned','refund_pending','refunded')
   and not (old.payment_status='approved' and old.status not in ('cancelled','returned','refund_pending','refunded')) then direction:=1;
 elsif old.payment_status='approved' and old.status not in ('cancelled','returned','refund_pending','refunded')
   and not (new.payment_status='approved' and new.status not in ('cancelled','returned','refund_pending','refunded')) then direction:=-1; end if;
 if direction<>0 then
  if direction=1 then
   insert into public.product_metrics_daily(metric_date,product_id,units_sold,revenue)
   select (coalesce(new.placed_at,new.created_at) at time zone 'America/Sao_Paulo')::date,item.product_id,sum(item.quantity),sum(item.total)
   from public.order_items item where item.order_id=new.id group by item.product_id
   on conflict(metric_date,product_id) do update set
    units_sold=public.product_metrics_daily.units_sold+excluded.units_sold,
    revenue=public.product_metrics_daily.revenue+excluded.revenue,updated_at=now();
  else
   update public.product_metrics_daily metric set
    units_sold=greatest(0,metric.units_sold-reversal.units_sold),
    revenue=greatest(0,metric.revenue-reversal.revenue),updated_at=now()
   from (select item.product_id,sum(item.quantity) units_sold,sum(item.total) revenue from public.order_items item where item.order_id=new.id group by item.product_id) reversal
   where metric.metric_date=(coalesce(new.placed_at,new.created_at) at time zone 'America/Sao_Paulo')::date and metric.product_id=reversal.product_id;
  end if;
 end if;
 return new;
end $$;

drop trigger if exists aggregate_approved_order_intelligence on public.orders;
create trigger aggregate_approved_order_intelligence after update of payment_status,status on public.orders
for each row execute function private.aggregate_approved_order_intelligence();

create or replace function public.purge_intelligence_data(p_batch_size integer default 5000)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare event_count integer; profile_count integer; rate_count integer; retention_days integer;
begin
 perform private.require_permission('intelligence.read');
 select greatest(7,least(coalesce((value#>>'{}')::integer,30),180)) into retention_days from public.system_settings where key='intelligence_event_retention_days';
 with deleted as (delete from public.marketing_events where id in (select id from public.marketing_events where occurred_at<now()-make_interval(days=>retention_days) order by occurred_at limit greatest(1,least(p_batch_size,20000))) returning 1) select count(*) into event_count from deleted;
 with deleted as (delete from public.session_interest_profiles where expires_at<now() returning 1) select count(*) into profile_count from deleted;
 with deleted as (delete from private.intelligence_rate_buckets where window_start<now()-interval '1 day' returning 1) select count(*) into rate_count from deleted;
 return jsonb_build_object('events',event_count,'profiles',profile_count,'rateBuckets',rate_count);
end $$;
revoke all on function public.purge_intelligence_data(integer) from public;
grant execute on function public.purge_intelligence_data(integer) to authenticated;

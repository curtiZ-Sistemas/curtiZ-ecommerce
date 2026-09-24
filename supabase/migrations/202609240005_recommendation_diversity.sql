create or replace function public.get_intelligence_recommendations(
  p_source text default 'personalized', p_session_id uuid default null, p_category text default null,
  p_seen uuid[] default '{}'::uuid[], p_seed text default 'curtiz', p_limit integer default 8,
  p_price_min integer default null, p_price_max integer default null, p_only uuid[] default '{}'::uuid[]
) returns jsonb language sql stable security definer set search_path = ''
as $$
with config as (select greatest(1,least(coalesce(p_limit,8),24)) result_limit),
profile as (
  select category_scores,color_scores,price_min_cents,price_max_cents
  from public.session_interest_profiles
  where session_id=p_session_id and expires_at>now()
),
signals as (
  select metric.product_id,
    sum((metric.views+metric.image_interactions*1.5+metric.variant_selections*2+metric.favorite_adds*4+
      metric.cart_adds*6+metric.recommendation_clicks*2.5+metric.units_sold*12)
      /(1+greatest(0,current_date-metric.metric_date)::numeric/7)) score,
    sum(metric.views) views,sum(metric.favorite_adds) favorites,sum(metric.units_sold) sold,
    sum(case when metric.metric_date>=current_date-1 then metric.views+metric.favorite_adds*4+
      metric.cart_adds*6+metric.recommendation_clicks*2.5+metric.units_sold*12 else 0 end) trending_score
  from public.product_metrics_daily metric
  where metric.metric_date>=current_date-30
  group by metric.product_id
), candidates as (
  select item.*, external.recommendation_identity,
    row_number() over(partition by item.product_id order by
      case when item.stock>0 then 0 else 1 end,
      coalesce((select (profile.color_scores->>lower(item.variant_color))::numeric from profile),0) desc,
      md5(item.storefront_key || ':' || p_seed)) variant_rank
  from private.storefront_catalog_items() item
  left join lateral (
    select min(md5(import.source || ':' || import.external_key)) recommendation_identity
    from public.product_import_sources import
    where import.product_id=item.product_id
  ) external on true
  where private.intelligence_flag_enabled('intelligence.recommendations')
    and (p_source<>'discovery' or private.intelligence_flag_enabled('intelligence.discovery'))
    and item.stock>0
    and not(item.product_id=any(coalesce(p_seen,'{}'::uuid[])))
    and (cardinality(coalesce(p_only,'{}'::uuid[]))=0 or item.product_id=any(p_only))
    and (p_category is null or lower(item.category)=lower(p_category) or lower(item.category_slug)=lower(p_category))
    and (p_price_min is null or item.price_cents>=p_price_min)
    and (p_price_max is null or item.price_cents<=p_price_max)
    and not exists (
      select 1
      from public.product_import_sources candidate_identity
      join public.product_import_sources seen_identity
        on seen_identity.source=candidate_identity.source
        and seen_identity.external_key=candidate_identity.external_key
      where candidate_identity.product_id=item.product_id
        and seen_identity.product_id=any(coalesce(p_seen,'{}'::uuid[]))
    )
), product_candidates as (
  select * from candidates where variant_rank=1
), eligible as (
  select candidate.*,
    coalesce(signals.score,0) signal_score,coalesce(signals.views,0) views,
    coalesce(signals.favorites,0) favorites,coalesce(signals.sold,0) sold,
    coalesce(signals.trending_score,0) trending_score,
    coalesce((select (profile.category_scores->>candidate.category_id::text)::numeric from profile),0) affinity
  from product_candidates candidate
  left join signals on signals.product_id=candidate.product_id
), scored_candidates as (
  select eligible.*,
    case p_source
      when 'trending' then trending_score
      when 'most_wanted' then favorites*5+signal_score
      when 'most_viewed' then views*2+signal_score
      when 'newest' then greatest(0,30-extract(day from now()-created_at))*10+signal_score
      when 'price_range' then signal_score+affinity*3
      else signal_score+affinity*10
    end rank_score
  from eligible
), identity_ranked as (
  select scored_candidates.*,
    row_number() over(partition by coalesce(scored_candidates.recommendation_identity,scored_candidates.product_id::text)
      order by scored_candidates.rank_score desc,scored_candidates.signal_score desc,
        md5(scored_candidates.product_id::text||p_seed)) identity_rank
  from scored_candidates
), scored as (
  select identity_ranked.*,
    row_number() over(partition by category_id order by signal_score desc,md5(product_id::text||p_seed)) category_rank
  from identity_ranked
  where identity_rank=1
), ranked as (
  select * from scored
  order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(product_id::text||p_seed)
  limit (select result_limit from config)
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id',product_id,'storefrontKey',storefront_key,'modelSlug',model_slug,
  'recommendationIdentity',recommendation_identity,'variantId',variant_id,'sku',sku,
  'variantColor',variant_color,'variantSize',variant_size,'slug',slug,'name',display_name,
  'category',category,'description',description,'priceInCents',price_cents,
  'compareAtPriceInCents',compare_at_price_cents,'rating',rating,'reviews',reviews,
  'colors',colors,'sizes',sizes,'imagePath',image_path,'featured',featured,'stock',stock,
  'recommendationSource',p_source
) order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(product_id::text||p_seed)),'[]'::jsonb)
from ranked
$$;

revoke all on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) from public;
grant execute on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) to anon,authenticated;

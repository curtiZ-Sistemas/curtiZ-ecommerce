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
  coalesce((select (profile.category_scores->>category.id::text)::numeric from profile),0) affinity,
  case when p_category is not null and (lower(category.name)=lower(p_category) or lower(category.slug)=lower(p_category)) then 1 else 0 end context_affinity
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
  and not exists (
    select 1
    from public.order_items purchased_item
    join public.orders purchased_order on purchased_order.id=purchased_item.order_id
    where auth.uid() is not null
      and purchased_order.customer_id=auth.uid()
      and purchased_order.payment_status='approved'
      and purchased_order.status not in ('cancelled','returned','refund_pending','refunded')
      and purchased_item.product_id=product.id
  )
  and (cardinality(coalesce(p_only,'{}'::uuid[]))=0 or product.id=any(p_only))
  and (p_category is null or p_source='personalized' or lower(category.name)=lower(p_category) or lower(category.slug)=lower(p_category))
  and (p_price_min is null or round(product.base_price*100)>=p_price_min) and (p_price_max is null or round(product.base_price*100)<=p_price_max)
), scored as (
 select eligible.*,
  case p_source when 'trending' then trending_score when 'most_wanted' then favorites*5+signal_score when 'most_viewed' then views*2+signal_score
    when 'newest' then greatest(0,30-extract(day from now()-created_at))*10+signal_score
    when 'price_range' then signal_score+affinity*3
    when 'personalized' then signal_score+affinity*100+context_affinity*25
    else signal_score+affinity*10 end rank_score,
  row_number() over(partition by category_id order by signal_score desc,md5(id::text||p_seed)) category_rank
 from eligible
), ranked as (select * from scored order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(id::text||p_seed) limit (select result_limit from config))
select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'category',category,'description',description,'priceInCents',price_cents,
 'compareAtPriceInCents',compare_cents,'rating',rating,'reviews',reviews,'colors',colors,'sizes',sizes,'imagePath',image_path,'featured',featured,'stock',stock,
 'recommendationSource',p_source) order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(id::text||p_seed)),'[]'::jsonb) from ranked
$$;

revoke all on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) from public;
grant execute on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) to anon,authenticated;

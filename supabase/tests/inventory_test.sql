begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.carts(id, anonymous_token_hash)
values ('d0000000-0000-0000-0000-000000000001', 'test-cart-hash');

select lives_ok(
  $$select private.reserve_inventory(
    'd0000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    2,
    now() + interval '30 minutes'
  )$$,
  'Reserva estoque em transação'
);

select is(
  (select available_quantity from public.inventory where variant_id = '30000000-0000-0000-0000-000000000001'),
  154,
  'Reserva reduz disponibilidade'
);

select throws_ok(
  $$select private.reserve_inventory(
    'd0000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    1000,
    now() + interval '30 minutes'
  )$$,
  'P0001',
  'insufficient stock',
  'Estoque negativo é bloqueado'
);

select * from finish();
rollback;

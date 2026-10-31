-- The ledger is inserted first so the order guard can validate its TEST identity.
-- Enforce both sides atomically at commit, including direct administrator writes.
alter table private.kit_test_transactions add constraint kit_test_order_identity
  foreign key(order_id) references public.kit_orders(id) deferrable initially deferred;

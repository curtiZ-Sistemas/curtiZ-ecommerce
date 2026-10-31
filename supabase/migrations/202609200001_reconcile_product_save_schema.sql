-- Rascunhos podem manter dados comerciais e dimensoes opcionais como NULL.
-- DROP NOT NULL preserva registros, CHECKs, policies, grants e RPCs existentes.
alter table public.products
  alter column short_description drop not null,
  alter column description drop not null,
  alter column category_id drop not null,
  alter column base_price drop not null,
  alter column cost_price drop not null,
  alter column weight_grams drop not null,
  alter column height_cm drop not null,
  alter column width_cm drop not null,
  alter column length_cm drop not null;

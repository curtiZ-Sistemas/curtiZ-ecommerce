-- Mantém a marca visível consistente sem alterar slugs e identificadores técnicos.

insert into public.support_categories (
  name,
  slug,
  description,
  sort_order,
  public_visible
)
values (
  'Compras',
  'compras',
  'Escolha de produtos e fluxo de compra',
  5,
  true
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    public_visible = excluded.public_visible;

update public.support_categories
set name = 'Representante curti Z',
    description = 'Programa de representantes curti Z'
where slug = 'representante-curtiz';

update public.legal_documents
set public_title = 'Termos do Representante curti Z',
    updated_at = now()
where slug = 'termos-representante'
  and public_title is distinct from 'Termos do Representante curti Z';

update public.legal_document_sections
set content = replace(content, 'Curtiz', 'curti Z'),
    updated_at = now()
where content like '%Curtiz%';

notify pgrst, 'reload schema';

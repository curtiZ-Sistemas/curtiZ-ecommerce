-- Identificação do fornecedor exigida no rodapé (Decreto 7.962/2013, art. 2º, I e II).
-- A tabela company_legal_information tem RLS restrita ao painel; a loja pública lê só
-- estes campos, e apenas quando o cadastro foi marcado como completo e o CNPJ é válido em formato.
create or replace function public.public_company_identification()
returns table(
  legal_name text,
  trade_name text,
  tax_id text,
  address text,
  email text,
  phone text,
  support_channel text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    nullif(trim(company.legal_name), ''),
    nullif(trim(company.trade_name), ''),
    regexp_replace(company.tax_id, '[^0-9]', '', 'g'),
    nullif(trim(company.address), ''),
    nullif(trim(company.email), ''),
    nullif(trim(company.phone), ''),
    nullif(trim(company.support_channel), '')
  from public.company_legal_information company
  where company.id
    and company.completeness_status = 'complete'
    and regexp_replace(coalesce(company.tax_id, ''), '[^0-9]', '', 'g') ~ '^[0-9]{14}$'
    and regexp_replace(coalesce(company.tax_id, ''), '[^0-9]', '', 'g') !~ '^([0-9])\1{13}$'
    and char_length(trim(coalesce(company.legal_name, ''))) >= 3
    and char_length(trim(coalesce(company.address, ''))) >= 5
$$;

revoke all on function public.public_company_identification() from public;
grant execute on function public.public_company_identification() to anon, authenticated;

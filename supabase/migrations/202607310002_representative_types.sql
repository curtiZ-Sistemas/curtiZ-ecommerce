-- The enum value is intentionally isolated in its own migration. PostgreSQL requires
-- a commit before a newly added enum value can be referenced safely by later DDL.
alter type public.app_role add value if not exists 'representative' after 'customer';

create type public.representative_application_status as enum (
  'draft', 'submitted', 'under_review', 'documents_pending', 'approved',
  'rejected', 'suspended', 'cancelled'
);
create type public.representative_status as enum (
  'approved_waiting_kit', 'active', 'inactive', 'unqualified', 'suspended', 'cancelled'
);
create type public.representative_sale_status as enum (
  'draft', 'confirmed', 'cancelled', 'refunded', 'charged_back'
);
create type public.commission_status as enum (
  'pending', 'qualified', 'approved', 'payable', 'paid', 'reversed', 'cancelled'
);
create type public.commission_closing_status as enum (
  'simulating', 'pending_approval', 'approved', 'locked', 'paid', 'reopened', 'cancelled'
);
create type public.kit_order_status as enum (
  'pending_payment', 'paid', 'separating', 'ready_to_ship', 'shipped',
  'delivered', 'cancelled', 'refunded'
);
create type public.creative_status as enum (
  'draft', 'pending_review', 'approved', 'scheduled', 'published',
  'expired', 'archived', 'rejected'
);
create type public.approval_mode as enum ('disabled', 'simple', 'double');

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.app_role as enum ('customer', 'operational', 'admin', 'manager', 'technical');
create type public.user_status as enum ('invited', 'active', 'suspended', 'disabled');
create type public.product_status as enum ('draft', 'active', 'archived');
create type public.order_status as enum (
  'draft', 'pending_payment', 'payment_approved', 'processing', 'picking',
  'ready_to_ship', 'shipped', 'delivered', 'cancellation_requested', 'cancelled',
  'return_requested', 'returned', 'refund_pending', 'refunded', 'manual_review'
);
create type public.payment_status as enum (
  'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back', 'in_review'
);
create type public.shipment_status as enum (
  'pending', 'label_created', 'ready', 'dispatched', 'in_transit', 'delivered',
  'delayed', 'returned'
);
create type public.support_status as enum (
  'open', 'queued', 'assigned', 'in_progress', 'waiting_customer',
  'waiting_internal', 'escalated', 'resolved', 'closed', 'reopened',
  'spam', 'cancelled'
);
create type public.support_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.return_status as enum (
  'requested', 'in_review', 'waiting_photos', 'approved', 'rejected',
  'waiting_posting', 'in_transit', 'received', 'inspection', 'exchange_sent',
  'refund_requested', 'refunded', 'completed', 'cancelled'
);
create type public.integration_state as enum (
  'online', 'degraded', 'offline', 'not_configured', 'awaiting_credentials', 'maintenance'
);
create type public.job_status as enum ('pending', 'running', 'completed', 'failed', 'cancelled');
create type public.risk_level as enum ('low', 'medium', 'high', 'manual_review', 'approved', 'rejected');

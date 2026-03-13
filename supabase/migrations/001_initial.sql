-- ============================================================
-- PRMT User Audit — Initial Schema
-- Run this in Supabase SQL Editor or via supabase db push
-- ============================================================

-- ─── Tenants ────────────────────────────────────────────────

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table tenants enable row level security;

-- Authenticated users can read all tenants
create policy "Authenticated users can read tenants"
  on tenants for select
  to authenticated
  using (true);

-- Authenticated users can insert tenants
create policy "Authenticated users can insert tenants"
  on tenants for insert
  to authenticated
  with check (true);

-- ─── Integrations ───────────────────────────────────────────

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  app_name text not null,
  api_key_encrypted text not null,
  extra_config jsonb default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sync_frequency text not null default 'monthly',
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_integrations_tenant on integrations(tenant_id);

alter table integrations enable row level security;

create policy "Authenticated users can read integrations"
  on integrations for select
  to authenticated
  using (true);

create policy "Authenticated users can insert integrations"
  on integrations for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update integrations"
  on integrations for update
  to authenticated
  using (true);

create policy "Authenticated users can delete integrations"
  on integrations for delete
  to authenticated
  using (true);

-- ─── Users (synced from external apps) ──────────────────────

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  email text not null,
  display_name text,
  license_type text,
  external_id text,
  is_active boolean default true,
  last_seen_at timestamptz,
  synced_at timestamptz default now(),
  created_at timestamptz default now()
);

create index idx_users_tenant on users(tenant_id);
create index idx_users_integration on users(integration_id);
create unique index idx_users_integration_external on users(integration_id, external_id);

alter table users enable row level security;

create policy "Authenticated users can read users"
  on users for select
  to authenticated
  using (true);

create policy "Authenticated users can insert users"
  on users for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update users"
  on users for update
  to authenticated
  using (true);

-- ─── Sync Logs ──────────────────────────────────────────────

create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  user_count int default 0,
  error_message text
);

create index idx_sync_logs_integration on sync_logs(integration_id);

alter table sync_logs enable row level security;

create policy "Authenticated users can read sync_logs"
  on sync_logs for select
  to authenticated
  using (true);

create policy "Authenticated users can insert sync_logs"
  on sync_logs for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update sync_logs"
  on sync_logs for update
  to authenticated
  using (true);

-- ─── Helper: auto-update updated_at ─────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_tenants_updated
  before update on tenants
  for each row execute function update_updated_at();

create trigger trg_integrations_updated
  before update on integrations
  for each row execute function update_updated_at();

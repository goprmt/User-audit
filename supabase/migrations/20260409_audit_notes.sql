-- ============================================================
-- Audit Notes — per-tenant, per-email notes on audit findings
-- ============================================================

create table audit_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  note        text not null,
  updated_at  timestamptz not null default now(),

  unique (tenant_id, email)
);

alter table audit_notes enable row level security;

create policy "Authenticated users can manage audit_notes"
  on audit_notes for all
  to authenticated
  using (true)
  with check (true);

create index idx_audit_notes_tenant on audit_notes (tenant_id);

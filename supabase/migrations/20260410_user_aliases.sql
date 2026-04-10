-- Email aliases: map alias_email → primary_email within a tenant.
-- When the audit runs, users with alias emails are merged into their primary email group.

CREATE TABLE IF NOT EXISTS user_aliases (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  primary_email text        NOT NULL,
  alias_email   text        NOT NULL,
  created_at    timestamptz DEFAULT now(),
  -- Each alias email can only map to one primary within a tenant
  UNIQUE(tenant_id, alias_email)
);

CREATE INDEX IF NOT EXISTS user_aliases_tenant_primary ON user_aliases(tenant_id, primary_email);
CREATE INDEX IF NOT EXISTS user_aliases_tenant_alias   ON user_aliases(tenant_id, alias_email);

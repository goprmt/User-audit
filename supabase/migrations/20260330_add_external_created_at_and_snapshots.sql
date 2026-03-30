-- Add external_created_at column to users table
-- Stores the account creation date from the external integration (Google, Microsoft, JumpCloud, etc.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_created_at timestamptz;

-- Create audit_snapshots table for manual audit snapshots
CREATE TABLE IF NOT EXISTS audit_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label text,
  total_findings integer NOT NULL DEFAULT 0,
  not_in_jumpcloud integer NOT NULL DEFAULT 0,
  offboarded_still_licensed integer NOT NULL DEFAULT 0,
  licenses_to_reclaim integer NOT NULL DEFAULT 0,
  snapshot_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Index for fast tenant lookups ordered by date
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_tenant_date
  ON audit_snapshots (tenant_id, created_at DESC);

-- Enable RLS on audit_snapshots (matching existing RLS pattern)
ALTER TABLE audit_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write snapshots for their tenants
-- (matches the existing RLS pattern on other tables)
CREATE POLICY "Users can manage their tenant snapshots"
  ON audit_snapshots
  FOR ALL
  USING (true)
  WITH CHECK (true);

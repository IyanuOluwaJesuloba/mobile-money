-- Migration: Create admin_stellar_keys table
-- Description: Stores authorized Stellar public keys for admin authentication via SEP-10

CREATE TABLE IF NOT EXISTS admin_stellar_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_key VARCHAR(56) UNIQUE NOT NULL CHECK (public_key ~ '^G[A-Z0-9]{55}$'),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deactivated_at TIMESTAMP,
    UNIQUE(public_key, is_active)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_admin_stellar_keys_public_key ON admin_stellar_keys(public_key);
CREATE INDEX IF NOT EXISTS idx_admin_stellar_keys_is_active ON admin_stellar_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_stellar_keys_created_at ON admin_stellar_keys(created_at);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_admin_stellar_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_stellar_keys_updated_at ON admin_stellar_keys;
CREATE TRIGGER admin_stellar_keys_updated_at
  BEFORE UPDATE ON admin_stellar_keys
  FOR EACH ROW EXECUTE FUNCTION update_admin_stellar_keys_updated_at();

-- Insert some example admin keys (replace with real keys in production)
-- These are test keys - DO NOT USE IN PRODUCTION
-- INSERT INTO admin_stellar_keys (public_key, description) VALUES
-- ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'Example admin key 1 - REPLACE IN PRODUCTION'),
-- ('GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'Example admin key 2 - REPLACE IN PRODUCTION')
-- ON CONFLICT (public_key) DO NOTHING;
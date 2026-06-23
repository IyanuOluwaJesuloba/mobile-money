-- Migration: Create Anchored Assets Table
-- Created at: 2026-04-28

CREATE TABLE anchored_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code VARCHAR(12) NOT NULL,
    issuer_public_key CHAR(56) NOT NULL,
    issuer_secret_key TEXT NOT NULL, -- Encrypted at rest
    distribution_public_key CHAR(56) NOT NULL,
    distribution_secret_key TEXT NOT NULL, -- Encrypted at rest
    issuance_limit DECIMAL(20, 7) DEFAULT 1000000000,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'draft', 'disabled', 'locked')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asset_code, issuer_public_key)
);

CREATE INDEX idx_anchored_assets_code ON anchored_assets(asset_code);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_anchored_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_anchored_assets_updated_at
BEFORE UPDATE ON anchored_assets
FOR EACH ROW
EXECUTE FUNCTION update_anchored_assets_updated_at();

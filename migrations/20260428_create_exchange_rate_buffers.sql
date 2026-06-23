-- Migration: Create exchange rate buffer tables
-- Created at: 2026-04-28
-- Purpose: Per-provider configurable spread/margin on exchange rates to cover volatility

CREATE TABLE exchange_rate_buffers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        VARCHAR(100) NOT NULL,
    currency_pair   VARCHAR(10) NOT NULL,        -- e.g. 'USD_XAF', 'XLM_USD'
    buffer_percent  DECIMAL(8,4) NOT NULL,       -- e.g. 1.50 = 1.5% margin
    min_buffer_pct  DECIMAL(8,4) DEFAULT 0.10,   -- floor: never go below this %
    max_buffer_pct  DECIMAL(8,4) DEFAULT 5.00,   -- ceiling: never exceed this %
    volatility_mode VARCHAR(20) DEFAULT 'static' CHECK (volatility_mode IN ('static', 'dynamic')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, currency_pair)
);

-- Default global buffers (provider = '*' means fallback for any provider)
CREATE TABLE exchange_rate_buffer_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buffer_id       UUID NOT NULL REFERENCES exchange_rate_buffers(id) ON DELETE CASCADE,
    action          VARCHAR(20) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE')),
    old_values      JSONB,
    new_values      JSONB,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address      INET,
    user_agent      TEXT
);

CREATE INDEX idx_erb_provider_pair ON exchange_rate_buffers(provider, currency_pair);
CREATE INDEX idx_erb_active ON exchange_rate_buffers(is_active);
CREATE INDEX idx_erb_audit_buffer_id ON exchange_rate_buffer_audit(buffer_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_erb_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER erb_updated_at
  BEFORE UPDATE ON exchange_rate_buffers
  FOR EACH ROW EXECUTE FUNCTION update_erb_updated_at();

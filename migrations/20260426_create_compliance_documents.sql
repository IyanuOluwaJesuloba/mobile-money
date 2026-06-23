CREATE TABLE IF NOT EXISTS compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  country_code VARCHAR(2),
  provider VARCHAR(100),
  tags TEXT[] NOT NULL DEFAULT '{}',
  source_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (country_code IS NULL OR country_code = UPPER(country_code)),
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS idx_compliance_documents_country_code ON compliance_documents (country_code);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_provider ON compliance_documents (provider);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_status ON compliance_documents (status);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_created_at ON compliance_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_tags ON compliance_documents USING GIN (tags);

-- 1. Drop existing database-level Foreign Keys that point exclusively to transactions(id)
-- (Since partitioned tables require the partition key to be part of the PK, we rely on application-level integrity for these relations)
ALTER TABLE IF EXISTS disputes DROP CONSTRAINT IF EXISTS disputes_transaction_id_fkey;
ALTER TABLE IF EXISTS ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_transaction_id_fkey;
ALTER TABLE IF EXISTS accounting_sync_queue DROP CONSTRAINT IF EXISTS accounting_sync_queue_transaction_id_fkey;

-- 2. Rename the existing table to prepare for data migration
ALTER TABLE transactions RENAME TO transactions_old;
ALTER TABLE transactions_old RENAME CONSTRAINT transactions_pkey TO transactions_old_pkey;

-- 3. Create the new partitioned table (matches the existing schema)
CREATE TABLE transactions (
    id UUID NOT NULL,
    reference_number VARCHAR(255) NOT NULL,
    user_id UUID,
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(18,4) NOT NULL,
    fee DECIMAL(18,4) DEFAULT 0,
    fee_category VARCHAR(100),
    currency VARCHAR(10) DEFAULT 'XAF',
    provider VARCHAR(50) NOT NULL,
    phone_number VARCHAR(50),
    stellar_address VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    tags TEXT[],
    metadata JSONB,
    vault_id UUID,
    webhook_delivery_status VARCHAR(50),
    webhook_delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Partitioning requires the partition key to be part of the primary key
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 4. Create a Default Partition (Catches existing old data or data that falls out of range)
CREATE TABLE transactions_default PARTITION OF transactions DEFAULT;

-- 5. Create PL/pgSQL function to dynamically generate future monthly partitions
CREATE OR REPLACE FUNCTION create_transaction_partitions(months_ahead INT)
RETURNS void AS $$
DECLARE
    target_date TIMESTAMP;
    partition_name TEXT;
    start_date TIMESTAMP;
    end_date TIMESTAMP;
BEGIN
    FOR i IN 0..months_ahead LOOP
        target_date := date_trunc('month', CURRENT_DATE + (i || ' month')::interval);
        start_date := target_date;
        end_date := target_date + interval '1 month';
        partition_name := 'transactions_y' || to_char(target_date, 'YYYY') || 'm' || to_char(target_date, 'MM');

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
            EXECUTE format('CREATE TABLE %I PARTITION OF transactions FOR VALUES FROM (%L) TO (%L)', 
                partition_name, start_date, end_date);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 6. Initialize partitions for the current month and next 3 months
SELECT create_transaction_partitions(3);

-- 7. Migrate existing data (Automatically routes to the default or applicable monthly partition)
INSERT INTO transactions SELECT * FROM transactions_old;

-- 8. Recreate Global Indices (PG12+ automatically propagates these to all current and future partitions)
CREATE INDEX idx_transactions_id ON transactions(id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_reference ON transactions(reference_number);
CREATE INDEX idx_transactions_provider ON transactions(provider);

-- 9. (Optional / Post-Verification) Drop the old table to reclaim disk space
-- DROP TABLE transactions_old CASCADE;
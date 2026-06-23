-- Migration: Add 'clawed_back' status to transactions
-- Created at: 2026-04-26

-- We need to drop the old constraint and add a new one because Postgres doesn't allow easy ALTER for CHECK constraints on enum-like strings
-- First, find the constraint name. In schema.sql it's not named, so Postgres assigns one like 'transactions_status_check'

DO $$
BEGIN
    -- Drop the existing constraint if it exists
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
    
    -- Add the new constraint with 'clawed_back'
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_status_check 
    CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'clawed_back'));
END $$;

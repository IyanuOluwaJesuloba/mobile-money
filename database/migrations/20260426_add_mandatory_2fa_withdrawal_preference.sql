-- Migration: add_mandatory_2fa_withdrawal_preference
-- Description: Add user preference for mandatory 2FA on all withdrawal transactions
-- This provides extra security for high-balance users who opt-in to stricter controls

-- Up migration

-- Add mandatory 2FA withdrawal preference to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS mandatory_2fa_withdrawals BOOLEAN DEFAULT FALSE;

-- Add comment explaining the field
COMMENT ON COLUMN users.mandatory_2fa_withdrawals IS 'When true, user must provide 2FA for every withdrawal transaction, regardless of amount';

-- Create index for efficient queries on mandatory 2FA users
CREATE INDEX IF NOT EXISTS idx_users_mandatory_2fa_withdrawals ON users(mandatory_2fa_withdrawals);

-- Down migration (for rollback)
-- ALTER TABLE users DROP COLUMN IF EXISTS mandatory_2fa_withdrawals;
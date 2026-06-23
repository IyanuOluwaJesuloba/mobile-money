-- Migration: 012_add_kyc_rejection_reason
-- Description: Add rejection_reason field to KYC-related tables
-- Up migration

ALTER TABLE kyc_applicants ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE kyc_tier_upgrade_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Down migration
-- ALTER TABLE kyc_applicants DROP COLUMN IF NOT EXISTS rejection_reason;
-- ALTER TABLE kyc_tier_upgrade_requests DROP COLUMN IF NOT EXISTS rejection_reason;

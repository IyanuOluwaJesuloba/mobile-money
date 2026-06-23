/**
 * KYC Tier Upgrade Service
 *
 * Handles:
 *  - Detecting users who have reached 80% of their current KYC daily limit
 *  - Creating upgrade request records
 *  - Sending multi-channel notifications (email + push)
 *  - Approving / rejecting upgrade requests (updates users.kyc_level)
 */

import { queryRead, queryWrite, pool } from "../config/database";
import { KYCLevel, TRANSACTION_LIMITS } from "../config/limits";
import { EmailService } from "./email";
import { pushNotificationService } from "./push";

// Fraction of the daily limit that triggers an upgrade flag (80%)
const UPGRADE_THRESHOLD_PCT = parseFloat(
  process.env.KYC_UPGRADE_THRESHOLD_PCT || "0.8",
);

export interface KycUpgradeRequest {
  id: string;
  userId: string;
  currentKycLevel: KYCLevel;
  requestedLevel: KYCLevel;
  dailyVolume: number;
  dailyLimit: number;
  usagePct: number;
  status: "pending" | "approved" | "rejected" | "notified";
  notifiedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserVolumeInfo {
  userId: string;
  email: string | null;
  phoneNumber: string;
  kycLevel: KYCLevel;
  preferredLanguage: string;
  dailyVolume: number;
  dailyLimit: number;
  usagePct: number;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function nextKycLevel(current: KYCLevel): KYCLevel | null {
  if (current === KYCLevel.Unverified) return KYCLevel.Basic;
  if (current === KYCLevel.Basic) return KYCLevel.Full;
  return null; // already at the top tier
}

// ─── volume scanning ─────────────────────────────────────────────────────────

/**
 * Returns all active users whose 24-hour completed transaction volume
 * is >= UPGRADE_THRESHOLD_PCT of their current KYC daily limit,
 * and who are not already at the Full tier.
 */
export async function findUsersNearLimit(): Promise<UserVolumeInfo[]> {
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Pull per-user 24-hour volume alongside their KYC level and contact info.
  // We join on transactions so users with zero volume are excluded naturally.
  const result = await queryRead<{
    user_id: string;
    email: string | null;
    phone_number: string;
    kyc_level: string;
    preferred_language: string;
    daily_volume: string;
  }>(
    `SELECT
       u.id            AS user_id,
       u.email,
       u.phone_number,
       u.kyc_level,
       COALESCE(u.preferred_language, u.language, 'en') AS preferred_language,
       COALESCE(SUM(t.amount::numeric), 0)              AS daily_volume
     FROM users u
     JOIN transactions t
       ON t.user_id = u.id
      AND t.status   = 'completed'
      AND t.created_at >= $1
     WHERE u.kyc_level IN ('unverified', 'basic')
       AND u.status = 'active'
     GROUP BY u.id, u.email, u.phone_number, u.kyc_level, u.preferred_language, u.language`,
    [windowStart],
  );

  const nearLimit: UserVolumeInfo[] = [];

  for (const row of result.rows) {
    const kycLevel = row.kyc_level as KYCLevel;
    const dailyLimit = TRANSACTION_LIMITS[kycLevel];
    const dailyVolume = parseFloat(row.daily_volume);
    const usagePct = dailyVolume / dailyLimit;

    if (usagePct >= UPGRADE_THRESHOLD_PCT) {
      nearLimit.push({
        userId: row.user_id,
        email: row.email,
        phoneNumber: row.phone_number,
        kycLevel,
        preferredLanguage: row.preferred_language,
        dailyVolume,
        dailyLimit,
        usagePct: Math.round(usagePct * 10000) / 100, // e.g. 85.50
      });
    }
  }

  return nearLimit;
}

// ─── request creation ─────────────────────────────────────────────────────────

/**
 * Creates a pending upgrade request for a user if one does not already exist
 * for the same (user, requested_level) pair in a non-terminal state.
 * Returns the request id, or null if skipped (already exists).
 */
export async function createUpgradeRequestIfNeeded(
  info: UserVolumeInfo,
): Promise<string | null> {
  const requestedLevel = nextKycLevel(info.kycLevel);
  if (!requestedLevel) return null;

  // Check for an existing open request
  const existing = await queryRead<{ id: string }>(
    `SELECT id FROM kyc_tier_upgrade_requests
     WHERE user_id = $1
       AND requested_level = $2
       AND status IN ('pending', 'notified')
     LIMIT 1`,
    [info.userId, requestedLevel],
  );

  if (existing.rows.length > 0) {
    return null; // already flagged
  }

  const result = await queryWrite<{ id: string }>(
    `INSERT INTO kyc_tier_upgrade_requests
       (user_id, current_kyc_level, requested_level, daily_volume, daily_limit, usage_pct)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      info.userId,
      info.kycLevel,
      requestedLevel,
      info.dailyVolume,
      info.dailyLimit,
      info.usagePct,
    ],
  );

  return result.rows[0]?.id ?? null;
}

// ─── notifications ────────────────────────────────────────────────────────────

const emailService = new EmailService();

/**
 * Sends an email + push notification to the user prompting them to upgrade
 * their KYC tier, then marks the request as 'notified'.
 */
export async function notifyUserForUpgrade(
  requestId: string,
  info: UserVolumeInfo,
): Promise<void> {
  const requestedLevel = nextKycLevel(info.kycLevel);
  if (!requestedLevel) return;

  const usagePctDisplay = `${info.usagePct.toFixed(1)}%`;
  const remainingAmount = (info.dailyLimit - info.dailyVolume).toFixed(2);
  const newLimit = TRANSACTION_LIMITS[requestedLevel].toLocaleString();

  // ── email ──────────────────────────────────────────────────────────────────
  if (info.email) {
    const templateId =
      process.env.SENDGRID_KYC_UPGRADE_TEMPLATE_ID ||
      process.env.SENDGRID_RECEIPT_TEMPLATE_ID ||
      "";

    await emailService.sendEmail({
      to: info.email,
      templateId,
      dynamicTemplateData: {
        subject: "Action Required: Upgrade your KYC level",
        currentLevel: info.kycLevel,
        requestedLevel,
        usagePct: usagePctDisplay,
        dailyLimit: info.dailyLimit.toLocaleString(),
        remainingAmount,
        newLimit,
        upgradeUrl:
          process.env.KYC_UPGRADE_URL ||
          "https://app.mobilemoney.com/kyc/upgrade",
        year: new Date().getFullYear(),
      },
    });
  }

  // ── push notification ──────────────────────────────────────────────────────
  await pushNotificationService.sendToUser(info.userId, {
    title: "Upgrade your KYC level",
    body: `You've used ${usagePctDisplay} of your daily limit. Upgrade to ${requestedLevel} KYC for up to ${newLimit} XAF/day.`,
    data: {
      type: "kyc_upgrade_prompt",
      requestId,
      currentLevel: info.kycLevel,
      requestedLevel,
    },
  });

  // ── mark as notified ───────────────────────────────────────────────────────
  await queryWrite(
    `UPDATE kyc_tier_upgrade_requests
     SET status = 'notified', notified_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [requestId],
  );

  console.log(
    `[kyc-tier-upgrade] Notified user ${info.userId} (request ${requestId}): ` +
      `${info.kycLevel} → ${requestedLevel}, usage ${usagePctDisplay}`,
  );
}

// ─── approval / rejection ─────────────────────────────────────────────────────

export interface ApproveUpgradeOptions {
  requestId: string;
  reviewedBy: string;
  notes?: string;
}

/**
 * Approves a KYC tier upgrade request:
 *  1. Validates the request is in a reviewable state
 *  2. Updates users.kyc_level to the requested level
 *  3. Marks the request as approved
 *
 * All changes are wrapped in a single transaction.
 */
export async function approveKycUpgrade(
  options: ApproveUpgradeOptions,
): Promise<{ userId: string; newKycLevel: KYCLevel }> {
  const { requestId, reviewedBy, notes } = options;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch and lock the request row
    const reqResult = await client.query<{
      id: string;
      user_id: string;
      requested_level: string;
      status: string;
    }>(
      `SELECT id, user_id, requested_level, status
       FROM kyc_tier_upgrade_requests
       WHERE id = $1
       FOR UPDATE`,
      [requestId],
    );

    if (reqResult.rows.length === 0) {
      throw new Error(`Upgrade request ${requestId} not found`);
    }

    const req = reqResult.rows[0];

    if (!["pending", "notified"].includes(req.status)) {
      throw new Error(
        `Upgrade request ${requestId} is already in terminal state: ${req.status}`,
      );
    }

    const newKycLevel = req.requested_level as KYCLevel;

    // Update the user's KYC level
    await client.query(
      `UPDATE users
       SET kyc_level = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [newKycLevel, req.user_id],
    );

    // Mark the request as approved
    await client.query(
      `UPDATE kyc_tier_upgrade_requests
       SET status       = 'approved',
           reviewed_by  = $1,
           reviewed_at  = CURRENT_TIMESTAMP,
           review_notes = $2,
           rejection_reason = NULL
       WHERE id = $3`,
      [reviewedBy, notes ?? null, requestId],
    );

    await client.query("COMMIT");

    console.log(
      `[kyc-tier-upgrade] Approved request ${requestId}: ` +
        `user ${req.user_id} → ${newKycLevel} (by ${reviewedBy})`,
    );

    return { userId: req.user_id, newKycLevel };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface RejectUpgradeOptions {
  requestId: string;
  reviewedBy: string;
  notes?: string;
  rejectionReason: string;
}

/**
 * Rejects a KYC tier upgrade request without changing the user's KYC level.
 */
export async function rejectKycUpgrade(
  options: RejectUpgradeOptions,
): Promise<void> {
  const { requestId, reviewedBy, notes, rejectionReason } = options;

  if (!rejectionReason) {
    throw new Error("Rejection reason is required when rejecting KYC");
  }

  const result = await queryWrite(
    `UPDATE kyc_tier_upgrade_requests
     SET status           = 'rejected',
         reviewed_by      = $1,
         reviewed_at      = CURRENT_TIMESTAMP,
         review_notes     = $2,
         rejection_reason = $3
     WHERE id = $4
       AND status IN ('pending', 'notified')`,
    [reviewedBy, notes ?? null, rejectionReason ?? null, requestId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      `Upgrade request ${requestId} not found or already in terminal state`,
    );
  }

  console.log(
    `[kyc-tier-upgrade] Rejected request ${requestId} (by ${reviewedBy})`,
  );
}

// ─── list helpers (for admin UI) ──────────────────────────────────────────────

export async function listUpgradeRequests(filters: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<KycUpgradeRequest[]> {
  const { status, limit = 50, offset = 0 } = filters;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit, offset);

  const result = await queryRead<Record<string, unknown>>(
    `SELECT
       r.id,
       r.user_id           AS "userId",
       r.current_kyc_level AS "currentKycLevel",
       r.requested_level   AS "requestedLevel",
       r.daily_volume      AS "dailyVolume",
       r.daily_limit       AS "dailyLimit",
       r.usage_pct         AS "usagePct",
       r.status,
       r.notified_at       AS "notifiedAt",
       r.reviewed_by       AS "reviewedBy",
       r.reviewed_at       AS "reviewedAt",
       r.review_notes      AS "reviewNotes",
       r.rejection_reason  AS "rejectionReason",
       r.created_at        AS "createdAt",
       r.updated_at        AS "updatedAt"
     FROM kyc_tier_upgrade_requests r
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    userId: row.userId as string,
    currentKycLevel: row.currentKycLevel as KYCLevel,
    requestedLevel: row.requestedLevel as KYCLevel,
    dailyVolume: parseFloat(row.dailyVolume as string),
    dailyLimit: parseFloat(row.dailyLimit as string),
    usagePct: parseFloat(row.usagePct as string),
    status: row.status as KycUpgradeRequest["status"],
    notifiedAt: row.notifiedAt as Date | null,
    reviewedBy: row.reviewedBy as string | null,
    reviewedAt: row.reviewedAt as Date | null,
    reviewNotes: row.reviewNotes as string | null,
    rejectionReason: row.rejectionReason as string | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }));
}

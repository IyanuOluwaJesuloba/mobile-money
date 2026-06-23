import { Worker, Job } from "bullmq";
import { queueOptions } from "./config";
import { SyncJobData, SyncJobResult, SYNC_QUEUE_NAME } from "./syncQueue";
import {
  AccountingService,
  RateLimitError,
  NetworkError,
  ValidationError,
} from "../services/accounting/accountingService";

// Create instance of our Accounting Service
export const accountingService = new AccountingService();

/**
 * Sync Queue Processor Function
 * Handles the execution logic for a sync job, distinguishing transient and permanent errors.
 */
export async function processSyncJob(
  job: Job<SyncJobData, SyncJobResult>,
): Promise<SyncJobResult> {
  const { syncId, transactionId, platform, payload } = job.data;

  console.log(
    `[SyncWorker] [Job ${job.id}] Processing accounting sync for transaction ${transactionId} to ${platform}. Attempt #${job.attemptsMade + 1}`,
  );

  try {
    if (platform === "quickbooks") {
      await accountingService.syncToQuickBooks(transactionId, payload);
    } else if (platform === "xero") {
      await accountingService.syncToXero(transactionId, payload);
    } else {
      throw new ValidationError(`Unsupported accounting platform: ${platform}`);
    }

    console.log(
      `[SyncWorker] [Job ${job.id}] Successfully synced transaction ${transactionId} to ${platform}.`,
    );
    return { success: true, syncId, platform };
  } catch (error: unknown) {
    const isTransient =
      error instanceof RateLimitError || error instanceof NetworkError;
    const message = error instanceof Error ? error.message : String(error);

    if (isTransient) {
      // Log transient failure. BullMQ will automatically reschedule with exponential backoff.
      console.warn(
        `[SyncWorker] [Job ${job.id}] Transient error encountered during ${platform} sync (Attempt #${job.attemptsMade + 1}): ${message}. Scheduling retry...`,
      );
      throw error;
    } else {
      // Permanent error (e.g. ValidationError). Discard further attempts so BullMQ doesn't retry this job.
      console.error(
        `[SyncWorker] [Job ${job.id}] Permanent error encountered during ${platform} sync: ${message}. Discarding future attempts.`,
      );

      try {
        await job.discard();
      } catch (discardErr) {
        console.error(
          `[SyncWorker] Failed to discard job ${job.id}`,
          discardErr,
        );
      }

      throw error;
    }
  }
}

// Instantiate the BullMQ Worker
export const syncWorker = new Worker<SyncJobData, SyncJobResult>(
  SYNC_QUEUE_NAME,
  processSyncJob,
  {
    ...queueOptions,
    concurrency: 3, // Safe concurrency limit for accounting API rate-limits
  },
);

// Graceful shutdown helper
export async function closeSyncWorker(): Promise<void> {
  await syncWorker.close();
}

import { sanctionService } from "../services/sanctionService";

const SANCTION_FEED_URL =
  process.env.SANCTION_FEED_URL ?? "https://scsanctions.un.org/resources/ndjson/consolidated.ndjson";

const BATCH_SIZE = parseInt(process.env.SANCTION_SYNC_BATCH_SIZE ?? "500", 10);

/**
 * Sanction Sync Job
 * Schedule: Daily at 1:00 AM (configurable via SANCTION_SYNC_CRON)
 *
 * Streams the sanctions feed in batches to avoid OOM on large lists,
 * upserts each batch into the DB, then clears the match cache.
 */
export async function runSanctionSyncJob(): Promise<void> {
  console.log("[sanction-sync] Starting sanctions list sync");

  let totalIndexed = 0;
  let batchCount = 0;

  for await (const batch of sanctionService.streamSanctionUpdates(SANCTION_FEED_URL, BATCH_SIZE)) {
    await sanctionService.updateSanctionListBatch(batch);
    totalIndexed += batch.length;
    batchCount++;
    console.log(`[sanction-sync] Indexed batch ${batchCount} (${batch.length} entities, ${totalIndexed} total)`);
  }

  await sanctionService.clearSanctionMatchCache();
  console.log(`[sanction-sync] Completed: ${totalIndexed} entities indexed, cache cleared`);
}

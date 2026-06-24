import {
  transactionTotal,
  transactionErrorsTotal,
  providerFailoverTotal,
  providerFailoverAlerts,
} from "../../utils/metrics";
import { executeWithCircuitBreaker } from "../../utils/circuitBreaker";
import { pool } from "../../config/database";
import { MonitoringService } from "../monitoringService";

export type ProviderTransactionStatus =
  | "completed"
  | "failed"
  | "pending"
  | "unknown";

interface MobileMoneyProvider {
  requestPayment(
    phoneNumber: string,
    amount: string,
  ): Promise<{ success: boolean; data?: unknown; error?: unknown }>;
  sendPayout(
    phoneNumber: string,
    amount: string,
  ): Promise<{ success: boolean; data?: unknown; error?: unknown }>;
  getTransactionStatus?(
    referenceId: string,
  ): Promise<{ status: ProviderTransactionStatus }>;
}

interface ProviderExecutionResult {
  success: boolean;
  provider?: string;
  data?: unknown;
  error?: unknown;
  providerResponseTimeMs?: number;
}

class MobileMoneyError extends Error {
  constructor(
    public code: string,
    message: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "MobileMoneyError";
  }
}

/**
 * Lazy provider factory
 * Heavy modules are loaded ONLY when needed
 */
async function loadProvider(key: string): Promise<MobileMoneyProvider> {
  switch (key) {
    case "mtn": {
      const mod = await import("./providers/mtn");
      return new mod.MTNProvider();
    }

    case "airtel": {
      const mod = await import("./providers/airtel");
      return new mod.AirtelService();
    }

    case "orange": {
      const mod = await import("./providers/orange");
      return new mod.OrangeProvider();
    }

    case "wave": {
      const mod = await import("./providers/waveSenegal");
      return new mod.WaveSenegalProvider();
    }

    default:
      throw new Error(`Unknown provider: ${key}`);
  }
}

export class MobileMoneyService {
  private failoverHistory: Map<string, number[]> = new Map();
  private providers: Map<string, MobileMoneyProvider> = new Map();

  constructor(providers?: Map<string, MobileMoneyProvider>) {
    // Allow dependency injection for tests; otherwise use lazy loading
    if (providers) {
      this.providers = providers;
    }
  }

  private failoverEnabled(): boolean {
    return (
      String(process.env.PROVIDER_FAILOVER_ENABLED || "false").toLowerCase() ===
      "true"
    );
  }

  private getBackupProviderKey(primary: string): string | null {
    const envKey = `PROVIDER_BACKUP_${primary.toUpperCase()}`;
    const val = process.env[envKey];
    return val ? val.toLowerCase() : null;
  }

  private recordFailover(provider: string) {
    const now = Date.now();
    const arr = this.failoverHistory.get(provider) ?? [];
    arr.push(now);
    this.failoverHistory.set(provider, arr.slice(-100));
  }

  private checkRepeatedFailovers(provider: string): boolean {
    const WINDOW_MS = 60 * 60 * 1000;
    const THRESHOLD = 3;
    const now = Date.now();
    const arr = this.failoverHistory.get(provider) ?? [];
    const recent = arr.filter((t) => now - t <= WINDOW_MS);
    return recent.length >= THRESHOLD;
  }

  private notifyRepeatedFailovers(provider: string) {
    console.error(
      `Failover alert: provider=${provider} experienced repeated failovers`,
    );
    providerFailoverAlerts.inc({ provider });
  }

  private async getProviderOrThrow(
    providerKey: string,
  ): Promise<MobileMoneyProvider> {
    return await loadProvider(providerKey);
  }

  private async callProvider(
    provider: MobileMoneyProvider,
    op: "requestPayment" | "sendPayout",
    phoneNumber: string,
    amount: string,
  ) {
    if (op === "requestPayment") {
      return provider.requestPayment(phoneNumber, amount);
    }
    return provider.sendPayout(phoneNumber, amount);
  }

  private getOperationType(op: "requestPayment" | "sendPayout") {
    return op === "requestPayment" ? "payment" : "payout";
  }

  private buildProviderFailureMessage(
    providerKey: string,
    error: unknown,
    phase: "primary" | "backup",
  ): string {
    const reason =
      error instanceof Error && error.message
        ? error.message
        : "provider operation failed";

    return `${phase} provider '${providerKey}' failed: ${reason}`;
  }

  private async executeProviderOperation(
    op: "requestPayment" | "sendPayout",
    providerKey: string,
    phoneNumber: string,
    amount: string,
    allowFailover: boolean,
  ): Promise<ProviderExecutionResult> {
    const provider = await this.getProviderOrThrow(providerKey);
    const operationType = this.getOperationType(op);

    const backupKey =
      allowFailover && this.failoverEnabled()
        ? this.getBackupProviderKey(providerKey)
        : null;

    try {
      return await executeWithCircuitBreaker({
        provider: providerKey,
        operation: op,
        execute: async () => {
          const result = await this.callProvider(
            provider,
            op,
            phoneNumber,
            amount,
          );

          return result.success
            ? {
                success: true,
                provider: providerKey,
                data: result.data,
              }
            : {
                success: false,
                provider: providerKey,
                error: result.error,
              };
        },
        fallback: backupKey
          ? async (error: unknown) => {
              if (backupKey === providerKey) {
                return {
                  success: false,
                  provider: providerKey,
                  error,
                };
              }

              console.warn(
                `Failing over from ${providerKey} to ${backupKey} for ${op}`,
              );

              providerFailoverTotal.inc({
                type: operationType,
                from_provider: providerKey,
                to_provider: backupKey,
                reason: String(error).slice(0, 100),
              });

              this.recordFailover(providerKey);

              if (this.checkRepeatedFailovers(providerKey)) {
                this.notifyRepeatedFailovers(providerKey);
              }

              return this.executeProviderOperation(
                op,
                backupKey,
                phoneNumber,
                amount,
                false,
              );
            }
          : undefined,
      });
    } catch (error) {
      transactionTotal.inc({
        type: operationType,
        provider: providerKey,
        status: "failure",
      });

      transactionErrorsTotal.inc({
        type: operationType,
        provider: providerKey,
        error_type: allowFailover ? "provider_or_exception" : "backup_failure",
      });

      throw new MobileMoneyError(
        "PROVIDER_ERROR",
        this.buildProviderFailureMessage(
          providerKey,
          error,
          allowFailover ? "primary" : "backup",
        ),
        error
      );
    }
  }

  async initiatePayment(provider: string, phoneNumber: string, amount: string) {
    const providerKey = provider.toLowerCase();

    const result = await this.executeProviderOperation(
      "requestPayment",
      providerKey,
      phoneNumber,
      amount,
      true,
    );

    if (result.success) {
      transactionTotal.inc({
        type: "payment",
        provider: result.provider as string,
        status: "success",
      });

      return { success: true as const, data: result.data, providerResponseTimeMs: result.providerResponseTimeMs };
    }

    throw new MobileMoneyError(
      "PROVIDER_ERROR",
      `Payment failed for provider '${providerKey}'`,
      result.error
    );
  }

  async sendPayout(provider: string, phoneNumber: string, amount: string) {
    const providerKey = provider.toLowerCase();

    const result = await this.executeProviderOperation(
      "sendPayout",
      providerKey,
      phoneNumber,
      amount,
      true,
    );

    if (result.success) {
      transactionTotal.inc({
        type: "payout",
        provider: result.provider as string,
        status: "success",
      });

      return { success: true as const, data: result.data, providerResponseTimeMs: result.providerResponseTimeMs };
    }

    throw new MobileMoneyError(
      "PROVIDER_ERROR",
      `Payout failed for provider '${providerKey}'`,
      result.error
    );
  }

  getFailoverStats(): Record<
    string,
    { failover_count: number; last_failover?: number }
  > {
    const stats: Record<
      string,
      { failover_count: number; last_failover?: number }
    > = {};

    for (const [provider, history] of this.failoverHistory.entries()) {
      stats[provider] = {
        failover_count: history.length,
        last_failover: history.at(-1),
      };
    }

    return stats;
  }
}

export enum MobileMoneyProvider {
  MTN = "mtn",
  AIRTEL = "airtel",
  ORANGE = "orange",
  WAVE = "wave",
}

export interface ProviderLimits {
  minAmount: number;
  maxAmount: number;
}

export interface ProviderLimitsConfig {
  [MobileMoneyProvider.MTN]: ProviderLimits;
  [MobileMoneyProvider.AIRTEL]: ProviderLimits;
  [MobileMoneyProvider.ORANGE]: ProviderLimits;
  [MobileMoneyProvider.WAVE]: ProviderLimits;
}

export const DEFAULT_PROVIDER_LIMITS: ProviderLimitsConfig = {
  [MobileMoneyProvider.MTN]: { minAmount: 100, maxAmount: 500000 },
  [MobileMoneyProvider.AIRTEL]: { minAmount: 100, maxAmount: 1000000 },
  [MobileMoneyProvider.ORANGE]: { minAmount: 500, maxAmount: 750000 },
  [MobileMoneyProvider.WAVE]: { minAmount: 1, maxAmount: 2000000 },
};

function parseEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed) || !isFinite(parsed)) {
    console.warn(`Invalid value for ${key}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

export const PROVIDER_LIMITS: ProviderLimitsConfig = {
  [MobileMoneyProvider.MTN]: {
    minAmount: parseEnvNumber(
      "MTN_MIN_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.MTN].minAmount,
    ),
    maxAmount: parseEnvNumber(
      "MTN_MAX_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.MTN].maxAmount,
    ),
  },
  [MobileMoneyProvider.AIRTEL]: {
    minAmount: parseEnvNumber(
      "AIRTEL_MIN_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.AIRTEL].minAmount,
    ),
    maxAmount: parseEnvNumber(
      "AIRTEL_MAX_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.AIRTEL].maxAmount,
    ),
  },
  [MobileMoneyProvider.ORANGE]: {
    minAmount: parseEnvNumber(
      "ORANGE_MIN_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.ORANGE].minAmount,
    ),
    maxAmount: parseEnvNumber(
      "ORANGE_MAX_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.ORANGE].maxAmount,
    ),
  },
  [MobileMoneyProvider.WAVE]: {
    minAmount: parseEnvNumber(
      "WAVE_MIN_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.WAVE].minAmount,
    ),
    maxAmount: parseEnvNumber(
      "WAVE_MAX_AMOUNT",
      DEFAULT_PROVIDER_LIMITS[MobileMoneyProvider.WAVE].maxAmount,
    ),
  },
};

export function getProviderLimits(
  provider: MobileMoneyProvider,
): ProviderLimits {
  const limits = PROVIDER_LIMITS[provider];
  if (!limits) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return limits;
}

export function validateProviderLimits(
  provider: MobileMoneyProvider,
  amount: number,
): { valid: boolean; error?: string } {
  const limits = getProviderLimits(provider);

  if (amount < limits.minAmount) {
    return {
      valid: false,
      error: `Amount ${amount} XAF is below the minimum of ${limits.minAmount} XAF for ${provider.toUpperCase()}. Allowed range: ${limits.minAmount} - ${limits.maxAmount} XAF`,
    };
  }

  if (amount > limits.maxAmount) {
    return {
      valid: false,
      error: `Amount ${amount} XAF exceeds the maximum of ${limits.maxAmount} XAF for ${provider.toUpperCase()}. Allowed range: ${limits.minAmount} - ${limits.maxAmount} XAF`,
    };
  }

  return { valid: true };
}

function validateLimitsConfig(): void {
  const providers = [
    MobileMoneyProvider.MTN,
    MobileMoneyProvider.AIRTEL,
    MobileMoneyProvider.ORANGE,
    MobileMoneyProvider.WAVE,
  ];

  for (const provider of providers) {
    const limits = PROVIDER_LIMITS[provider];

    if (limits.minAmount <= 0 || !isFinite(limits.minAmount)) {
      throw new Error(
        `Invalid min amount for ${provider}: ${limits.minAmount}`,
      );
    }
    if (limits.maxAmount <= 0 || !isFinite(limits.maxAmount)) {
      throw new Error(
        `Invalid max amount for ${provider}: ${limits.maxAmount}`,
      );
    }
    if (limits.minAmount > limits.maxAmount) {
      throw new Error(`Min amount cannot exceed max amount for ${provider}`);
    }
  }
}

validateLimitsConfig();

const notifySlackAlertMock = jest.fn();
const loadAccountMock = jest.fn();
const calculateStellarReserveMock = jest.fn();
const formatReserveInfoMock = jest.fn();

jest.mock("../../src/services/loggers", () => ({
  notifySlackAlert: (...args: unknown[]) => notifySlackAlertMock(...args),
}));

jest.mock("../../src/config/stellar", () => ({
  getStellarServer: () => ({
    loadAccount: (...args: unknown[]) => loadAccountMock(...args),
  }),
}));

jest.mock("../../src/utils/stellarReserveCalculator", () => ({
  calculateStellarReserve: (...args: unknown[]) =>
    calculateStellarReserveMock(...args),
  formatReserveInfo: (...args: unknown[]) => formatReserveInfoMock(...args),
}));

import { runBalanceMonitorJob } from "../../src/jobs/balanceMonitorJob";

describe("runBalanceMonitorJob reserve alerts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    process.env.HOT_WALLET_PUBLIC_KEYS = "GTEST123";
    delete process.env.BALANCE_THRESHOLD_XLM;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("checks reserve and sends Slack alert even when asset thresholds are not configured", async () => {
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "100.0" }],
    });
    calculateStellarReserveMock.mockResolvedValue({
      isBelowThreshold: true,
    });
    formatReserveInfoMock.mockReturnValue("Reserve below threshold");

    await runBalanceMonitorJob();

    expect(calculateStellarReserveMock).toHaveBeenCalledWith("GTEST123", 5);
    expect(notifySlackAlertMock).toHaveBeenCalledTimes(1);
    expect(notifySlackAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/reserve/GTEST123",
        method: "MONITOR",
        statusCode: 500,
      }),
      expect.objectContaining({
        appName: "balance-monitor",
      }),
    );
  });

  it("uses configured reserve-above-threshold value", async () => {
    process.env.STELLAR_MIN_BALANCE_ABOVE_RESERVE = "8.5";

    loadAccountMock.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "100.0" }],
    });
    calculateStellarReserveMock.mockResolvedValue({
      isBelowThreshold: false,
    });
    formatReserveInfoMock.mockReturnValue("Reserve healthy");

    await runBalanceMonitorJob();

    expect(calculateStellarReserveMock).toHaveBeenCalledWith("GTEST123", 8.5);
    expect(notifySlackAlertMock).not.toHaveBeenCalled();
  });
});

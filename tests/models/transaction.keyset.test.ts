const mockQueryRead = jest.fn();

jest.mock("../../src/config/database", () => ({
  pool: {},
  queryRead: (...args: unknown[]) => mockQueryRead(...args),
  queryWrite: jest.fn(),
}));

jest.mock("../../src/utils/encryption", () => ({
  encrypt: (value: unknown) => value,
  decrypt: (value: unknown) => value,
}));

jest.mock("../../src/services/cachedTransactionService", () => ({
  CachedTransactionInvalidation: {
    invalidateUserCaches: jest.fn(),
    invalidateProviderStats: jest.fn(),
    invalidateGeneralStats: jest.fn(),
  },
}));

jest.mock("../../src/graphql/redisPubSub", () => ({
  getRedisPubSub: jest.fn(() => ({ publish: jest.fn() })),
}));

jest.mock("../../src/websocket", () => ({
  WebSocketManager: {
    getInstance: jest.fn(() => ({ broadcastTransactionUpdate: jest.fn() })),
  },
}));

import { TransactionModel, TransactionStatus } from "../../src/models/transaction";

const row = (id: string, createdAt: string) => ({
  id,
  referenceNumber: `TX-${id}`,
  type: "deposit",
  amount: "100",
  phoneNumber: "+237600000000",
  provider: "mtn",
  stellarAddress: "G".padEnd(56, "A"),
  status: TransactionStatus.Completed,
  tags: [],
  notes: null,
  adminNotes: null,
  metadata: {},
  locationMetadata: null,
  userId: "user-1",
  idempotencyKey: null,
  idempotencyExpiresAt: null,
  createdAt,
  updatedAt: createdAt,
});

describe("TransactionModel keyset pagination", () => {
  beforeEach(() => {
    mockQueryRead.mockReset();
    mockQueryRead.mockResolvedValue({ rows: [] });
  });

  it("uses created_at and id ordering for the first history page", async () => {
    mockQueryRead.mockResolvedValueOnce({
      rows: [row("b", "2026-05-02T00:00:00.000Z")],
    });

    const model = new TransactionModel();
    const result = await model.list(25, 0);

    expect(result).toHaveLength(1);
    expect(mockQueryRead).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY created_at DESC, id DESC"),
      [25],
    );
    expect(mockQueryRead.mock.calls[0][0]).not.toContain("OFFSET");
  });

  it("turns offset pages into an anchor lookup plus keyset comparison", async () => {
    mockQueryRead.mockResolvedValueOnce({
      rows: [
        row("page-101-a", "2026-02-01T00:00:00.000Z"),
        row("page-101-b", "2026-01-31T00:00:00.000Z"),
      ],
    });

    const model = new TransactionModel();
    const result = await model.list(2, 200);

    expect(result.map((tx) => tx.id)).toEqual(["page-101-a", "page-101-b"]);

    const [sql, params] = mockQueryRead.mock.calls[0];
    expect(sql).toContain("WITH anchor AS");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(sql).toContain("AND (created_at, id) < (SELECT created_at, id FROM anchor)");
    expect(params).toEqual([199, 2]);
  });

  it("applies after cursors with a created_at/id keyset comparison", async () => {
    const after = Buffer.from(
      "2026-05-02T00:00:00.000Z|00000000-0000-0000-0000-000000000002",
    ).toString("base64");
    mockQueryRead.mockResolvedValueOnce({
      rows: [row("older", "2026-05-01T00:00:00.000Z")],
    });

    const model = new TransactionModel();
    const result = await model.list(10, 0, undefined, undefined, {}, { after });

    expect(result[0].id).toBe("older");
    const [sql, params] = mockQueryRead.mock.calls[0];
    expect(sql).toContain("AND (created_at, id) < ($1, $2)");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(params).toEqual([
      new Date("2026-05-02T00:00:00.000Z"),
      "00000000-0000-0000-0000-000000000002",
      10,
    ]);
  });

  it("keeps status filters compatible with keyset pagination", async () => {
    const model = new TransactionModel();
    await model.findByStatuses([TransactionStatus.Completed], 50, 5000);

    const [sql, params] = mockQueryRead.mock.calls[0];
    expect(sql).toContain("status = ANY($1)");
    expect(sql).toContain("AND (created_at, id) < (SELECT created_at, id FROM anchor)");
    expect(params).toEqual([[TransactionStatus.Completed], 4999, 50]);
  });
});

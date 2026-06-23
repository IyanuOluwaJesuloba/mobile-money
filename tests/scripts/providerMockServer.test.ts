import { createProviderMockApp } from "../../scripts/provider-mock-server";
import request = require("supertest");

describe("provider mock server", () => {
  const app = createProviderMockApp();

  it("serves health information", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      providers: ["mtn", "airtel"],
    });
  });

  it("stores MTN pending transactions and returns the matching status", async () => {
    const createResponse = await request(app)
      .post("/mtn/collection/v1_0/requesttopay?scenario=pending")
      .send({
        externalId: "mtn-ref-123",
      });

    expect(createResponse.status).toBe(202);
    expect(createResponse.body.status).toBe("PENDING");

    const statusResponse = await request(app).get(
      "/mtn/collection/v1_0/requesttopay/mtn-ref-123",
    );

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body).toMatchObject({
      referenceId: "mtn-ref-123",
      status: "PENDING",
    });
  });

  it("returns Airtel success status codes for stored transactions", async () => {
    const createResponse = await request(app)
      .post("/airtel/merchant/v1/payments/")
      .send({
        reference: "airtel-ref-123",
        scenario: "success",
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.data.transaction.status).toBe("TS");

    const statusResponse = await request(app).get(
      "/airtel/standard/v1/payments/airtel-ref-123",
    );

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data.transaction.status).toBe("TS");
  });

  it("supports custom per-request delays", async () => {
    const startedAt = Date.now();

    const response = await request(app)
      .get("/mtn/disbursement/v1_0/account/balance")
      .set("x-mock-delay-ms", "60");

    expect(response.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
  });

  it("returns provider failures when requested", async () => {
    const response = await request(app).get(
      "/airtel/standard/v1/users/balance?scenario=failed",
    );

    expect(response.status).toBe(503);
    expect(response.body.status).toEqual({
      success: false,
      code: "BALANCE_UNAVAILABLE",
    });
  });
});

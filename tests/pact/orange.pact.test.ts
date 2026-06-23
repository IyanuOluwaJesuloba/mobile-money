/**
 * Pact Consumer Contract Tests — Orange Money API (Direct/OAuth2 mode)
 *
 * Defines the contract between our service (consumer) and the Orange Money
 * API (provider) using the direct OAuth2 mode. Covers auth, payment
 * collection, disbursement, and status checks.
 */
import path from "path";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import axios from "axios";

const { like, regex, string } = MatchersV3;

const provider = new PactV3({
  consumer: "MobileMoneyService",
  provider: "OrangeMoneyAPI",
  dir: path.resolve(__dirname, "../../pacts"),
  logLevel: "warn",
});

const BEARER_TOKEN = "test-orange-bearer-token";
const REFERENCE = "ORANGE-PAYMENT-1700000000000";

describe("Orange Money API Contract", () => {
  describe("POST /oauth/token — authenticate (client credentials)", () => {
    it("returns an access token given valid client credentials", async () => {
      await provider
        .given("valid Orange API credentials")
        .uponReceiving("a client credentials token request")
        .withRequest({
          method: "POST",
          path: "/oauth/token",
          headers: {
            Authorization: regex(
              "^Basic [A-Za-z0-9+/=]+$",
              "Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=",
            ),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            access_token: like("eyJhbGciOiJSUzI1NiJ9.orange"),
            token_type: like("Bearer"),
            expires_in: like(3600),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.post(
            `${mockServer.url}/oauth/token`,
            "grant_type=client_credentials",
            {
              headers: {
                Authorization: "Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=",
                "Content-Type": "application/x-www-form-urlencoded",
              },
            },
          );
          expect(res.status).toBe(200);
          expect(res.data.access_token).toBeDefined();
          expect(typeof res.data.expires_in).toBe("number");
        });
    });
  });

  describe("POST /v1/payments/collect — request payment (collection)", () => {
    it("accepts a valid collection request and returns pending status", async () => {
      await provider
        .given("Orange collection service is available")
        .uponReceiving("a request to collect payment from a subscriber")
        .withRequest({
          method: "POST",
          path: "/v1/payments/collect",
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${BEARER_TOKEN}`),
            "Content-Type": "application/json",
          },
          body: {
            reference: like(REFERENCE),
            subscriber: {
              msisdn: like("+237600000000"),
            },
            transaction: {
              amount: like(1000),
              currency: like("XAF"),
              id: like(REFERENCE),
            },
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            status: like("PENDING"),
            id: like(REFERENCE),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.post(
            `${mockServer.url}/v1/payments/collect`,
            {
              reference: REFERENCE,
              subscriber: { msisdn: "+237600000000" },
              transaction: { amount: 1000, currency: "XAF", id: REFERENCE },
            },
            {
              headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
              },
            },
          );
          expect(res.status).toBe(200);
          expect(res.data.id).toBeDefined();
        });
    });

    it("returns 401 when the token is invalid", async () => {
      await provider
        .given("Orange API rejects invalid token")
        .uponReceiving("a collection request with an invalid bearer token")
        .withRequest({
          method: "POST",
          path: "/v1/payments/collect",
          headers: {
            Authorization: "Bearer invalid-token",
            "Content-Type": "application/json",
          },
          body: like({
            reference: REFERENCE,
            subscriber: { msisdn: "+237600000000" },
            transaction: { amount: 1000, currency: "XAF", id: REFERENCE },
          }),
        })
        .willRespondWith({
          status: 401,
          headers: { "Content-Type": "application/json" },
          body: {
            message: like("Unauthorized"),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.post(
            `${mockServer.url}/v1/payments/collect`,
            {
              reference: REFERENCE,
              subscriber: { msisdn: "+237600000000" },
              transaction: { amount: 1000, currency: "XAF", id: REFERENCE },
            },
            {
              headers: {
                Authorization: "Bearer invalid-token",
                "Content-Type": "application/json",
              },
              validateStatus: () => true,
            },
          );
          expect(res.status).toBe(401);
        });
    });
  });

  describe("POST /v1/payments/disburse — send payout", () => {
    it("accepts a valid disbursement request and returns success", async () => {
      const payoutRef = "ORANGE-PAYOUT-1700000000000";

      await provider
        .given("Orange disbursement service is available")
        .uponReceiving("a request to disburse funds to a subscriber")
        .withRequest({
          method: "POST",
          path: "/v1/payments/disburse",
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${BEARER_TOKEN}`),
            "Content-Type": "application/json",
          },
          body: {
            reference: like(payoutRef),
            payee: {
              msisdn: like("+237600000001"),
            },
            transaction: {
              amount: like(500),
              currency: like("XAF"),
              id: like(payoutRef),
            },
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            status: like("SUCCESS"),
            id: like(payoutRef),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.post(
            `${mockServer.url}/v1/payments/disburse`,
            {
              reference: payoutRef,
              payee: { msisdn: "+237600000001" },
              transaction: { amount: 500, currency: "XAF", id: payoutRef },
            },
            {
              headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
              },
            },
          );
          expect(res.status).toBe(200);
          expect(res.data.id).toBeDefined();
        });
    });
  });

  describe("GET /v1/payments/:reference — check transaction status", () => {
    it("returns COMPLETED status for a successful transaction", async () => {
      await provider
        .given("Orange transaction is completed")
        .uponReceiving("a request to check a completed transaction status")
        .withRequest({
          method: "GET",
          path: `/v1/payments/${REFERENCE}`,
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${BEARER_TOKEN}`),
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            id: like(REFERENCE),
            status: "COMPLETED",
            amount: like(1000),
            currency: like("XAF"),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.get(
            `${mockServer.url}/v1/payments/${REFERENCE}`,
            {
              headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
            },
          );
          expect(res.status).toBe(200);
          expect(res.data.status).toBe("COMPLETED");
        });
    });

    it("returns FAILED status for a failed transaction", async () => {
      await provider
        .given("Orange transaction has failed")
        .uponReceiving("a request to check a failed transaction status")
        .withRequest({
          method: "GET",
          path: `/v1/payments/${REFERENCE}`,
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${BEARER_TOKEN}`),
          },
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            id: like(REFERENCE),
            status: "FAILED",
            reason: like("INSUFFICIENT_FUNDS"),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.get(
            `${mockServer.url}/v1/payments/${REFERENCE}`,
            {
              headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
            },
          );
          expect(res.status).toBe(200);
          expect(res.data.status).toBe("FAILED");
        });
    });

    it("returns 404 for an unknown transaction reference", async () => {
      const unknownRef = "ORANGE-PAYMENT-UNKNOWN";

      await provider
        .given("Orange transaction does not exist")
        .uponReceiving("a request to check a non-existent transaction")
        .withRequest({
          method: "GET",
          path: `/v1/payments/${unknownRef}`,
          headers: {
            Authorization: regex(`^Bearer .+$`, `Bearer ${BEARER_TOKEN}`),
          },
        })
        .willRespondWith({
          status: 404,
          headers: { "Content-Type": "application/json" },
          body: {
            message: like("Transaction not found"),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await axios.get(
            `${mockServer.url}/v1/payments/${unknownRef}`,
            {
              headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
              validateStatus: () => true,
            },
          );
          expect(res.status).toBe(404);
        });
    });
  });
});

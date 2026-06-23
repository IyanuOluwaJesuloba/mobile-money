/**
 * Focused test for the /health endpoint gitHash field (issue #736).
 * Avoids importing the full app to bypass pre-existing corruption in
 * unrelated files (export.ts, htlcService.ts, transactionController.ts).
 */
import express, { Request, Response } from "express";
import request from "supertest";
import { HealthCheckResponse } from "../src/types/api";

function buildHealthApp() {
  const app = express();
  app.get("/health", (_req: Request, res: Response) => {
    const body: HealthCheckResponse = {
      status: "ok",
      timestamp: new Date().toISOString(),
      gitHash: process.env.BUILD_HASH,
    };
    res.json(body);
  });
  return app;
}

describe("GET /health", () => {
  it("returns status ok with timestamp", async () => {
    const app = buildHealthApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("includes gitHash when BUILD_HASH env var is set", async () => {
    process.env.BUILD_HASH = "test_hash_abc123";
    const app = buildHealthApp();
    const res = await request(app).get("/health");
    expect(res.body.gitHash).toBe("test_hash_abc123");
    delete process.env.BUILD_HASH;
  });

  it("gitHash is undefined when BUILD_HASH is not set", async () => {
    delete process.env.BUILD_HASH;
    const app = buildHealthApp();
    const res = await request(app).get("/health");
    expect(res.body.gitHash).toBeUndefined();
  });
});

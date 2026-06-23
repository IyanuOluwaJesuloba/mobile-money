import { Router, Request, Response } from "express";
import { verifyMtnCallbackSignature } from "../middleware/mtnCallbackSignature";
import { ingestRateLimiter } from "../middleware/ingestRateLimit";

const router = Router();

// Rate-limit ingest traffic before any heavier processing (signature verification, DB writes).
// Drops malicious floods early and cheaply.
router.use(ingestRateLimiter);

// This route is intended to receive MTN MoMo Open API callback payloads.
// Signature verification is applied to all incoming MTN callback requests.
router.use(verifyMtnCallbackSignature);

router.post("/callback", async (req: Request, res: Response) => {
  // Future callback processing can be added here.
  // Currently the MTN callback is authenticated and acknowledged.
  res.status(200).json({ status: "accepted" });
});

export default router;

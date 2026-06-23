import { Router } from "express";
import { ExchangeRateBufferController } from "../controllers/exchangeRateBufferController";

const router = Router();
const controller = new ExchangeRateBufferController();

// List all buffer configs
router.get("/", controller.listBuffers);

// Preview a buffered rate
router.post("/preview", controller.previewRate);

// Get buffers by provider
router.get("/provider/:provider", controller.getByProvider);

// Get single buffer
router.get("/:id", controller.getBuffer);

// Create buffer
router.post("/", controller.createBuffer);

// Update buffer
router.patch("/:id", controller.updateBuffer);

// Delete buffer
router.delete("/:id", controller.deleteBuffer);

export default router;

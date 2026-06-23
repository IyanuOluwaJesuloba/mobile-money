import { Router } from "express";
import { AssetWizardController } from "../../controllers/admin/assetWizardController";

const router = Router();
const controller = new AssetWizardController();

/**
 * @openapi
 * /api/admin/assets:
 *   get:
 *     summary: List all anchored assets
 *     tags: [Admin, Assets]
 *     responses:
 *       200:
 *         description: List of assets
 */
router.get("/", controller.listAssets);

/**
 * @openapi
 * /api/admin/assets/issue:
 *   post:
 *     summary: Issue a new anchored asset on Stellar
 *     tags: [Admin, Assets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assetCode, limit, name]
 *             properties:
 *               assetCode: { type: string, example: "USDC" }
 *               limit: { type: string, example: "1000000" }
 *               name: { type: string, example: "USD Coin" }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Asset issued successfully
 */
router.post("/issue", controller.issueAsset);

export default router;

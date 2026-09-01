import express from "express";
import { syncPrices } from "../controllers/marketDataController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

// Needs a broker account because the market session is obtained by following
// that account's analytics handoff.
router.post("/sync/:id", syncPrices);

export default router;

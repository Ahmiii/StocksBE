import express from "express";
import {
  syncPrices,
  getPrices,
  syncSecurities,
  searchSecurities,
  getTrend,
} from "../controllers/marketDataController.js";
import { getSecuritiesPayout } from "../controllers/corporateActionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/securities", searchSecurities);
router.post("/securities/:id", syncSecurities);
router.post("/sync/:id", syncPrices);
router.get("/prices/:symbol", getPrices);
router.get("/trend/:symbol", getTrend);
router.get("/payouts/:symbol", getSecuritiesPayout);

export default router;

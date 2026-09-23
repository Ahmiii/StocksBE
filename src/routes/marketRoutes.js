import express from "express";
import {
  getSecurityPayoutOfCompany,
  saveBulkSecuritiesPayout,
  saveSingleSecuritiesPayout,
} from "../controllers/corporateActionController.js";
import {
  saveBulkSecuritiesFundamentals,
  saveSingleSecuritiesFundamentals,
} from "../controllers/fundamentalsController.js";
import {
  getPrices,
  getTrend,
  searchSecurities,
  syncPrices,
  syncSecurities,
} from "../controllers/marketDataController.js";
import { getValuation } from "../controllers/valuationController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
const router = express.Router();
router.use(authMiddleware);

router.get("/securities", searchSecurities);
router.post("/securities/:id", syncSecurities);
router.post("/sync/:id", syncPrices);
router.get("/prices/:symbol", getPrices);
router.get("/trend/:symbol", getTrend);
router.get("/valuation/:symbol", getValuation);
router.post("/payout/:symbol", saveSingleSecuritiesPayout);
router.get("/payout/:symbol", getSecurityPayoutOfCompany);
router.post("/bulk-payouts/sync/:id", saveBulkSecuritiesPayout);
router.post("/fundamentals/:symbol", saveSingleSecuritiesFundamentals);
router.post("/bulk-fundamentals/sync/:id", saveBulkSecuritiesFundamentals);

export default router;

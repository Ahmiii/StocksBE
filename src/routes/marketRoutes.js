import express from "express";
import {
  syncPrices,
  getPrices,
  syncSecurities,
  searchSecurities,
  getTrend,
} from "../controllers/marketDataController.js";
import {
  saveBulkSecuritiesPayout,
  getSecurityPayoutOfCompany,
  saveSingleSecuritiesPayout,
} from "../controllers/corporateActionController.js";
import {
  saveSingleSecurityFundamentals,
  saveBulkSecuritiesFundamentals,
} from "../controllers/fundamentalsController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";
const router = express.Router();
router.use(authMiddleware);

router.get("/securities", searchSecurities);
router.post("/securities/:id", syncSecurities);
router.post("/sync/:id", syncPrices);
router.get("/prices/:symbol", getPrices);
router.get("/trend/:symbol", getTrend);
router.post("/payout/:symbol", saveSingleSecuritiesPayout);
router.get("/payout/:symbol", getSecurityPayoutOfCompany);
router.post("/bulk-payouts/sync/:id", saveBulkSecuritiesPayout);
router.post("/fundamentals/:symbol", saveSingleSecurityFundamentals);
router.post("/bulk-fundamentals/sync/:id", saveBulkSecuritiesFundamentals);

export default router;

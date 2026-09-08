import express from "express";
import {
  getAHLSession,
  getAccounts,
  disconnectAccount,
  getHistory
} from "../controllers/brokerAccountController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { fullSyncNow } from "../jobs/dailySync.js";

const router = express.Router();
router.use(authMiddleware);

router.post("/accounts", getAHLSession);
router.get("/accounts", getAccounts);
router.patch("/accounts/:id/disconnect", disconnectAccount);
router.post("/accounts/:id/sync", getHistory);
// Same as the nightly job: log in with the stored password, then trades + prices.
router.post("/accounts/:id/full-sync", fullSyncNow);

export default router;

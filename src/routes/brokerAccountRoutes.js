import express from "express";
import {
  getAHLSession,
  getAccounts,
  disconnectAccount,
  getHistory
} from "../controllers/brokerAccountController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

router.post("/accounts", getAHLSession);
router.get("/accounts", getAccounts);
router.patch("/accounts/:id/disconnect", disconnectAccount);
router.post("/accounts/:id/sync", getHistory);

export default router;

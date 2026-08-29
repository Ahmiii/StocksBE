import express from "express";
import {
  getAHLSession,
  getAccounts,
  disconnectAccount,
} from "../controllers/brokerAccountController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

router.post("/account_info", getAHLSession);
router.get("/accounts", getAccounts);
router.patch("/accounts/:id/disconnect", disconnectAccount);

export default router;

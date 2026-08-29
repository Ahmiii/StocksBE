import express from "express";
import { getAHLSession } from "../controllers/brokerAccountController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
const router = express?.Router();

router?.post("/account_info", authMiddleware, getAHLSession);

export default router;

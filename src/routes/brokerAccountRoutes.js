import express from "express";
import { getAHLSession } from "../controllers/brokerAccountController.js";
const router = express?.Router();

router?.post("/account_info", getAHLSession);

export default router
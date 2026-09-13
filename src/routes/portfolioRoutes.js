import express from "express";
const router = express.Router();
import { authMiddleware } from "../middlewares/authMiddleware.js";
import {
  portfolioList,
  positionsList,
  tradeList,
  benchmark,
  incomeFromDividends,
} from "../controllers/portfolioController.js";

router.use(authMiddleware);
router.get("/list", portfolioList);
router.get("/:id/position-list", positionsList);
router.get("/:id/trade-list", tradeList);
router.get("/:id/benchmark", benchmark);
router.get("/:id/dividend-income", incomeFromDividends);

export default router;

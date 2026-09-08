import express from "express";
const router = express.Router();
import { authMiddleware } from "../middlewares/authMiddleware.js";
import {
  portfolioList,
  positionsList,
  tradeList,
  benchmark,
} from "../controllers/portfolioController.js";

router.use(authMiddleware);
router.get("/getPortfolioList", portfolioList);
router.get("/:id/positions", positionsList);
router.get("/:id/trades", tradeList);
router.get("/:id/benchmark", benchmark);

export default router;

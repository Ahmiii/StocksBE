import express from "express";
import {
  syncPrices,
  getPrices,
  syncSecurities,
} from "../controllers/marketDataController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);


router.post("/securities/:id", syncSecurities);
router.post("/sync/:id", syncPrices);
router.get("/prices/:symbol", getPrices);

export default router;

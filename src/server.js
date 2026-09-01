import express from "express";
import { connectDB, disconnectDB } from "./config/db.js";
import AuthRoutes from "./routes/authRoutes.js";
import BrokerAcccountRoutes from "./routes/brokerAccountRoutes.js";
import PortfolioRouts from "./routes/portfolioRoutes.js";
import MarketRoutes from "./routes/marketRoutes.js";
connectDB();

const app = express();
app.use(express.json());
app.use("/auth", AuthRoutes);
app.use("/broker", BrokerAcccountRoutes);
app.use("/portfolio", PortfolioRouts);
app.use("/market", MarketRoutes);
const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});

const shutdown = (signal) => {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    try {
      await disconnectDB();
    } catch (error) {
      console.error("Error during DB disconnect", error);
    } finally {
      process.exit(0);
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection", error);
  server.close(async () => {
    try {
      await disconnectDB();
    } finally {
      process.exit(1);
    }
  });
});

import express from "express";
import { connectDB, disconnectDB } from "./config/db.js";
import AuthRoutes from "./routes/authRoutes.js";
import BrokerAcccountRoutes from "./routes/brokerAccountRoutes.js";
import PortfolioRouts from "./routes/portfolioRoutes.js";
import MarketRoutes from "./routes/marketRoutes.js";
import WatchlistRoutes from "./routes/watchlistRoutes.js";
import { startDailySync } from "./jobs/dailySync.js";
connectDB();

const app = express();
app.use(express.json());
app.use("/auth", AuthRoutes);
app.use("/broker", BrokerAcccountRoutes);
app.use("/portfolio", PortfolioRouts);
app.use("/market", MarketRoutes);
app.use("/watchlist", WatchlistRoutes);

// Unknown routes and thrown errors both answer in JSON, never Express's HTML page.
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Something went wrong." });
});

const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
  startDailySync();
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

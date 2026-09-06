import { prisma } from "../config/db.js";
import { getMarketSession } from "../services/brokderSessionStore.js";
import { fetchMarket, savePrices } from "./marketDataController.js";

const BENCHMARK_SYMBOL = "KSE100";

// Latest two closes, so we can show the price and the day's move.
const latestBars = {
  orderBy: { tradeDate: "desc" },
  take: 2,
  select: { close: true, tradeDate: true },
};

// Turns a security (with its last two bars) into one list row.
const toRow = (security) => {
  const [last, prev] = security.dailyPrices;
  const lastPrice = last ? Number(last.close) : null;
  const prevPrice = prev ? Number(prev.close) : null;
  const change = lastPrice !== null && prevPrice !== null ? lastPrice - prevPrice : null;

  return {
    securityId: security.id,
    symbol: security.symbol,
    companyName: security.companyName,
    sector: security.sector,
    lastPrice,
    change,
    changePct: change === null ? null : (change / prevPrice) * 100,
    asOf: last ? last.tradeDate.toISOString().slice(0, 10) : null,
  };
};

const getWatchlist = async (req, res) => {
  const [items, benchmark] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "asc" },
      select: {
        security: {
          select: { id: true, symbol: true, companyName: true, sector: true, dailyPrices: latestBars },
        },
      },
    }),
    prisma.security.findUnique({
      where: { symbol: BENCHMARK_SYMBOL },
      select: { id: true, symbol: true, companyName: true, sector: true, dailyPrices: latestBars },
    }),
  ]);

  res.status(200).json({
    message: "success",
    data: {
      benchmark: benchmark ? toRow(benchmark) : null,
      items: items.map((item) => toRow(item.security)),
    },
  });
};

const addToWatchlist = async (req, res) => {
  const security = await prisma.security.findUnique({
    where: { id: req.params.securityId },
    select: { id: true, symbol: true },
  });
  if (!security) return res.status(404).json({ error: "security does not exist" });

  // The unique index on (userId, securityId) makes a second add a no-op.
  await prisma.watchlistItem.upsert({
    where: { userId_securityId: { userId: req.user.id, securityId: security.id } },
    create: { userId: req.user.id, securityId: security.id },
    update: {},
  });

  // Pull the price history now if we can, so the stock does not show "—" until
  // the next sync. Needs a live market session; if there is none, the next
  // POST /market/sync/:id picks it up because watched symbols are in scope.
  let pricesLoaded = (await prisma.dailyPrice.count({ where: { securityId: security.id } })) > 0;

  if (!pricesLoaded) {
    const accounts = await prisma.brokerAccount.findMany({
      where: { userId: req.user.id },
      select: { id: true },
    });
    const market = accounts.map((a) => getMarketSession(a.id)).find(Boolean);

    if (market) {
      const bars = await fetchMarket(`/daily/${security.symbol}`, market.cookieHeader);
      pricesLoaded = (await savePrices(security.id, bars)) > 0;
    }
  }

  res.status(200).json({
    message: "success",
    data: { symbol: security.symbol, pricesLoaded },
  });
};

const removeFromWatchlist = async (req, res) => {
  const result = await prisma.watchlistItem.deleteMany({
    where: { userId: req.user.id, securityId: req.params.securityId },
  });
  if (result.count === 0) return res.status(404).json({ error: "not in watchlist" });

  res.status(200).json({ message: "success" });
};

export { getWatchlist, addToWatchlist, removeFromWatchlist };

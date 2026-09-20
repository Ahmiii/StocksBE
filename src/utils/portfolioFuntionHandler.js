import { prisma } from "../config/db.js";
import { formatDate } from "./dateRange.js";
const round2 = (value) => {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(round2);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, round2(inner)]),
    );
  }
  return value;
};

// Trades, open positions and price history for one portfolio, as plain
// numbers (Prisma hands Decimals back as strings).
const loadBenchmarkData = async (portfolioId) => {
  const tradeRows = await prisma.trade.findMany({
    where: { portfolioId },
    orderBy: [{ executedAt: "asc" }, { id: "asc" }],
    select: {
      side: true,
      quantity: true,
      price: true,
      commission: true,
      executedAt: true,
      security: { select: { symbol: true } },
    },
  });
  const trades = tradeRows.map((row) => ({
    symbol: row.security.symbol,
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    commission: Number(row.commission),
    date: formatDate(row.executedAt),
  }));

  const positionRows = await prisma.position.findMany({
    where: { portfolioId, quantity: { gt: 0 } },
    select: {
      quantity: true,
      avgCost: true,
      security: { select: { symbol: true } },
    },
  });
  const positions = positionRows.map((row) => ({
    symbol: row.security.symbol,
    quantity: Number(row.quantity),
    avgCost: Number(row.avgCost),
  }));

  const symbols = [...new Set(trades.map((trade) => trade.symbol)), "KSE100"];
  const bars = await prisma.dailyPrice.findMany({
    where: { security: { symbol: { in: symbols } } },
    orderBy: { tradeDate: "asc" },
    select: {
      tradeDate: true,
      close: true,
      security: { select: { symbol: true } },
    },
  });
  const prices = {};
  for (const bar of bars) {
    const symbol = bar.security.symbol;
    if (!prices[symbol]) prices[symbol] = new Map();
    prices[symbol].set(formatDate(bar.tradeDate), Number(bar.close));
  }

  //splits and bonus shares on record, so a trade made before one can be counted in today's shares.
  //one that is announced but not yet in effect is left out, the prices are not divided for it yet
  const shareChangeRows = await prisma.corporateAction.findMany({
    where: {
      type: { in: ["BONUS_SHARE", "SPLIT"] },
      ratio: { not: null },
      exDate: { lte: new Date() },
      security: { symbol: { in: symbols } },
    },
    orderBy: { exDate: "asc" },
    select: { exDate: true, ratio: true, security: { select: { symbol: true } } },
  });
  const shareChanges = [];
  for (const row of shareChangeRows) {
    shareChanges.push({
      symbol: row.security.symbol,
      date: formatDate(row.exDate),
      ratio: Number(row.ratio),
    });
  }

  return { trades, positions, prices, shareChanges };
};

// Percent change of both lines between two points of the series.
const returnBetween = (from, to) => ({
  from: from.date,
  to: to.date,
  portfolio: (to.portfolio / from.portfolio - 1) * 100,
  benchmark: (to.benchmark / from.benchmark - 1) * 100,
  netCashInAtEnd: to.netCashIn,
});

export { loadBenchmarkData, returnBetween,round2 };

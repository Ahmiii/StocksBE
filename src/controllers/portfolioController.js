import { prisma } from "../config/db.js";
import { parseDateRange, formatDate } from "../utils/dateRange.js";
import {
  detectAdjustedSplits,
  walkPortfolio,
  xirr,
  positionsVsBenchmark,
} from "../utils/benchmark.js";

const portfolioList = async (req, res) => {
  const portfoliolist = await prisma.portfolio.findMany({
    where: {
      userId: req?.user?.id,
    },
  });
  res?.status(200).json({
    message: "success",
    data: {
      portfoliolist,
    },
  });
};

const positionsList = async (req, res) => {
  const portfolioId = req?.params?.id;
  const { from, to, error } = parseDateRange(req.query);
  if (error) return res.status(400).json({ error });

  // Every position in the portfolio, each with its two newest price rows:
  // today's close and the close before it.
  const positionRows = await prisma.position.findMany({
    where: {
      portfolioId: portfolioId,
      portfolio: {
        userId: req?.user?.id,
      },
    },
    select: {
      id: true,
      portfolioId: true,
      securityId: true,
      quantity: true,
      avgCost: true,
      realizedPnl: true,
      security: {
        select: {
          symbol: true,
          companyName: true,
          dailyPrices: {
            orderBy: { tradeDate: "desc" },
            take: 2,
            select: { close: true, tradeDate: true },
          },
        },
      },
    },
  });

  // Keep only positions that were held at some point inside the requested
  // range: either shares were already held when the range started, or a buy
  // happened inside it.
  const trades = await prisma.trade.findMany({
    where: { portfolioId },
    select: { securityId: true, side: true, quantity: true, executedAt: true },
  });
  const tradesBySecurity = Object.groupBy(trades, (trade) => trade.securityId);
  const positionsHeldInRange = positionRows.filter((row) => {
    const tradesOfThisStock = tradesBySecurity[row.securityId];
    if (!tradesOfThisStock) return Number(row.quantity) > 0;
    let quantityAtStart = 0;
    for (const trade of tradesOfThisStock) {
      if (trade.executedAt > to) continue;
      if (trade.executedAt < from) {
        quantityAtStart += (trade.side === "BUY" ? 1 : -1) * Number(trade.quantity);
      } else if (trade.side === "BUY") {
        return true;
      }
    }
    return quantityAtStart > 0;
  });

  // Prices inside the range draw each holding's small trend line. A separate
  // query, so a stock with no prices in the range (delisted, say) still keeps
  // its lastPrice from above.
  const pricesInRange = await prisma.dailyPrice.findMany({
    where: {
      securityId: { in: positionsHeldInRange.map((row) => row.securityId) },
      tradeDate: { gte: from, lte: to },
    },
    orderBy: { tradeDate: "asc" },
    select: { securityId: true, tradeDate: true, close: true },
  });
  const trendBySecurity = Object.groupBy(pricesInRange, (price) => price.securityId);

  // The newest price date across the holdings. A stock whose latest price is
  // older than this (a delisted one, say) has no "today" to speak of.
  const newestPriceDate = positionsHeldInRange
    .map((row) => row.security.dailyPrices[0]?.tradeDate)
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  // Prisma hands Decimals back as strings, so everything is converted once here
  // rather than in every client that renders a number.
  const positions = positionsHeldInRange.map((row) => {
    const quantity = Number(row.quantity);
    const avgCost = Number(row.avgCost);
    const today = row.security.dailyPrices[0]; // newest price row
    const previous = row.security.dailyPrices[1]; // the one before it
    const lastPrice = today ? Number(today.close) : null;
    const investedValue = quantity * avgCost;
    const marketValue = lastPrice === null ? null : quantity * lastPrice;

    // Day change only when this stock's newest price is as fresh as the rest.
    const hasFreshPrice = today && today.tradeDate.getTime() === newestPriceDate?.getTime();
    const previousClose = hasFreshPrice && previous ? Number(previous.close) : null;
    const dayChange = previousClose === null ? null : quantity * (lastPrice - previousClose);

    return {
      id: row.id,
      portfolioId: row.portfolioId,
      symbol: row.security.symbol,
      companyName: row.security.companyName,
      quantity,
      avgCost,
      lastPrice,
      priceAsOf: today ? formatDate(today.tradeDate) : null,
      previousClose,
      previousCloseDate: previousClose === null ? null : formatDate(previous.tradeDate),
      dayChange,
      dayChangePct: previousClose === null ? null : (lastPrice / previousClose - 1) * 100,
      investedValue,
      marketValue,
      unrealizedPnl: marketValue === null ? null : marketValue - investedValue,
      unrealizedPct:
        marketValue === null || investedValue === 0
          ? null
          : ((marketValue - investedValue) / investedValue) * 100,
      realizedPnl: Number(row.realizedPnl),
      trend: (trendBySecurity[row.securityId] ?? []).map((price) => ({
        date: formatDate(price.tradeDate),
        close: Number(price.close),
      })),
    };
  });

  const open = positions.filter((p) => p.quantity > 0);
  const priced = open.filter((p) => p.marketValue !== null);
  const invested = priced.reduce((sum, p) => sum + p.investedValue, 0);
  const marketValue = priced.reduce((sum, p) => sum + p.marketValue, 0);

  // Today's move: the rupee changes added up, as a percent of what those
  // holdings were worth the day before.
  const positionsWithDayChange = open.filter((p) => p.dayChange !== null);
  const dayChange = positionsWithDayChange.reduce((sum, p) => sum + p.dayChange, 0);
  const valueBeforeToday = positionsWithDayChange.reduce(
    (sum, p) => sum + p.quantity * p.previousClose,
    0,
  );
  // How much of the portfolio the day change covers. On the evening of a sync
  // the broker has priced today's held stocks but the provider's bars for the
  // smaller ones arrive later, so this can be below 100% for a few hours.
  const valueWithDayChange = positionsWithDayChange.reduce((sum, p) => sum + p.marketValue, 0);
  const dayChangeCoverage = marketValue > 0 ? (valueWithDayChange / marketValue) * 100 : null;
  // The day the change is measured from — Friday on a Monday, not "yesterday".
  const dayChangeFrom = positionsWithDayChange.map((p) => p.previousCloseDate).sort().at(-1) ?? null;

  res?.status(200)?.json({
    message: "success",
    data: {
      range: { from: formatDate(from), to: formatDate(to) },
      positions,
      summary: {
        invested,
        marketValue,
        unrealizedPnl: marketValue - invested,
        unrealizedPct: invested === 0 ? null : ((marketValue - invested) / invested) * 100,
        dayChange: positionsWithDayChange.length ? dayChange : null,
        dayChangePct: valueBeforeToday > 0 ? (dayChange / valueBeforeToday) * 100 : null,
        dayChangeAsOf: newestPriceDate ? formatDate(newestPriceDate) : null,
        dayChangeFrom,
        dayChangeCoverage,
        realizedPnl: positions.reduce((sum, p) => sum + p.realizedPnl, 0),
        openPositions: open.length,
        pricedPositions: priced.length,
        unpricedPositions: open.length - priced.length,
      },
    },
  });
};

const tradeList = async (req, res) => {
  const portfolioId = req?.params?.id;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = {
    portfolioId: portfolioId,
    portfolio: {
      userId: req?.user?.id,
    },
  };

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      select: {
        id: true,
        portfolioId: true,
        side: true,
        quantity: true,
        price: true,
        commission: true,
        netAmount: true,
        executedAt: true,
        security: {
          select: {
            symbol: true,
            companyName: true,
          },
        },
      },
      orderBy: [{ executedAt: "desc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    }),
    prisma.trade.count({ where }),
  ]);

  res?.status(200)?.json({
    message: "success",
    data: {
      trades,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + trades.length < total,
      },
    },
  });
};

// ---------------------------------------------------------------------------
// GET /portfolio/:id/benchmark — the portfolio against KSE100.
// The maths is in utils/benchmark.js. This handler loads the data, runs it,
// and shapes the response.
// ---------------------------------------------------------------------------

// Where the story splits into "before" and "since" for the phases block.
const PHASE_CUT = "2026-02-01";

// Rounds every number inside the response to 2 decimals.
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
    select: { quantity: true, avgCost: true, security: { select: { symbol: true } } },
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
    select: { tradeDate: true, close: true, security: { select: { symbol: true } } },
  });
  const prices = {};
  for (const bar of bars) {
    const symbol = bar.security.symbol;
    if (!prices[symbol]) prices[symbol] = new Map();
    prices[symbol].set(formatDate(bar.tradeDate), Number(bar.close));
  }

  return { trades, positions, prices };
};

// Percent change of both lines between two points of the series.
const returnBetween = (from, to) => ({
  from: from.date,
  to: to.date,
  portfolio: (to.portfolio / from.portfolio - 1) * 100,
  benchmark: (to.benchmark / from.benchmark - 1) * 100,
  netCashInAtEnd: to.netCashIn,
});

const benchmark = async (req, res) => {
  const portfolioId = req.params.id;
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId: req.user.id },
    select: { id: true },
  });
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

  const { trades, positions, prices } = await loadBenchmarkData(portfolioId);
  if (!trades.length) return res.status(400).json({ error: "No trades to benchmark." });
  if (!prices.KSE100) return res.status(400).json({ error: "KSE100 prices not synced yet." });

  const splits = detectAdjustedSplits(trades, prices);
  const walk = walkPortfolio(trades, prices, splits);
  const series = walk.series;
  const first = series[0];
  const last = series[series.length - 1];
  const asOf = last.date;

  // XIRR: money paid is negative, and today's value comes back as the last inflow.
  const cashFlows = trades.map((trade) => ({
    date: trade.date,
    amount:
      trade.side === "BUY"
        ? -(trade.quantity * trade.price + trade.commission)
        : trade.quantity * trade.price - trade.commission,
  }));

  const cut = series.find((point) => point.date >= PHASE_CUT);
  const phases =
    cut && cut !== first && cut !== last
      ? [returnBetween(first, cut), returnBetween(cut, last)]
      : [returnBetween(first, last)];

  const data = {
    asOf,
    window: { from: first.date, to: asOf, tradingDays: series.length },
    headline: {
      netCashIn: walk.netCashIn,
      portfolio: walk.portfolioValue,
      benchmark: walk.shadowValue,
      difference: walk.portfolioValue - walk.shadowValue,
      portfolioReturnOnCash: (walk.portfolioValue / walk.netCashIn - 1) * 100,
      benchmarkReturnOnCash: (walk.shadowValue / walk.netCashIn - 1) * 100,
    },
    timeWeighted: {
      portfolio: walk.portfolioReturn,
      benchmark: walk.benchmarkReturn,
      alpha: walk.portfolioReturn - walk.benchmarkReturn,
      maxDrawdown: walk.maxDrawdown,
    },
    moneyWeighted: {
      portfolioXirr: xirr([...cashFlows, { date: asOf, amount: walk.portfolioValue }]) * 100,
      benchmarkXirr: xirr([...cashFlows, { date: asOf, amount: walk.shadowValue }]) * 100,
    },
    phases,
    series: series.map((point) => ({
      date: point.date,
      portfolio: point.portfolio,
      benchmark: point.benchmark,
      value: point.value,
      netCashIn: point.netCashIn,
    })),
    positions: positionsVsBenchmark(positions, trades, prices, asOf),
    dataNotes: {
      adjustedSplits: Object.entries(splits).map(([symbol, split]) => ({
        symbol,
        ratio: split.ratio,
        lastPreSplitTrade: split.lastPreDate,
      })),
      dividendsIncluded: false,
    },
  };

  res.status(200).json({ message: "success", data: round2(data) });
};

export { portfolioList, positionsList, tradeList, benchmark };

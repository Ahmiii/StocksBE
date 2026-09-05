import { prisma } from "../config/db.js";
import { parseDateRange, formatDate } from "../utils/dateRange.js";

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

  const rows = await prisma.position.findMany({
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
          // Only the newest bar, for lastPrice. Holdings in the sub-investor
          // CDC account have no price at all, which is why it can be null.
          dailyPrices: {
            orderBy: { tradeDate: "desc" },
            take: 1,
            select: { close: true, tradeDate: true },
          },
        },
      },
    },
  });

  // Only stocks held at some point in the window: quantity at `from` was
  // positive, or there was a buy inside it. A position with no trade rows at
  // all (shares that only exist in the broker's holdings list) is kept as-is.
  const trades = await prisma.trade.findMany({
    where: { portfolioId },
    select: { securityId: true, side: true, quantity: true, executedAt: true },
  });
  const tradesBySecurity = Object.groupBy(trades, (t) => t.securityId);
  const held = rows.filter((row) => {
    const list = tradesBySecurity[row.securityId];
    if (!list) return Number(row.quantity) > 0;
    let qtyAtFrom = 0;
    for (const t of list) {
      if (t.executedAt > to) continue;
      if (t.executedAt < from) qtyAtFrom += (t.side === "BUY" ? 1 : -1) * Number(t.quantity);
      else if (t.side === "BUY") return true;
    }
    return qtyAtFrom > 0;
  });

  // Trend bars are a separate query so a stock with nothing in the requested
  // range (e.g. delisted) still keeps its lastPrice from above.
  const bars = await prisma.dailyPrice.findMany({
    where: {
      securityId: { in: held.map((row) => row.securityId) },
      tradeDate: { gte: from, lte: to },
    },
    orderBy: { tradeDate: "asc" },
    select: { securityId: true, tradeDate: true, close: true },
  });
  const trendBySecurity = Object.groupBy(bars, (bar) => bar.securityId);

  // Prisma hands Decimals back as strings, so everything is converted once here
  // rather than in every client that renders a number.
  const positions = held.map((row) => {
    const quantity = Number(row.quantity);
    const avgCost = Number(row.avgCost);
    const bar = row.security.dailyPrices[0];

    const lastPrice = bar ? Number(bar.close) : null;
    const investedValue = quantity * avgCost;
    const marketValue = lastPrice === null ? null : quantity * lastPrice;

    return {
      id: row.id,
      portfolioId: row.portfolioId,
      symbol: row.security.symbol,
      companyName: row.security.companyName,
      quantity,
      avgCost,
      lastPrice,
      priceAsOf: bar ? bar.tradeDate.toISOString().slice(0, 10) : null,
      investedValue,
      marketValue,
      unrealizedPnl: marketValue === null ? null : marketValue - investedValue,
      unrealizedPct:
        marketValue === null || investedValue === 0
          ? null
          : ((marketValue - investedValue) / investedValue) * 100,
      realizedPnl: Number(row.realizedPnl),
      trend: (trendBySecurity[row.securityId] ?? []).map((b) => ({
        date: formatDate(b.tradeDate),
        close: Number(b.close),
      })),
    };
  });

  const open = positions.filter((p) => p.quantity > 0);
  const priced = open.filter((p) => p.marketValue !== null);

  const invested = priced.reduce((sum, p) => sum + p.investedValue, 0);
  const marketValue = priced.reduce((sum, p) => sum + p.marketValue, 0);

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

export { portfolioList, positionsList, tradeList };

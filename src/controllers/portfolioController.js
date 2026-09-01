import { prisma } from "../config/db.js";

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
      quantity: true,
      avgCost: true,
      realizedPnl: true,
      security: {
        select: {
          symbol: true,
          companyName: true,
          // Only the newest bar. Holdings in the sub-investor CDC account have
          // no price at all, which is why lastPrice can come back null.
          dailyPrices: {
            orderBy: { tradeDate: "desc" },
            take: 1,
            select: { close: true, tradeDate: true },
          },
        },
      },
    },
  });

  // Prisma hands Decimals back as strings, so everything is converted once here
  // rather than in every client that renders a number.
  const positions = rows.map((row) => {
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
    };
  });

  const open = positions.filter((p) => p.quantity > 0);
  const priced = open.filter((p) => p.marketValue !== null);

  const invested = priced.reduce((sum, p) => sum + p.investedValue, 0);
  const marketValue = priced.reduce((sum, p) => sum + p.marketValue, 0);

  res?.status(200)?.json({
    message: "success",
    data: {
      positions,
      // Totals cover only the positions we can price, so the client can say so
      // rather than quietly understating the portfolio.
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

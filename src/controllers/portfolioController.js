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
  const positions = await prisma.position.findMany({
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
        },
      },
    },
  });
  res?.status(200)?.json({
    message: "success",
    data: {
      positions,
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

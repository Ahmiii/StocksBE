import { prisma } from "../config/db.js";
import {
  RISK_FREE_RATE,
  EQUITY_PREMIUM,
  TERMINAL_GROWTH,
  GROWTH_YEARS,
} from "../config/constants.js";
import {
  shareCount,
  startingCash,
  impliedGrowth,
  profitGrowth,
} from "../utils/valuation.js";
import { formatDate } from "../utils/dateRange.js";
import { round2 } from "../utils/portfolioFuntionHandler.js";
const getValuation = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const statements = {};
  const splits = [];
  const security = await prisma.security.findUnique({
    where: {
      symbol: symbol,
    },
    select: {
      id: true,
      symbol: true,
      sector: true,
    },
  });
  if (!security) {
    return res.status(404).json({ error: "security does not exist" });
  }
  const statementRows = await prisma.fundamental.findMany({
    where: {
      securityId: security.id,
    },
  });
  for (const row of statementRows) {
    statements[row.statement] = row.payload;
  }
  if (!statements.income) {
    return res.status(200).json({
      message: "success",
      data: {
        symbol,
        applicable: false,
        reason: "no statements for this stock",
      },
    });
  }
  const splitRows = await prisma.corporateAction.findMany({
    where: { securityId: security.id, type: "SPLIT" },
    orderBy: { exDate: "asc" },
  });
  for (const row of splitRows) {
    splits.push({ date: formatDate(row.exDate), ratio: Number(row.ratio) });
  }
  const latestPrice = await prisma.dailyPrice.findFirst({
    where: { securityId: security.id },
    orderBy: { tradeDate: "desc" },
  });
  if (!latestPrice) {
    return res.status(200).json({
      message: "success",
      data: { symbol, applicable: false, reason: "no price for this stock" },
    });
  }
  ///////

  const shares = shareCount(
    statements.balance,
    statements.fundamentals,
    splits,
  );
  if (shares === null) {
    // same applicable: false answer, reason "share count could not be confirmed"
  }
  const isBank = security.sector === "COMMERCIAL BANKS";
  const cash = startingCash(statements.cashflow, statements.income, isBank);
  if (cash === null) {
    // same answer, reason "no positive cash to value"
  }
  const price = Number(latestPrice.close);
  const marketCap = price * shares;
  const r = RISK_FREE_RATE + EQUITY_PREMIUM;
  const growth = impliedGrowth(
    cash.cash,
    marketCap,
    r,
    TERMINAL_GROWTH,
    GROWTH_YEARS,
  );
  const growthIfRLower = impliedGrowth(
    cash.cash,
    marketCap,
    r - 0.01,
    TERMINAL_GROWTH,
    GROWTH_YEARS,
  );
  const growthIfRHigher = impliedGrowth(
    cash.cash,
    marketCap,
    r + 0.01,
    TERMINAL_GROWTH,
    GROWTH_YEARS,
  );
  let delivered = profitGrowth(statements.income);
  if (delivered !== null) {
    delivered = delivered * 100;
  }

  res.status(200).json({
    message: "success",
    data: round2({
      symbol,
      applicable: true,
      asOf: formatDate(latestPrice.tradeDate),
      price,
      shares: shares * 1000,
      marketCap: marketCap * 1000,
      basis: cash.basis,
      startingCash: cash.cash * 1000,
      assumptions: { r, terminalGrowth: TERMINAL_GROWTH, years: GROWTH_YEARS },
      impliedGrowth: growth * 100,
      profitGrowth: delivered,
      sensitivity: {
        rMinus1: growthIfRLower * 100,
        rPlus1: growthIfRHigher * 100,
      },
    }),
  });
};

export { getValuation };

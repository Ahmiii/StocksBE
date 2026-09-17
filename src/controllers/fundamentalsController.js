import { prisma } from "../config/db.js";
import { fetchDashboardApi } from "../services/dashboardApi.js";
import { pauseBetweenCalls, providerSaysStop } from "../utils/pace.js";

const STATEMENTS = ["fundamentals", "income", "balance"];

const statementDashboardApi = async (symbol, statement, account) => {
  const { id, clientCode } = account;
  return fetchDashboardApi(
    "/company-statement",
    { symbol, interval: "annual", type: statement },
    { brokerAccountId: id, clientCode: clientCode },
  );
};

//one row per stock and statement, the provider's answer saved whole
const saveStatementInDB = async (securityId, statement, payload) => {
  await prisma.fundamental.upsert({
    where: { securityId_statement: { securityId, statement } },
    create: { securityId, statement, interval: payload.interval, payload },
    update: { payload, fetchedAt: new Date() },
  });
};

const saveAllSecuritiesFundamentalsPerAccount = async (account) => {
  const securitiesInPortfolioOrWatchlist = await prisma.security.findMany({
    where: {
      OR: [
        { positions: { some: { quantity: { gt: 0 } } } },
        { watchlistItems: { some: {} } },
      ],
      NOT: { symbol: "KSE100" },
    },
    select: { id: true, symbol: true },
    orderBy: { symbol: "asc" },
  });
  const allSecurityFundamentals = [];
  for (const security of securitiesInPortfolioOrWatchlist) {
    let saved = 0;
    try {
      for (const statement of STATEMENTS) {
        const payload = await statementDashboardApi(security.symbol, statement, account);
        //an ETF answers with no fields, nothing to keep
        if (payload.fields) {
          await saveStatementInDB(security.id, statement, payload);
          saved = saved + 1;
        }
        await pauseBetweenCalls();
      }
      allSecurityFundamentals.push({ symbol: security.symbol, saved });
    } catch (error) {
      allSecurityFundamentals.push({ symbol: security.symbol, error: error.message });
      if (providerSaysStop(error)) break;
    }
  }
  let totalSaved = 0;
  for (const result of allSecurityFundamentals) {
    totalSaved += result.saved ?? 0;
  }
  return {
    securities: allSecurityFundamentals.length,
    saved: totalSaved,
    results: allSecurityFundamentals,
  };
};

const saveBulkSecuritiesFundamentals = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true },
  });
  if (!account) {
    return res.status(404).json({ error: "account does not exist" });
  }
  let data;
  try {
    data = await saveAllSecuritiesFundamentalsPerAccount(account);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  res.status(200).json({ message: "success", data });
};

export { saveAllSecuritiesFundamentalsPerAccount, saveBulkSecuritiesFundamentals };

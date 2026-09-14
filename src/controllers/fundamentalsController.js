import { prisma } from "../config/db.js";
import { fetchDashboardApi } from "../services/dashboardApi.js";
import { pauseBetweenCalls, providerSaysStop } from "../utils/pace.js";
//one stock's fundamentals from the provider: 41 ratios for the trailing twelve months
//and seven years, with sector min, median and max
const fundamentalsDashboardApi = async (symbol, account) => {
  return fetchDashboardApi(
    "/company-statement",
    { symbol, interval: "annual", type: "fundamentals" },
    { brokerAccountId: account.id, clientCode: account.clientCode },
  );
};

//saves the provider's answer whole, one row per stock, replacing the old answer. an ETF gets
//an answer with no fields, saved too so the weekly rule stops us asking for it every night
const saveFundamentalsInDB = async (securityId, payload) => {
  const providerAt = payload.created ? new Date(payload.created) : null;
  const interval = payload.interval ?? "annual";
  await prisma.fundamental.upsert({
    where: { securityId },
    create: { securityId, interval, payload, providerAt },
    update: {
      interval,
      payload,
      providerAt,
      fetchedAt: new Date(),
    },
  });
};

const saveSingleSecurityFundamentals = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const security = await prisma.security.findUnique({ where: { symbol } });
  if (!security) {
    return res.status(404).json({ error: "security does not exist" });
  }
  const account = await prisma.brokerAccount.findFirst({
    where: { userId: req.user.id },
    select: { id: true, clientCode: true },
  });
  if (!account) {
    return res.status(404).json({ error: "No broker account linked." });
  }

  let payload;
  try {
    payload = await fundamentalsDashboardApi(symbol, account);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  await saveFundamentalsInDB(security.id, payload);

  res.status(200).json({
    message: "success",
    data: {
      symbol,
      periods: payload.periods ? payload.periods.length : 0,
      ratios: payload.fields ? payload.fields.length : 0,
      providerAt: payload.created ?? null,
    },
  });
};

const saveAllSecuritiesFundamentalsPerAccount = async (account) => {
  const securities = await prisma.security.findMany({
    where: {
      OR: [
        { positions: { some: { quantity: { gt: 0 } } } },
        { watchlistItems: { some: {} } },
      ],
      NOT: { symbol: "KSE100" },
    },
    select: {
      id: true,
      symbol: true,
      fundamental: { select: { fetchedAt: true } },
    },
    orderBy: { symbol: "asc" },
  });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const results = [];
  for (const security of securities) {
    if (security.fundamental && security.fundamental.fetchedAt > weekAgo) {
      results.push({ symbol: security.symbol, skipped: "fetched this week" });
      continue;
    }
    try {
      const payload = await fundamentalsDashboardApi(security.symbol, account);
      await saveFundamentalsInDB(security.id, payload);
      if (payload.fields) {
        results.push({ symbol: security.symbol, saved: true });
      } else {
        results.push({ symbol: security.symbol, skipped: "no fundamentals from the provider" });
      }
    } catch (error) {
      results.push({ symbol: security.symbol, error: error.message });
      if (providerSaysStop(error)) break; // rate limited or provider down: stop knocking
    }
    await pauseBetweenCalls();
  }

  let saved = 0;
  for (const result of results) {
    if (result.saved) {
      saved = saved + 1;
    }
  }
  return { securities: results.length, saved, results };
};

//POST /market/bulk-fundamentals/sync/:id — every held or watched stock, once a week
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

export {
  saveSingleSecurityFundamentals,
  saveAllSecuritiesFundamentalsPerAccount,
  saveBulkSecuritiesFundamentals,
};

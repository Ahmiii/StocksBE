import { prisma } from "../config/db.js";
import { fetchDashboardApi } from "../services/dashboardApi.js";
import { pauseBetweenCalls, providerSaysStop } from "../utils/pace.js";

// Turns the provider's rows into actions. Takes the rows, returns the list.

const payoutDashboardApi = async (symbol, account) => {
  const { id, clientCode } = account;
  return fetchDashboardApi(
    `/payouts/announcement-break-down/${symbol}`,
    {},
    { brokerAccountId: id, clientCode: clientCode },
  );
};

const payoutFilterData = (securityPayout) => {
  const cleanPayoutData = [];
  for (const payout of securityPayout) {
    if (payout.announcementAction !== "PUBLISH" || !payout.exDate) continue;

    if (Number(payout.dividend) > 0) {
      cleanPayoutData.push({
        type: "DIVIDEND",
        exDate: payout.exDate,
        amount: Number(payout.dividend),
        ratio: null,
        providerId: String(payout.id),
      });
    }
    if (Number(payout.bonus) > 0) {
      cleanPayoutData.push({
        type: "BONUS_SHARE",
        exDate: payout.exDate,
        amount: null,
        ratio: 1 + Number(payout.bonus) / 100,
        providerId: String(payout.id),
      });
    }
    if (Number(payout.rightIssue) > 0) {
      cleanPayoutData.push({
        type: "RIGHT_SHARE",
        exDate: payout.exDate,
        amount: Number(payout.rightPrice),
        ratio: Number(payout.rightIssue) / 100,
        providerId: String(payout.id),
      });
    }
  }
  return cleanPayoutData;
};

// Saves the actions of one stock. Takes the stock's id and the list, returns
// how many it saved. One upsert each: a re-sync updates, never duplicates.
const savePayoutInDB = async (securityId, cleanPayoutData) => {
  for (const payout of cleanPayoutData) {
    const exDate = new Date(`${payout.exDate}T00:00:00Z`); // "2026-08-12" -> a date

    await prisma.corporateAction.upsert({
      where: {
        securityId_type_exDate: { securityId, type: payout.type, exDate },
      },
      create: {
        securityId,
        ...payout,
        exDate,
        source: "payouts",
      },
      update: {
        amount: payout.amount,
        ratio: payout.ratio,
        providerId: payout.providerId,
      },
    });
  }
  return cleanPayoutData.length;
};

const getAllSecuritiesPayoutPerAccount = async (account) => {
  const securitiesInPortfolioOrWatchlist = await prisma.security.findMany({
    where: {
      OR: [
        {
          positions: { some: { quantity: { gt: 0 } } },
        },
        {
          watchlistItems: { some: {} },
        },
      ],
      NOT: {
        symbol: "KSE100",
      },
    },
    select: {
      id: true,
      symbol: true,
    },
    orderBy: { symbol: "asc" },
  });
  const allSecurityPayout = [];
  for (const security of securitiesInPortfolioOrWatchlist) {
    try {
      const payoutResponse = await payoutDashboardApi(
        security?.symbol,
        account,
      );
      const cleanPayoutData = payoutFilterData(payoutResponse);
      const saved = await savePayoutInDB(security.id, cleanPayoutData);
      allSecurityPayout.push({
        symbol: security.symbol,
        saved,
      });
    } catch (error) {
      allSecurityPayout.push({ symbol: security.symbol, error: error.message });
      if (providerSaysStop(error)) break; // rate limited or provider down: stop knocking
    }
    await pauseBetweenCalls();
  }
  let totalSaved = 0;
  for (const result of allSecurityPayout) {
    totalSaved +=  result.saved ?? 0;
  }
  return {
    securities: allSecurityPayout.length,
    saved: totalSaved,
    results: allSecurityPayout,
  };
};

const getSingleSecuritiesPayout = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const security = await prisma.security.findUnique({ where: { symbol } });
  if (!security)
    return res.status(404).json({ error: "security does not exist" });

  const account = await prisma.brokerAccount.findFirst({
    where: { userId: req.user.id },
    select: { id: true, clientCode: true },
  });
  if (!account)
    return res.status(404).json({ error: "No broker account linked." });

  let securityPayout;
  try {
    securityPayout = await payoutDashboardApi(symbol, account);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  const cleanPayoutData = payoutFilterData(securityPayout);
  const saved = await savePayoutInDB(security.id, cleanPayoutData);

  res.status(200).json({
    message: "success",
    data: {
      symbol,
      count: securityPayout.length,
      saved,
      extractdata: cleanPayoutData,
    },
  });
};

const getBulkSecuritiesPayout = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: {
      id: true,
      clientCode: true,
    },
  });
  if (!account) {
    return res.status(404).json({ error: "account does not exists" });
  }
  let data;
  try {
    data = await getAllSecuritiesPayoutPerAccount(account);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  res.status(200).json({ message: "success", data });
};

export {
  getSingleSecuritiesPayout,
  getBulkSecuritiesPayout,
  getAllSecuritiesPayoutPerAccount,
};

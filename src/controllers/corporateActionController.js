import { prisma } from "../config/db.js";
import { fetchDashboardApi } from "../services/dashboardApi.js";
import { pauseBetweenCalls, providerSaysStop } from "../utils/pace.js";
import { formatDate } from "../utils/dateRange.js";
import { BROKER_PROBLEM_STATUS } from "../config/constants.js";

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

  //the provider publishes a dividend a second time when its ex-date is corrected. of two rows with
  //the same amount and ex-dates within two weeks, only the newer one (the larger provider id) is kept
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
  const withoutRepeats = [];
  for (const payout of cleanPayoutData) {
    let newerCopyExists = false;
    for (const other of cleanPayoutData) {
      if (payout.type !== "DIVIDEND" || other.type !== "DIVIDEND" || other === payout) {
        continue;
      }
      const timeApart = Math.abs(new Date(other.exDate) - new Date(payout.exDate));
      if (
        other.amount === payout.amount &&
        timeApart <= TWO_WEEKS_MS &&
        Number(other.providerId) > Number(payout.providerId)
      ) {
        newerCopyExists = true;
      }
    }
    if (!newerCopyExists) {
      withoutRepeats.push(payout);
    }
  }
  return withoutRepeats;
};

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

const saveAllSecuritiesPayoutPerAccount = async (account) => {
  const securitiesInPortfolioOrWatchlist = await prisma.security.findMany({
    where: {
      OR: [
        {
          positions: { some: { quantity: { gt: 0 } } },
        },
        {
          watchlistItems: { some: {} },
        },
        //a stock that was sold still paid dividends while it was held
        {
          trades: { some: {} },
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

const saveSingleSecuritiesPayout = async (req, res) => {
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
    return res.status(BROKER_PROBLEM_STATUS).json({ error: error.message });
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

const saveBulkSecuritiesPayout = async (req, res) => {
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
    data = await saveAllSecuritiesPayoutPerAccount(account);
  } catch (error) {
    return res.status(BROKER_PROBLEM_STATUS).json({ error: error.message });
  }
  res.status(200).json({ message: "success", data });
};

const getSecurityPayoutOfCompany = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const security = await prisma.security.findUnique({ where: { symbol } });
  if (!security) {
    return res.status(404).json({ error: "security does not exist" });
  }
  const rows = await prisma.corporateAction.findMany({
    where: { securityId: security.id },
    orderBy: { exDate: "desc" },
    include: { toSecurity: { select: { symbol: true } } },
  });
  const actions = [];
  for (const row of rows) {
    actions.push({
      type: row.type,
      exDate: formatDate(row.exDate),
      ratio: row.ratio === null ? null : Number(row.ratio),
      amount: row.amount === null ? null : Number(row.amount),
      toSymbol: row.toSecurity ? row.toSecurity.symbol : null,
      source: row.source,
    });
  }
  res.status(200).json({ message: "success", data: { actions } });
};

//fetch and save one stock's payouts. takes the security and the account, returns how many rows
const savePayoutsForSecurity = async (security, account) => {
  const payoutResponse = await payoutDashboardApi(security.symbol, account);
  const cleanPayoutData = payoutFilterData(payoutResponse);
  return savePayoutInDB(security.id, cleanPayoutData);
};

export {
  saveSingleSecuritiesPayout,
  saveBulkSecuritiesPayout,
  saveAllSecuritiesPayoutPerAccount,
  getSecurityPayoutOfCompany,
  savePayoutsForSecurity,
};

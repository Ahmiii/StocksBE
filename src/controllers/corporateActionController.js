import { prisma } from "../config/db.js";
import { formatDate } from "../utils/dateRange.js";
import { pauseBetweenCalls, providerSaysStop } from "../utils/pace.js";
import {
  BENCHMARK_SYMBOL,
  fetchDashboardApi,
  fetchUnadjustedBars,
  heldOrWatchedSecurities,
} from "./marketDataController.js";

const ACTION = {
  DIVIDEND: "DIVIDEND",
  BONUS: "BONUS",
  RIGHTS: "RIGHTS",
  SPLIT: "SPLIT",
  MERGER: "MERGER",
};
const SOURCE = { PAYOUTS: "payouts", PRICES: "prices", MANUAL: "manual" };

// A raw ÷ adjusted price step this big on one day is a split, not a move.
const SPLIT_STEP = 1.3;

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);

const upsertAction = (action) =>
  prisma.corporateAction.upsert({
    where: {
      securityId_type_exDate: {
        securityId: action.securityId,
        type: action.type,
        exDate: action.exDate,
      },
    },
    create: action,
    update: { ratio: action.ratio, amount: action.amount, providerId: action.providerId },
  });

// Dividends, bonus shares and rights from the provider's announcement list.
// One row per announcement; a results announcement can carry both a dividend
// and a bonus, so it can produce two actions.
const syncPayouts = async (security, account) => {
  const rows = await fetchDashboardApi(
    `/payouts/announcement-break-down/${security.symbol}`,
    {},
    account,
  );

  const actions = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.announcementAction !== "PUBLISH" || !row.exDate) continue;

    const base = {
      securityId: security.id,
      exDate: toDate(row.exDate),
      source: SOURCE.PAYOUTS,
      providerId: String(row.id),
    };
    if (Number(row.dividend) > 0) {
      actions.push({ ...base, type: ACTION.DIVIDEND, amount: Number(row.dividend) });
    }
    if (Number(row.bonus) > 0) {
      actions.push({ ...base, type: ACTION.BONUS, ratio: 1 + Number(row.bonus) / 100 });
    }
    if (Number(row.rightIssue) > 0) {
      actions.push({
        ...base,
        type: ACTION.RIGHTS,
        ratio: Number(row.rightIssue) / 100,
        amount: Number(row.rightPrice) || null,
      });
    }
  }

  for (const action of actions) await upsertAction(action);
  return actions.length;
};

// Splits from the two price feeds. Our stored closes are split-adjusted and
// the provider's raw feed is not, so raw ÷ adjusted is flat between events
// and steps on an ex-date. A step with no bonus that week is a split.
const detectSplits = async (security, account) => {
  const stored = await prisma.dailyPrice.findMany({
    where: { securityId: security.id },
    orderBy: { tradeDate: "asc" },
    select: { tradeDate: true, close: true },
  });
  if (stored.length < 2) return 0;

  const adjusted = new Map(stored.map((bar) => [formatDate(bar.tradeDate), Number(bar.close)]));
  const raw = await fetchUnadjustedBars(security.symbol, stored[0].tradeDate, account);

  const factors = raw
    .map((bar) => ({ day: new Date(bar.time * 1000).toISOString().slice(0, 10), close: bar.close }))
    .filter((bar) => adjusted.has(bar.day))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((bar) => ({ day: bar.day, factor: bar.close / adjusted.get(bar.day) }));

  const bonuses = await prisma.corporateAction.findMany({
    where: { securityId: security.id, type: ACTION.BONUS },
    select: { exDate: true },
  });
  const bonusThatWeek = (day) =>
    bonuses.some((bonus) => Math.abs(toDate(day) - bonus.exDate) <= 5 * 86400000);

  let found = 0;
  for (let i = 1; i < factors.length; i++) {
    const step = factors[i - 1].factor / factors[i].factor;
    if (step < SPLIT_STEP || bonusThatWeek(factors[i].day)) continue;

    await upsertAction({
      securityId: security.id,
      type: ACTION.SPLIT,
      exDate: toDate(factors[i].day),
      ratio: Math.round(step * 2) / 2, // splits come in halves: 1.5, 2, 5, 10
      source: SOURCE.PRICES,
    });
    found++;
  }
  return found;
};

// Both syncs for everything held or watched. Two provider calls per symbol,
// with a person-like pause between symbols.
const syncCorporateActionsForAccount = async (account) => {
  const securities = (await heldOrWatchedSecurities()).filter(
    (security) => security.symbol !== BENCHMARK_SYMBOL,
  );

  const results = [];
  for (const security of securities) {
    try {
      const payouts = await syncPayouts(security, account);
      await pauseBetweenCalls();
      const splits = await detectSplits(security, account);
      results.push({ symbol: security.symbol, payouts, splits });
    } catch (error) {
      results.push({ symbol: security.symbol, error: error.response?.status ?? error.message });
      // Rate limited or the provider is down: do not keep knocking.
      if (providerSaysStop(error)) break;
    }
    await pauseBetweenCalls();
  }

  return {
    securities: results.length,
    actions: results.reduce((sum, r) => sum + (r.payouts ?? 0) + (r.splits ?? 0), 0),
    results,
  };
};

// POST /market/corporate-actions/sync/:id — id is the broker account.
const syncCorporateActions = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true },
  });
  if (!account) return res.status(404).json({ error: "account does not exist" });

  let data;
  try {
    data = await syncCorporateActionsForAccount({
      brokerAccountId: account.id,
      clientCode: account.clientCode,
    });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  res.status(200).json({ message: "success", data });
};

// GET /market/corporate-actions/:symbol
const listCorporateActions = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const rows = await prisma.corporateAction.findMany({
    where: { security: { symbol } },
    orderBy: { exDate: "desc" },
    select: {
      type: true,
      exDate: true,
      ratio: true,
      amount: true,
      source: true,
      toSecurity: { select: { symbol: true } },
    },
  });

  res.status(200).json({
    message: "success",
    data: {
      symbol,
      actions: rows.map((row) => ({
        type: row.type,
        exDate: formatDate(row.exDate),
        ratio: row.ratio === null ? null : Number(row.ratio),
        amount: row.amount === null ? null : Number(row.amount),
        toSymbol: row.toSecurity?.symbol ?? null,
        source: row.source,
      })),
    },
  });
};

export {
  ACTION,
  SOURCE,
  syncPayouts,
  detectSplits,
  syncCorporateActionsForAccount,
  syncCorporateActions,
  listCorporateActions,
};

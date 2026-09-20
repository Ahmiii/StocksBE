import { prisma } from "../config/db.js";
import { getSession, saveSession } from "../services/brokderSessionStore.js";
import { fetchMarket, getMarketCookie } from "../services/dashboardApi.js";
import { decrypt } from "../utils/secrets.js";
import { pauseBetweenCalls } from "../utils/pace.js";
import { brokerLogin } from "./brokerAccountController.js";
import { savePrices } from "./marketDataController.js";
import { savePayoutsForSecurity } from "./corporateActionController.js";

const BENCHMARK_SYMBOL = "KSE100";

// Latest two closes, so we can show the price and the day's move.
const latestBars = {
  orderBy: { tradeDate: "desc" },
  take: 2,
  select: { close: true, tradeDate: true },
};

// Turns a security (with its last two bars) into one list row.
const toRow = (security) => {
  const [last, prev] = security.dailyPrices;
  const lastPrice = last ? Number(last.close) : null;
  const prevPrice = prev ? Number(prev.close) : null;
  const change = lastPrice !== null && prevPrice !== null ? lastPrice - prevPrice : null;

  return {
    securityId: security.id,
    symbol: security.symbol,
    companyName: security.companyName,
    sector: security.sector,
    lastPrice,
    change,
    changePct: change === null ? null : (change / prevPrice) * 100,
    asOf: last ? last.tradeDate.toISOString().slice(0, 10) : null,
  };
};

const getWatchlist = async (req, res) => {
  const [items, benchmark] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "asc" },
      select: {
        security: {
          select: { id: true, symbol: true, companyName: true, sector: true, dailyPrices: latestBars },
        },
      },
    }),
    prisma.security.findUnique({
      where: { symbol: BENCHMARK_SYMBOL },
      select: { id: true, symbol: true, companyName: true, sector: true, dailyPrices: latestBars },
    }),
  ]);

  res.status(200).json({
    message: "success",
    data: {
      benchmark: benchmark ? toRow(benchmark) : null,
      items: items.map((item) => toRow(item.security)),
    },
  });
};

const addToWatchlist = async (req, res) => {
  const security = await prisma.security.findUnique({
    where: { id: req.params.securityId },
    select: { id: true, symbol: true },
  });
  if (!security) return res.status(404).json({ error: "security does not exist" });

  // The unique index on (userId, securityId) makes a second add a no-op.
  await prisma.watchlistItem.upsert({
    where: { userId_securityId: { userId: req.user.id, securityId: security.id } },
    create: { userId: req.user.id, securityId: security.id },
    update: {},
  });

  //pull everything the stock's screen needs right now, so it does not sit empty until the
  //nightly job: prices and payouts. logs in with the stored password when no session is
  //alive. a provider failure is reported, never fails the add
  const loaded = { prices: 0, payouts: 0, note: null };
  try {
    const account = await readyAccount(req.user.id);
    if (!account) {
      loaded.note = "no broker account with a stored password, the nightly sync will fill this stock";
    } else {
      //always fetched: a stock that was held before can have old prices, and saving prices again is safe
      const cookie = await getMarketCookie({ brokerAccountId: account.id, clientCode: account.clientCode });
      const bars = await fetchMarket(`/daily/${security.symbol}`, cookie);
      loaded.prices = await savePrices(security.id, bars);
      await pauseBetweenCalls();
      const havePayouts = await prisma.corporateAction.count({ where: { securityId: security.id } });
      if (havePayouts === 0) {
        loaded.payouts = await savePayoutsForSecurity(security, account);
      }
    }
  } catch (error) {
    loaded.note = `could not load history now: ${error.message}. The nightly sync will fill it.`;
  }

  res.status(200).json({
    message: "success",
    data: {
      symbol: security.symbol,
      pricesLoaded: (await prisma.dailyPrice.count({ where: { securityId: security.id } })) > 0,
      ...loaded,
    },
  });
};

//the user's broker account with a live session, logging in with the stored password when the
//session has expired. null when there is no account or no stored password
const readyAccount = async (userId) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { userId, credentialsEnc: { not: null } },
    select: { id: true, clientCode: true, credentialsEnc: true },
  });
  if (!account) {
    return null;
  }
  if (!getSession(account.id)) {
    const login = await brokerLogin({ accountNumber: account.clientCode, password: decrypt(account.credentialsEnc) });
    if (!login.ok) {
      throw new Error(login.error);
    }
    saveSession(account.id, { sessionCookie: login.sessionCookie, cookieJar: login.cookieJar });
  }
  return { id: account.id, clientCode: account.clientCode };
};

const removeFromWatchlist = async (req, res) => {
  const result = await prisma.watchlistItem.deleteMany({
    where: { userId: req.user.id, securityId: req.params.securityId },
  });
  if (result.count === 0) return res.status(404).json({ error: "not in watchlist" });

  res.status(200).json({ message: "success" });
};

export { getWatchlist, addToWatchlist, removeFromWatchlist };

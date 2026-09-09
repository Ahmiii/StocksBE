import axios from "axios";
import { prisma } from "../config/db.js";
import {
  BROWSER_HEADERS,
  AJAX_HEADERS,
  BROKER_URL,
  BROKER_SYMBOLS_PATH,
  BROKER_HOUSE_NAME,
} from "../config/constants.js";
import { buildCookieHeader } from "../utils/extractAHLInfor.js";
import { parseDateRange, formatDate } from "../utils/dateRange.js";
import { pauseBetweenCalls, providerSaysStop } from "../utils/pace.js";
import { getSession, clearMarketSession } from "../services/brokderSessionStore.js";
import { getMarketCookie, fetchMarket } from "../services/dashboardApi.js";

// The benchmark is stored like any other security, so its levels land in
// daily_prices next to the stocks and can be queried the same way.
const BENCHMARK_SYMBOL = "KSE100";

/* -------------------------------------------------------------------------- */
/* Prices                                                                     */
/* -------------------------------------------------------------------------- */

// Bars arrive as "2026-08-28 16:00:00" with no timezone. Take the date part as
// written — parsing the whole string would shift the day in PKT.
const toTradeDate = (value) =>
  new Date(`${String(value).slice(0, 10)}T00:00:00Z`);

const savePrices = async (securityId, bars) => {
  const rows = bars.map((bar) => ({
    securityId,
    tradeDate: toTradeDate(bar.date),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: BigInt(Math.round(bar.volume ?? 0)),
  }));

  const result = await prisma.dailyPrice.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return result.count;
};

// Fetches the missing daily bars for everything held or watched, plus the
// benchmark. Safe to run repeatedly: the first run backfills, later runs only
// add the days that have appeared since. Shared by the sync endpoint and the
// nightly job. Throws when no market session can be issued.
const syncPricesForAccount = async (account) => {
  const cookieHeader = await getMarketCookie({
    brokerAccountId: account.id,
    clientCode: account.clientCode,
  });

  await prisma.security.upsert({
    where: { symbol: BENCHMARK_SYMBOL },
    create: { symbol: BENCHMARK_SYMBOL, companyName: "KSE-100 Index" },
    update: {},
  });

  // Only what is held, plus the benchmark. The securities table carries the
  // whole exchange (~557 rows) for the watchlist; fetching five years for each
  // would be hundreds of calls for data nobody looks at.
  const securities = await prisma.security.findMany({
    where: {
      OR: [
        { positions: { some: { quantity: { gt: 0 } } } },
        { watchlistItems: { some: {} } },
        { symbol: BENCHMARK_SYMBOL },
      ],
    },
    select: {
      id: true,
      symbol: true,
      dailyPrices: {
        where: { volume: { not: null } },
        orderBy: { tradeDate: "desc" },
        take: 1,
        select: { tradeDate: true },
      },
    },
    orderBy: { symbol: "asc" },
  });

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Karachi",
  });

  const results = [];

  for (const security of securities) {
    const lastFullPrice = security.dailyPrices[0]; // newest row with open/high/low/volume
    if (lastFullPrice && lastFullPrice.tradeDate.toISOString().slice(0, 10) >= today) {
      results.push({ symbol: security.symbol, skipped: "already current" });
      continue;
    }

    try {
      const bars = await fetchMarket(`/daily/${security.symbol}`, cookieHeader);
      const saved = await savePrices(security.id, bars);
      results.push({ symbol: security.symbol, fetched: bars.length, saved });
    } catch (error) {
      if (error.response?.status === 401) clearMarketSession(account.id);
      results.push({
        symbol: security.symbol,
        error: error.response?.status ?? error.message,
      });
      // Rate limited or the provider is down: do not keep knocking.
      if (providerSaysStop(error)) break;
    }

    await pauseBetweenCalls();
  }

  return {
    securities: results.length,
    fetched: results.filter((r) => r.fetched != null).length,
    skipped: results.filter((r) => r.skipped).length,
    newRows: results.reduce((sum, r) => sum + (r.saved ?? 0), 0),
    results,
  };
};

const syncPrices = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true },
  });

  if (!account) {
    return res.status(404).json({ error: "account does not exist" });
  }

  let data;
  try {
    data = await syncPricesForAccount(account);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }

  res.status(200).json({ message: "success", data });
};

const getPrices = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const { from, to, error } = parseDateRange(req.query);
  if (error) return res.status(400).json({ error });

  const security = await prisma.security.findUnique({ where: { symbol } });
  if (!security) {
    return res.status(404).json({ error: "security does not exist" });
  }

  const rows = await prisma.dailyPrice.findMany({
    where: { securityId: security.id, tradeDate: { gte: from, lte: to } },
    orderBy: { tradeDate: "asc" },
  });

  const num = (value) => (value == null ? null : Number(value));
  const bars = rows.map((bar) => ({
    date: bar.tradeDate.toISOString().slice(0, 10),
    open: num(bar.open),
    high: num(bar.high),
    low: num(bar.low),
    close: num(bar.close),
    volume: num(bar.volume),
  }));

  res.status(200).json({
    message: "success",
    data: {
      symbol,
      range: { from: formatDate(from), to: formatDate(to) },
      asOf: bars.at(-1)?.date ?? null,
      bars,
    },
  });
};

// One-time import of every tradable symbol, for the watchlist.
const syncSecurities = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true },
  });
  if (!account) return res.status(404).json({ error: "account does not exist" });

  const session = getSession(account.id);
  if (!session) {
    return res.status(401).json({ error: "Broker session expired. Reconnect the account." });
  }

  const jar = {
    trader: account.clientCode,
    HouseName: BROKER_HOUSE_NAME,
    ...session.cookieJar,
  };
  const response = await axios.get(`${BROKER_URL}${BROKER_SYMBOLS_PATH}`, {
    headers: {
      ...BROWSER_HEADERS,
      ...AJAX_HEADERS,
      Referer: `${BROKER_URL}/Home/Index`,
      cookie: buildCookieHeader(jar),
    },
  });

  // Each symbol is listed once per market (REG/ODL/FUT) but Security.symbol is
  // unique. Skip futures contracts and keep one row per symbol.
  const bySymbol = new Map();
  for (const row of response.data ?? []) {
    if (row.approved !== "Approved" || row.market === "FUT") continue;
    bySymbol.set(row.symbol, row);
  }

  for (const row of bySymbol.values()) {
    const data = {
      companyName: row.symbolName,
      sector: row.sectorName || null,
    };
    await prisma.security.upsert({
      where: { symbol: row.symbol },
      create: { symbol: row.symbol, ...data },
      update: data,
    });
  }

  res.status(200).json({
    message: "success",
    data: { received: response.data?.length ?? 0, saved: bySymbol.size },
  });
};

// Search by symbol or company name, for adding to the watchlist.
const searchSecurities = async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.status(400).json({ error: "q must be at least 2 characters" });

  const securities = await prisma.security.findMany({
    where: {
      OR: [
        { symbol: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
      ],

      positions: {
        none: { quantity: { gt: 0 }, portfolio: { userId: req.user.id } },
      },
      watchlistItems: { none: { userId: req.user.id } },
    },
    select: { id: true, symbol: true, companyName: true, sector: true },
    orderBy: { symbol: "asc" },
    take: 20,
  });

  res.status(200).json({ message: "success", data: { securities } });
};

// How far back each chart period reaches.
const PERIOD_MONTHS = { "1W": 0.25, "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60 };

const closesSince = async (symbol, from) => {
  const security = await prisma.security.findUnique({ where: { symbol }, select: { id: true } });
  if (!security) return null;
  return prisma.dailyPrice.findMany({
    where: { securityId: security.id, tradeDate: { gte: from } },
    orderBy: { tradeDate: "asc" },
    select: { tradeDate: true, close: true },
  });
};

// A stock against the benchmark over a period, both rebased to 100 on the
// first day so a 500-rupee stock and a 176,000-point index share one axis.
const getTrend = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const period = String(req.query.period ?? "6M").toUpperCase();
  const months = PERIOD_MONTHS[period];
  if (!months) {
    return res.status(400).json({ error: `period must be one of ${Object.keys(PERIOD_MONTHS).join(", ")}` });
  }

  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - Math.round(months * 30.4));

  const [stock, bench] = await Promise.all([
    closesSince(symbol, from),
    closesSince(BENCHMARK_SYMBOL, from),
  ]);
  if (!stock) return res.status(404).json({ error: "security does not exist" });

  const day = (bar) => bar.tradeDate.toISOString().slice(0, 10);
  const benchByDay = new Map(bench.map((bar) => [day(bar), Number(bar.close)]));

  // Only days both have a close, so the two lines always line up.
  const shared = stock.filter((bar) => benchByDay.has(day(bar)));
  if (shared.length < 2) {
    return res.status(404).json({ error: "not enough price history for this period" });
  }

  const stockBase = Number(shared[0].close);
  const benchBase = benchByDay.get(day(shared[0]));

  const series = shared.map((bar) => ({
    date: day(bar),
    close: Number(bar.close),
    stock: (Number(bar.close) / stockBase) * 100,
    benchmark: (benchByDay.get(day(bar)) / benchBase) * 100,
  }));

  const last = series.at(-1);
  res.status(200).json({
    message: "success",
    data: {
      symbol,
      period,
      range: { from: series[0].date, to: last.date },
      series,
      summary: {
        stockReturn: last.stock - 100,
        benchmarkReturn: last.benchmark - 100,
        outperformance: last.stock - last.benchmark,
      },
    },
  });
};

export {
  syncPrices,
  syncPricesForAccount,
  getPrices,
  syncSecurities,
  searchSecurities,
  getTrend,
  savePrices,
};

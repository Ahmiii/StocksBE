import axios from "axios";
import { prisma } from "../config/db.js";
import {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  AJAX_HEADERS,
  BROKER_URL,
  BROKER_ANALYTICS_PATH,
  BROKER_SYMBOLS_PATH,
  BROKER_HOUSE_NAME,
} from "../config/constants.js";
import { buildCookieHeader, parseSetCookies } from "../utils/extractAHLInfor.js";
import { parseDateRange, formatDate } from "../utils/dateRange.js";
import {
  getSession,
  saveMarketSession,
  getMarketSession,
  clearMarketSession,
} from "../services/brokderSessionStore.js";

const DASHBOARD_URL = process.env.DASHBOARD_URL;

// Manual fallback: a laravel_session copied out of the browser. Only used when
// there is no live broker session to run the handoff with.
const DASHBOARD_COOKIE = process.env.DASHBOARD_COOKIE;

// The benchmark is stored like any other security, so its levels land in
// daily_prices next to the stocks and can be queried the same way.
const BENCHMARK_SYMBOL = "KSE100";

/* -------------------------------------------------------------------------- */
/* Getting a market-data session                                              */
/*                                                                            */
/* The market API is authenticated by arifhabib's own laravel_session cookie,  */
/* not by the Bearer token the dashboard also sends. To obtain one we ask the  */
/* broker for a handoff URL and follow it — arifhabib validates the encrypted  */
/* token in that URL and answers with Set-Cookie.                             */
/* -------------------------------------------------------------------------- */

// Step 1 — ask the broker where the analytics dashboard lives for this session.
// The reply is a URL carrying a one-time token; it may arrive as a bare string
// or wrapped in JSON.
const fetchAnalyticsUrl = async ({ clientCode, session }) => {
  const jar = {
    trader: clientCode,
    HouseName: BROKER_HOUSE_NAME,
    ...session.cookieJar,
  };

  const response = await axios.get(`${BROKER_URL}${BROKER_ANALYTICS_PATH}`, {
    headers: {
      ...BROWSER_HEADERS,
      ...AJAX_HEADERS,
      Referer: `${BROKER_URL}/Home/Index`,
      cookie: buildCookieHeader(jar),
    },
    responseType: "text",
    transformResponse: [(data) => data],
  });

  const body = String(response.data ?? "").trim();
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "string" ? parsed : (parsed?.url ?? "");
  } catch {
    return body;
  }
};

// Step 2 — follow the handoff. Redirects are followed by hand because the
// cookie we want is set part-way through the chain, and axios discards
// Set-Cookie from hops it follows itself.
const openDashboard = async (analyticsUrl) => {
  let url = analyticsUrl.replace(/^http:/, "https:"); // it comes back as http
  const jar = {};

  for (let hop = 0; hop < 5; hop++) {
    const response = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      responseType: "text",
      transformResponse: [(data) => data],
      headers: {
        ...BROWSER_HEADERS,
        ...NAVIGATION_HEADERS,
        "sec-fetch-site": "cross-site", // arriving from ahletrade
        ...(Object.keys(jar).length ? { cookie: buildCookieHeader(jar) } : {}),
      },
    });

    Object.assign(jar, parseSetCookies(response));

    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    break;
  }

  return jar;
};

// Returns a Cookie header for the market API, running the handoff only when the
// cached one has lapsed. Falls back to DASHBOARD_COOKIE when there is no live
// broker session — useful for a backfill outside broker hours.
const getMarketCookie = async ({ brokerAccountId, clientCode }) => {
  const cached = getMarketSession(brokerAccountId);
  if (cached) return cached.cookieHeader;

  const brokerSession = getSession(brokerAccountId);
  if (!brokerSession) {
    if (DASHBOARD_COOKIE) return DASHBOARD_COOKIE;
    throw new Error(
      "Broker session expired. Reconnect the account so a market session can be issued.",
    );
  }

  const analyticsUrl = await fetchAnalyticsUrl({
    clientCode,
    session: brokerSession,
  });
  if (!analyticsUrl.startsWith("http")) {
    throw new Error("The broker did not return an analytics URL.");
  }

  const jar = await openDashboard(analyticsUrl);
  if (!jar.laravel_session) {
    throw new Error("The dashboard handoff did not return a session cookie.");
  }

  const cookieHeader = buildCookieHeader(jar);
  saveMarketSession(brokerAccountId, { cookieHeader });
  return cookieHeader;
};

/* -------------------------------------------------------------------------- */
/* Prices                                                                     */
/* -------------------------------------------------------------------------- */

// One call to the market API. `path` is what the dashboard passes through,
// e.g. "/daily/FFC".
const fetchMarket = async (path, cookieHeader) => {
  const response = await axios.get(`${DASHBOARD_URL}/market`, {
    params: { path },
    headers: {
      accept: "*/*",
      "x-requested-with": "XMLHttpRequest",
      cookie: cookieHeader,
    },
  });

  // The API also returns a "count" field, but it is unreliable (0 even when
  // rows are present), so we always go by the array itself.
  return response.data?.data ?? [];
};

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

// Pulls ~5 years of daily bars for every security we know about, plus the
// benchmark. Safe to run repeatedly: the first run backfills, later runs only
// add the days that have appeared since.
const syncPrices = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true },
  });

  if (!account) {
    return res.status(404).json({ error: "account does not exist" });
  }

  let cookieHeader;
  try {
    cookieHeader = await getMarketCookie({
      brokerAccountId: account.id,
      clientCode: account.clientCode,
    });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }

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
        { symbol: BENCHMARK_SYMBOL },
      ],
    },
    select: {
      id: true,
      symbol: true,
      dailyPrices: {
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
    const latest = security.dailyPrices[0];
    if (latest && latest.tradeDate.toISOString().slice(0, 10) >= today) {
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
    }

    // Space the calls out so a sync reads as a person browsing, not a scraper.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  res.status(200).json({
    message: "success",
    data: {
      securities: results.length,
      fetched: results.filter((r) => r.fetched != null).length,
      skipped: results.filter((r) => r.skipped).length,
      newRows: results.reduce((sum, r) => sum + (r.saved ?? 0), 0),
      results,
    },
  });
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

export { syncPrices, getPrices, syncSecurities };

// How we talk to the Arif Habib analytics dashboard: getting a session through
// the broker's handoff, the bearer token some endpoints also want, and the two
// kinds of call. Controllers ask this file for data; nothing here touches our
// database.
import axios from "axios";
import {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  AJAX_HEADERS,
  BROKER_URL,
  BROKER_ANALYTICS_PATH,
  BROKER_HOUSE_NAME,
} from "../config/constants.js";
import { buildCookieHeader, parseSetCookies } from "../utils/extractAHLInfor.js";
import {
  getSession,
  saveMarketSession,
  getMarketSession,
} from "./brokderSessionStore.js";

const DASHBOARD_URL = process.env.DASHBOARD_URL;
const DASHBOARD_HOME = DASHBOARD_URL ? new URL(DASHBOARD_URL).origin : "";

// Manual fallback: a laravel_session copied out of the browser. Only used when
// there is no live broker session to run the handoff with.
const DASHBOARD_COOKIE = process.env.DASHBOARD_COOKIE;

// The page a browser would be on when it makes a given API call. Sent as the
// Referer so our calls look like the dashboard's own.
const pageFor = (symbol) =>
  symbol ? `${DASHBOARD_HOME}/research/company/${symbol}` : `${DASHBOARD_HOME}/`;

// Every API call carries the same headers Chrome sends from the dashboard.
const apiHeaders = (symbol, extra) => ({
  ...BROWSER_HEADERS,
  ...AJAX_HEADERS,
  Referer: pageFor(symbol),
  ...extra,
});

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
/* Cookie-only endpoint: the price feed                                       */
/* -------------------------------------------------------------------------- */

// One call to the market API. `path` is what the dashboard passes through,
// e.g. "/daily/FFC".
const fetchMarket = async (path, cookieHeader) => {
  const symbol = path.split("/")[2]; // "/daily/FFC" -> "FFC"
  const response = await axios.get(`${DASHBOARD_URL}/market`, {
    params: { path },
    headers: apiHeaders(symbol, { cookie: cookieHeader }),
  });

  // The API also returns a "count" field, but it is unreliable (0 even when
  // rows are present), so we always go by the array itself.
  return response.data?.data ?? [];
};

/* -------------------------------------------------------------------------- */
/* Token endpoints                                                            */
/*                                                                            */
/* Some dashboard endpoints (fundamentals, payouts, news) want a bearer token  */
/* as well as the cookie. Every dashboard page embeds a fresh one in           */
/* <meta name="access-token">, and the previous token stops working — so it is */
/* fetched once per market session and refreshed once on a 401.               */
/* -------------------------------------------------------------------------- */

const fetchAccessToken = async (cookieHeader) => {
  const response = await axios.get(`${DASHBOARD_HOME}/`, {
    headers: { ...BROWSER_HEADERS, ...NAVIGATION_HEADERS, cookie: cookieHeader },
    responseType: "text",
    transformResponse: [(data) => data],
  });
  const match = String(response.data).match(/name="access-token" content="([^"]+)"/);
  return match ? match[1] : null;
};

const getMarketAuth = async ({ brokerAccountId, clientCode }) => {
  const cookieHeader = await getMarketCookie({ brokerAccountId, clientCode });

  const cached = getMarketSession(brokerAccountId);
  if (cached?.accessToken) {
    return { cookieHeader, accessToken: cached.accessToken };
  }

  const accessToken = await fetchAccessToken(cookieHeader);
  if (!accessToken) {
    throw new Error("The dashboard page did not carry an access token.");
  }
  saveMarketSession(brokerAccountId, { cookieHeader, accessToken });
  return { cookieHeader, accessToken };
};

// GET on a token endpoint, e.g.
//   fetchDashboardApi("/company-statement",
//     { symbol: "LCI", interval: "annual", type: "fundamentals" }, account)
// where account is { brokerAccountId, clientCode }. The Referer is the
// company page the browser would be on: the symbol from the params, or the
// end of the path (…/LCI).
const fetchDashboardApi = async (path, params, account, retry = true) => {
  const { cookieHeader, accessToken } = await getMarketAuth(account);
  const last = path.split("/").pop();
  const symbol = params?.symbol ?? (/^[A-Z0-9]+$/.test(last) ? last : null);

  try {
    const response = await axios.get(`${DASHBOARD_URL}${path}`, {
      params,
      headers: apiHeaders(symbol, {
        cookie: cookieHeader,
        authorization: `Bearer ${accessToken}`,
      }),
    });
    return response.data?.data ?? response.data;
  } catch (error) {
    // A dashboard page was opened elsewhere (a browser tab), which rotated
    // the token. Forget ours and try once more with a fresh one.
    if (error.response?.status === 401 && retry) {
      saveMarketSession(account.brokerAccountId, { cookieHeader, accessToken: null });
      return fetchDashboardApi(path, params, account, false);
    }
    throw error;
  }
};

export { getMarketCookie, fetchMarket, fetchDashboardApi };

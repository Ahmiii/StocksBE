import { prisma } from "../config/db.js";
import axios from "axios";
import {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  AJAX_HEADERS,
  BROKER_URL,
  BROKER_CODE,
  SYNC_STATUS,
  BROKER_LOGIN_PATH,
  BROKER_HISTORY_PATH,
  BROKER_COLLATERALS_PATH,
  BROKER_HOUSE_NAME,
  HISTORY_DEFAULT_FROM,
} from "../config/constants.js";
import {
  extractSessionCookie,
  parseSetCookies,
  parseEnabledDigits,
  isInvalidLogin,
  buildLoginBody,
  buildCookieHeader,
} from "../utils/extractAHLInfor.js";
import {
  saveSession,
  getSession,
  clearSession,
} from "../services/brokderSessionStore.js";
import {
  calculatePositions,
  mergePositions,
  reconcilePositions,
  normalizeTradeRows,
} from "../utils/tradeData.js";
import { canStoreSecrets, encrypt } from "../utils/secrets.js";
// Never follow redirects: a 302 would drop the Set-Cookie headers we need off
// the hop that issued them, and the login POST answers with one on success.
const NO_REDIRECT = {
  maxRedirects: 0,
  validateStatus: (status) => status >= 200 && status < 400,
  responseType: "text",
};

// Step 1 — load the login page to learn the session cookie and which password
// positions this attempt is asking for.
const fetchLoginPage = async () => {
  const response = await axios.get(BROKER_URL, {
    headers: {
      ...BROWSER_HEADERS,
      ...NAVIGATION_HEADERS,
      Referer: `${BROKER_URL}/`,
    },
    ...NO_REDIRECT,
  });

  return {
    html: response.data,
    sessionCookie: extractSessionCookie(response),
    cookieJar: parseSetCookies(response),
    enabledDigits: parseEnabledDigits(response.data),
  };
};

// Step 2 — post the credentials back, echoing the session cookie the login page
// handed us. The broker refreshes that cookie and may add trader/HouseName.
const submitLogin = async ({
  accountNumber,
  password,
  sessionCookie,
  enabledDigits,
}) => {
  const response = await axios.post(
    `${BROKER_URL}${BROKER_LOGIN_PATH}`,
    buildLoginBody(accountNumber, password, enabledDigits),
    {
      headers: {
        ...BROWSER_HEADERS,
        ...NAVIGATION_HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        "cache-control": "max-age=0",
        Origin: BROKER_URL,
        Referer: `${BROKER_URL}/`,
        cookie: sessionCookie,
      },
      ...NO_REDIRECT,
    },
  );

  return {
    html: response.data,
    status: response.status,
    sessionCookie: extractSessionCookie(response) ?? sessionCookie,
    cookieJar: parseSetCookies(response),
  };
};

// The history endpoint answers with the login page's HTML when the session is
// dead, rather than a clean 401 — so keep the body raw and decide for ourselves
// whether it parsed, and let 4xx through instead of throwing.
const NO_REDIRECT_RAW = {
  maxRedirects: 0,
  validateStatus: (status) => status >= 200 && status < 500,
  responseType: "text",
  transformResponse: [(data) => data],
};

// Step 3 — pull the order history for a date range, replaying the cached jar.
const fetchOrderHistory = async ({ clientCode, session, params }) => {
  const query = new URLSearchParams(params);

  // Layer defaults under the real login cookies so trader/HouseName are always
  // present even if the login response did not set them; real values win.
  const jar = {
    trader: clientCode,
    HouseName: BROKER_HOUSE_NAME,
    ...session.cookieJar,
  };

  const response = await axios.get(
    `${BROKER_URL}${BROKER_HISTORY_PATH}?${query}`,
    {
      headers: {
        ...BROWSER_HEADERS,
        ...AJAX_HEADERS,
        Referer: `${BROKER_URL}/Home/Index`,
        cookie: buildCookieHeader(jar),
      },
      ...NO_REDIRECT_RAW,
    },
  );

  try {
    return {
      status: response.status,
      data: JSON.parse(response.data),
      isJson: true,
    };
  } catch {
    return { status: response.status, data: response.data, isJson: false };
  }
};

// Holdings currently in the broker-linked CDC account, already adjusted for
// splits and bonus issues. Also carries mtmPrice, the current market price.
const fetchColletralHistory = async ({ clientCode, session }) => {
  // Layer defaults under the real login cookies so trader/HouseName are always
  // present even if the login response did not set them; real values win.
  const jar = {
    trader: clientCode,
    HouseName: BROKER_HOUSE_NAME,
    ...session.cookieJar,
  };

  const response = await axios.get(
    `${BROKER_URL}${BROKER_COLLATERALS_PATH}?account=${encodeURIComponent(clientCode)}`,
    {
      headers: {
        ...BROWSER_HEADERS,
        ...AJAX_HEADERS,
        Referer: `${BROKER_URL}/Home/Index`,
        cookie: buildCookieHeader(jar),
      },
      ...NO_REDIRECT_RAW,
    },
  );

  try {
    return {
      status: response.status,
      data: JSON.parse(response.data),
      isJson: true,
    };
  } catch {
    return { status: response.status, data: response.data, isJson: false };
  }
};

// Logs in to the broker. Returns the session on success, otherwise the HTTP
// status and message the caller should answer with. Shared by the link
// endpoint and the nightly sync.
const brokerLogin = async ({ accountNumber, password }) => {
  const loginPage = await fetchLoginPage();

  if (!loginPage.sessionCookie) {
    return {
      ok: false,
      status: 502,
      error: "No session cookie was returned by the broker login page.",
    };
  }
  if (loginPage.enabledDigits.length === 0) {
    return {
      ok: false,
      status: 502,
      error: "No enabled Digit fields were found in the broker login page.",
    };
  }

  const lastDigit = Math.max(...loginPage.enabledDigits);
  if (password.length < lastDigit) {
    return {
      ok: false,
      status: 400,
      error: `Password is too short: the broker asked for character ${lastDigit}.`,
    };
  }

  const login = await submitLogin({
    accountNumber,
    password,
    sessionCookie: loginPage.sessionCookie,
    enabledDigits: loginPage.enabledDigits,
  });

  if (isInvalidLogin(login.html)) {
    return { ok: false, status: 401, error: "Invalid broker credentials." };
  }

  return {
    ok: true,
    sessionCookie: login.sessionCookie,
    cookieJar: { ...loginPage.cookieJar, ...login.cookieJar },
  };
};

const getAHLSession = async (req, res) => {
  const { accountNumber, password } = req.body ?? {};

  if (!accountNumber || !password) {
    return res.status(400).json({
      error: "accountNumber and password are required.",
    });
  }

  const login = await brokerLogin({ accountNumber, password });
  if (!login.ok) {
    return res.status(login.status).json({ error: login.error });
  }

  // Kept encrypted so the nightly sync can log in without you. Null when
  // CREDENTIALS_KEY is not set, and the account is then skipped by the sync.
  const credentialsEnc = canStoreSecrets() ? encrypt(password) : null;

  const brokerAccount = await prisma.brokerAccount.upsert({
    where: {
      userId_broker_clientCode: {
        userId: req.user.id,
        broker: BROKER_CODE,
        clientCode: accountNumber,
      },
    },
    create: { userId: req.user.id, clientCode: accountNumber, credentialsEnc },
    update: { syncStatus: SYNC_STATUS.IDLE, credentialsEnc },
  });

  const portfolio = await prisma.portfolio.upsert({
    where: { brokerAccountId: brokerAccount.id },
    create: {
      userId: req.user.id,
      brokerAccountId: brokerAccount.id,
      name: `AHL ${accountNumber}`,
    },
    update: {},
  });

  saveSession(brokerAccount.id, {
    sessionCookie: login.sessionCookie,
    cookieJar: login.cookieJar,
  });

  res.status(200).json({
    message: "success",
    data: {
      brokerAccountId: brokerAccount.id,
      portfolioId: portfolio.id,
    },
  });
};

const getAccounts = async (req, res) => {
  const accounts = await prisma.brokerAccount.findMany({
    where: { userId: req.user.id },
    select: {
      id: true,
      broker: true,
      clientCode: true,
      syncStatus: true,
      lastSyncedAt: true,
      createdAt: true,
      portfolios: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({
    message: "success",
    data: {
      accounts,
    },
  });
};

const disconnectAccount = async (req, res) => {
  try {
    const account = await prisma.brokerAccount.update({
      where: { id: req.params.id, userId: req.user.id },
      data: {
        credentialsEnc: null,
        tokenExpiresAt: null,
        syncStatus: SYNC_STATUS.DISCONNECTED,
      },
      select: { id: true, clientCode: true, syncStatus: true },
    });

    return res.status(200).json({
      message: "account disconnected successfully",
      data: { account },
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "account does not exist" });
    }
    throw error;
  }
};

// The broker's history query for one account; `query` can narrow the range.
const historyParams = (clientCode, query = {}) => ({
  account: clientCode,
  fromdate: query.from?.toString() || HISTORY_DEFAULT_FROM,
  todate: query.to?.toString() || new Date().toISOString().slice(0, 10),
  type: query.type?.toString() || "ALL",
  scrip: query.scrip?.toString() || "ALL",
});

// Pulls trades and holdings from the broker with an existing session, saves
// them, and rebuilds positions. Shared by the history endpoint and the
// nightly sync. Returns { ok: false, status, error } when the session is dead.
const syncAccount = async ({ account, session, params }) => {
  const history = await fetchOrderHistory({
    clientCode: account.clientCode,
    session,
    params,
  });

  const collateral = await fetchColletralHistory({
    clientCode: account.clientCode,
    session,
  });

  // Non-JSON means the broker served the login page instead: the session died
  // early. Drop it so the next request does not reuse a known-dead jar.
  if (!history.isJson) {
    clearSession(account.id);
    return {
      ok: false,
      status: 401,
      error: "Broker session expired. Reconnect the account to continue.",
    };
  }

  // Collaterals is an enhancement, not a requirement — a bad response there
  // should not lose the trade sync.
  const collateralRows = collateral.isJson && Array.isArray(collateral.data)
    ? collateral.data
    : [];

  const data = normalizeTradeRows(history?.data);

  // Both sources, so a symbol held only in the broker account still gets a
  // Security row to hang its position and price off.
  const symbols = [
    ...new Set([
      ...(data ?? []).map((trade) => trade?.symbol),
      ...collateralRows.map((row) => row?.symbol),
    ]),
  ].filter(Boolean);
  const securities = symbols?.map((value) =>
    prisma.security.upsert({
      where: { symbol: value },
      create: {
        symbol: value,
        companyName: value,
      },
      update: {},
    }),
  );
  const securityRes = await prisma.$transaction(securities);
  const securityIdBySymbol = new Map(securityRes.map((s) => [s.symbol, s.id]));
  const portfolioId = await prisma.portfolio.findFirst({
    where: {
      brokerAccountId: account.id,
    },
    select: {
      id: true,
    },
  });
  const trades = data?.map((trade) =>
    prisma.trade.upsert({
      where: {
        brokerAccountId_brokerTradeId: {
          brokerAccountId: account.id,
          brokerTradeId: trade?.brokerTradeId,
        },
      },
      create: {
        portfolioId: portfolioId.id,
        securityId: securityIdBySymbol.get(trade.symbol),
        brokerAccountId: account.id,
        brokerTradeId: trade?.brokerTradeId,
        taxesLevies: trade?.taxesLevies,
        side: trade?.side,
        quantity: trade?.quantity,
        price: trade?.price,
        commission: trade?.commission,
        netAmount: trade?.netAmount,
        executedAt: trade?.executedAt,
        rawPayload: trade?.rawPayload,
      },
      update: { rawPayload: trade?.rawPayload },
    }),
  );
  const tradesRes = await prisma.$transaction(trades);
  await prisma.brokerAccount.update({
    where: { id: account.id },
    data: {
      syncStatus: SYNC_STATUS.IDLE,
      lastSyncedAt: new Date(),
      syncCursor: params.todate,
    },
  });

  const allTrades = await prisma.trade.findMany({
    where: {
      portfolioId: portfolioId.id,
    },
    orderBy: { executedAt: "asc" },
  });
  const computed = calculatePositions(allTrades);

  const posotion = mergePositions({
    computed,
    collaterals: collateralRows,
    securityIdBySymbol,
  });

  // Surfaced rather than corrected: a split we never saw shows up here as a
  // positive delta with a matching cost basis.
  const mismatches = reconcilePositions({
    computed,
    collaterals: collateralRows,
    securityIdBySymbol,
  });

  const positionUpsert = posotion?.map((value) =>
    prisma.position.upsert({
      where: {
        portfolioId_securityId: {
          portfolioId: portfolioId.id,
          securityId: value.securityId,
        },
      },
      create: {
        portfolioId: portfolioId.id,
        securityId: value.securityId,
        quantity: value.quantity,
        avgCost: value.avgCost,
        realizedPnl: value.realizePnl,
      },
      update: {
        quantity: value.quantity,
        avgCost: value.avgCost,
        realizedPnl: value.realizePnl,
      },
    }),
  );
  await prisma.$transaction(positionUpsert);

  // mtmPrice is today's market price — the only price feed we have, and it only
  // covers the broker-held symbols.
  const tradeDate = new Date();
  tradeDate.setUTCHours(0, 0, 0, 0);

  const priceUpsert = collateralRows
    .filter((row) => securityIdBySymbol.get(row?.symbol) && row?.mtmPrice != null)
    .map((row) =>
      prisma.dailyPrice.upsert({
        where: {
          securityId_tradeDate: {
            securityId: securityIdBySymbol.get(row.symbol),
            tradeDate,
          },
        },
        create: {
          securityId: securityIdBySymbol.get(row.symbol),
          tradeDate,
          close: row.mtmPrice,
        },
        update: { close: row.mtmPrice, fetchedAt: new Date() },
      }),
    );
  await prisma.$transaction(priceUpsert);

  return {
    ok: true,
    data: {
      securities: securityRes.length,
      trades: tradesRes.length,
      positions: posotion.length,
      prices: priceUpsert.length,
      fromCollaterals: posotion.filter((p) => p.source === "collaterals").length,
      fromTrades: posotion.filter((p) => p.source === "trades").length,
      mismatches,
      from: params.fromdate,
      to: params.todate,
    },
  };
};

// Reads the broker's order history for one linked account. This does not log
// in — it replays the cached session, so an expired one is a 401 telling the
// client to reconnect.
const getHistory = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true },
  });

  if (!account) {
    return res.status(404).json({ error: "account does not exist" });
  }

  const session = getSession(account.id);
  if (!session) {
    return res.status(401).json({
      error: "Broker session expired. Reconnect the account to continue.",
    });
  }

  const result = await syncAccount({
    account,
    session,
    params: historyParams(account.clientCode, req.query),
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.status(200).json({ message: "success", data: result.data });
};

export {
  brokerLogin,
  historyParams,
  syncAccount,
  getAHLSession,
  getAccounts,
  disconnectAccount,
  getHistory,
};

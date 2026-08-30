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
import { calculatePositions, normalizeTradeRows } from "../utils/tradeData.js";
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

const getAHLSession = async (req, res) => {
  const { accountNumber, password } = req.body ?? {};

  if (!accountNumber || !password) {
    return res.status(400).json({
      error: "accountNumber and password are required.",
    });
  }

  const loginPage = await fetchLoginPage();

  if (!loginPage.sessionCookie) {
    return res.status(502).json({
      error: "No session cookie was returned by the broker login page.",
    });
  }
  if (loginPage.enabledDigits.length === 0) {
    return res.status(502).json({
      error: "No enabled Digit fields were found in the broker login page.",
    });
  }

  const lastDigit = Math.max(...loginPage.enabledDigits);
  if (password.length < lastDigit) {
    return res.status(400).json({
      error: `Password is too short: the broker asked for character ${lastDigit}.`,
    });
  }

  const login = await submitLogin({
    accountNumber,
    password,
    sessionCookie: loginPage.sessionCookie,
    enabledDigits: loginPage.enabledDigits,
  });

  if (isInvalidLogin(login.html)) {
    return res.status(401).json({
      error: "Invalid broker credentials.",
    });
  }

  const brokerAccount = await prisma.brokerAccount.upsert({
    where: {
      userId_broker_clientCode: {
        userId: req.user.id,
        broker: BROKER_CODE,
        clientCode: accountNumber,
      },
    },
    create: { userId: req.user.id, clientCode: accountNumber },
    update: { syncStatus: SYNC_STATUS.IDLE },
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
    cookieJar: { ...loginPage.cookieJar, ...login.cookieJar },
  });

  res.status(200).json({
    data: {
      brokerAccountId: brokerAccount.id,
      portfolioId: portfolio.id,
      status: login.status,
      sessionCookie: login.sessionCookie,
      cookies: { ...loginPage.cookieJar, ...login.cookieJar },
      enabledDigits: loginPage.enabledDigits,
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

  const params = {
    account: account.clientCode,
    fromdate: req.query.from?.toString() || HISTORY_DEFAULT_FROM,
    todate: req.query.to?.toString() || new Date().toISOString().slice(0, 10),
    type: req.query.type?.toString() || "ALL",
    scrip: req.query.scrip?.toString() || "ALL",
  };

  const history = await fetchOrderHistory({
    clientCode: account.clientCode,
    session,
    params,
  });

  // Non-JSON means the broker served the login page instead: the session died
  // early. Drop it so the next request does not reuse a known-dead jar.
  if (!history.isJson) {
    clearSession(account.id);
    return res.status(401).json({
      error: "Broker session expired. Reconnect the account to continue.",
    });
  }
  const data = normalizeTradeRows(history?.data);
  const symbols = [...new Set(data?.map((trade) => trade?.symbol))];
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
  const posotion = calculatePositions(allTrades);
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
  console.log({ posotion });
  res.status(200).json({
    message: "success",
    data: {
      securities: securityRes.length,
      trades: tradesRes.length,
      from: params.fromdate,
      to: params.todate,
    },
  });
};

export { getAHLSession, getAccounts, disconnectAccount, getHistory };

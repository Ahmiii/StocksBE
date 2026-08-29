import { prisma } from "../config/db.js";
import axios from "axios";
import {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  BROKER_URL,
  BROKER_CODE,
  SYNC_STATUS,
  BROKER_LOGIN_PATH,
} from "../config/constants.js";
import {
  extractSessionCookie,
  parseSetCookies,
  parseEnabledDigits,
  isInvalidLogin,
  buildLoginBody,
} from "../utils/extractAHLInfor.js";

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

const getAHLSession = async (req, res) => {
  const { account_number, password } = req.body ?? {};

  if (!account_number || !password) {
    return res.status(400).json({
      error: "account_number and password are required.",
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
    accountNumber: account_number,
    password,
    sessionCookie: loginPage.sessionCookie,
    enabledDigits: loginPage.enabledDigits,
  });

  if (isInvalidLogin(login.html)) {
    return res.status(401).json({
      error: "Invalid broker credentials.",
    });
  }

  // Re-linking a previously disconnected account reuses the same row, so the
  // trade dedupe key stays stable.
  const brokerAccount = await prisma.brokerAccount.upsert({
    where: {
      userId_broker_clientCode: {
        userId: req.user.id,
        broker: BROKER_CODE,
        clientCode: account_number,
      },
    },
    create: { userId: req.user.id, clientCode: account_number },
    update: { syncStatus: SYNC_STATUS.IDLE },
  });

  const portfolio = await prisma.portfolio.upsert({
    where: { brokerAccountId: brokerAccount.id },
    create: {
      userId: req.user.id,
      brokerAccountId: brokerAccount.id,
      name: `AHL ${account_number}`,
    },
    update: {},
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

export { getAHLSession, getAccounts, disconnectAccount };

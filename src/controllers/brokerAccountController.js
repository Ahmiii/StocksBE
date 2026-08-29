import axios from "axios";
import {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  BROKER_URL,
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

  res.status(200).json({
    data: {
      status: login.status,
      sessionCookie: login.sessionCookie,
      cookies: { ...loginPage.cookieJar, ...login.cookieJar },
      enabledDigits: loginPage.enabledDigits,
    },
  });
};

export { getAHLSession };

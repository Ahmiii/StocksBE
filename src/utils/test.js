const BASE_URL = "https://web.ahletrade.com";
const DASHBOARD_URL = "https://data.arifhabibltd.com/api/v3";
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin; // https://data.arifhabibltd.com
const USERNAME = process.env.AHL_USERNAME || "CC24944";
const PASSWORD = process.env.AHL_PASSWORD || "Stock1234";
const HOUSE_NAME = process.env.AHL_HOUSE || "AHL";

const BROWSER_HEADERS = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "sec-ch-ua":
    '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

// Pull the .AspNetCore.Session value out of a response's Set-Cookie header.
const extractSessionCookie = (response) => {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const match = raw.match(/\.AspNetCore\.Session=([^;]+)/);
    if (match) return `.AspNetCore.Session=${match[1]}`;
  }
  return null;
};

// The site randomizes which Digit inputs are enabled each session. Read the
// login HTML and return the enabled positions, e.g. [1, 3, 6, 7].
const parseEnabledDigits = (html) => {
  const enabled = [];
  const inputRegex = /<input\b[^>]*\bname="Digit(\d+)"[^>]*>/gi;
  let match;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    const position = Number(match[1]);
    if (!/\bdisabled\b/i.test(tag)) enabled.push(position);
  }
  return enabled;
};

// Build "UserName=..&DigitN=<Nth char>&.." for the enabled positions only.
const buildLoginBody = (username, password, enabledDigits) => {
  const params = new URLSearchParams({ UserName: username });
  for (const position of enabledDigits) {
    const char = password[position - 1];
    if (char === undefined) {
      throw new Error(
        `Password too short: needs a character at position ${position}, but it has only ${password.length}.`,
      );
    }
    params.set(`Digit${position}`, char);
  }
  return params.toString();
};

// Call GetAnalyticsURL with an authenticated session cookie (post-login).
const getAnalyticsUrl = async (sessionCookie) => {
  const response = await fetch(`${BASE_URL}/Home/GetAnalyticsURL`, {
    method: "GET",
    headers: {
      ...BROWSER_HEADERS,
      accept: "*/*",
      "x-requested-with": "XMLHttpRequest",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      Referer: `${BASE_URL}/Home/Index`,
      cookie: sessionCookie,
    },
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// Extract the handoff token from the analytics URL query string.
const extractToken = (analytics) => {
  // analytics is the URL string (or an object if the endpoint ever returns JSON)
  const url =
    typeof analytics === "string" ? analytics : (analytics?.url ?? "");
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

// Decode a JWT's `exp` claim and return the expiry as epoch milliseconds.
const decodeJwtExp = (jwt) => {
  try {
    const payload = jwt.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
};

const login = async () => {
  // 1. GET the login page to obtain a session cookie and the enabled digits.
  const pageResponse = await fetch(`${BASE_URL}/`, {
    method: "GET",
    headers: {
      ...BROWSER_HEADERS,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      Referer: `${BASE_URL}/`,
    },
  }
);

  const pageHtml = await pageResponse.text();
  const sessionCookie = extractSessionCookie(pageResponse);
  const enabledDigits = parseEnabledDigits(pageHtml);
  const cookieJar = parseSetCookies(pageResponse); // keep every cookie, not just the session

  if (!sessionCookie)
    throw new Error(
      "No .AspNetCore.Session cookie was returned by the login page.",
    );
  if (enabledDigits.length === 0)
    throw new Error("No enabled Digit fields found in the login page.");

  console.log("Enabled digit positions:", enabledDigits.join(", "));

  // 2. POST the credentials, echoing the same session cookie back.
  const body = buildLoginBody(USERNAME, PASSWORD, enabledDigits);
  const loginResponse = await fetch(`${BASE_URL}/Home/_Login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...BROWSER_HEADERS,
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "max-age=0",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      cookie: sessionCookie,
    },
    body,
  });

  const loginHtml = await loginResponse.text();
  const invalid = /Invalid Login Credentials/i.test(loginHtml);

  // The POST refreshes the session cookie and may set trader/HouseName.
  Object.assign(cookieJar, parseSetCookies(loginResponse));

  return {
    ok: !invalid,
    status: loginResponse.status,
    sessionCookie: extractSessionCookie(loginResponse) ?? sessionCookie,
    cookies: cookieJar,
    enabledDigits,
    html: loginHtml,
  };
};

const parseSetCookies = (response) => {
  const jar = {};
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
};

const jarToHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

// Visit the dashboard handoff URL, collect cookies across redirects,
// and extract the Passport JWT from the returned HTML.
const openDashboard = async (analyticsUrl) => {
  let url = analyticsUrl.replace(/^http:/, "https:"); // it comes back as http
  const jar = {};
  let html = "";

  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        ...BROWSER_HEADERS,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site", // coming from ahletrade
        "upgrade-insecure-requests": "1",
        ...(Object.keys(jar).length ? { cookie: jarToHeader(jar) } : {}),
      },
    });

    Object.assign(jar, parseSetCookies(res)); // capture Set-Cookie on every hop

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    html = await res.text();
    break;
  }

  // Passport RS256 tokens always start with the header for {"typ":"JWT","alg":"RS256"}
  const jwt = html.match(
    /eyJ0eXAiOiJKV1Q[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  );
  return { bearer: jwt?.[0] ?? null, cookies: jar, html };
};

const getMarketData = async (bearer, cookies, path = "/daily/KSE100") => {
  const res = await fetch(
    `${DASHBOARD_URL}/market?path=${encodeURIComponent(path)}`,
    {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        accept: "*/*",
        authorization: `Bearer ${bearer}`,
        "x-requested-with": "XMLHttpRequest",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        Referer: `${DASHBOARD_ORIGIN}/dashboard`,
        cookie: jarToHeader(cookies),
      },
    },
  );
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
};

// NOTE: the endpoint really is spelled "GetOrderHisotry" (server-side typo) —
// don't "correct" it or the request 404s.
const getOrderHistory = async (
  session,
  { account, fromdate, todate, type = "ALL", scrip = "ALL" },
) => {
  const query = new URLSearchParams({ account, fromdate, todate, type, scrip });

  // Layer defaults under the real login cookies so trader/HouseName are always
  // present even if the login response didn't set them; real values win.
  const jar = {
    trader: account,
    HouseName: HOUSE_NAME,
    ...(session.ahlCookies ?? {}),
  };

  const res = await fetch(`${BASE_URL}/Home/GetOrderHisotry?${query}`, {
    method: "GET",
    headers: {
      ...BROWSER_HEADERS,
      accept: "*/*",
      "x-requested-with": "XMLHttpRequest",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      Referer: `${BASE_URL}/Home/Index`,
      cookie: jarToHeader(jar),
    },
  });

  const text = await res.text();
  let data;
  let isJson = true;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
    isJson = false;
  }
  return { status: res.status, data, isJson };
};

/* ---------------------------------------------------------------------------
 * Session management
 *
 * The full handshake (login -> analytics URL -> dashboard handoff -> JWT) is
 * expensive, so we cache the resulting bearer token + cookie jar and reuse
 * them until the JWT is close to expiring. Concurrent refreshes are coalesced
 * into a single login flow so a burst of requests doesn't trigger many logins.
 * ------------------------------------------------------------------------- */
let sessionCache = null; // { bearer, cookies, expiresAt, ... }
let refreshInFlight = null; // Promise while a refresh is running

const refreshSession = async () => {
  const now = Date.now();

  const loginResult = await login();
  if (!loginResult.ok) {
    const err = new Error(
      "Invalid login credentials — check AHL_USERNAME / AHL_PASSWORD.",
    );
    err.status = 401;
    throw err;
  }

  const analytics = await getAnalyticsUrl(loginResult.sessionCookie);
  const analyticsUrl =
    typeof analytics === "string" ? analytics : analytics?.url;
  if (!analyticsUrl) throw new Error("No analytics URL returned after login.");

  const { bearer, cookies: dashboardCookies } =
    await openDashboard(analyticsUrl);
  if (!bearer)
    throw new Error("Could not extract dashboard bearer token from handoff.");

  const exp = decodeJwtExp(bearer);
  sessionCache = {
    bearer,
    dashboardCookies, // data.arifhabibltd.com — market data
    ahlCookies: loginResult.cookies, // web.ahletrade.com — order history
    analyticsUrl,
    handoffToken: extractToken(analytics),
    enabledDigits: loginResult.enabledDigits,
    sessionCookie: loginResult.sessionCookie,
    // Fall back to a 10-minute lifetime if the token has no readable exp.
    expiresAt: exp ?? now + 10 * 60 * 1000,
  };
  return sessionCache;
};

const getAuthenticatedSession = async ({ force = false } = {}) => {
  const now = Date.now();

  // Reuse the cached session while it's still valid (30s safety margin).
  if (!force && sessionCache && sessionCache.expiresAt - 30_000 > now) {
    return sessionCache;
  }

  // Coalesce concurrent refreshes into one login flow.
  if (!refreshInFlight) {
    refreshInFlight = refreshSession().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

/* --------------------------------- Routes -------------------------------- */

app.get("/hello", (req, res) => {
  res.json({ mesaage: "from be" });
});

// Force a fresh login and return the resulting bearer token + metadata.
app.get("/login", async (req, res) => {
  try {
    const session = await getAuthenticatedSession({ force: true });
    res.json({
      ok: true,
      enabledDigits: session.enabledDigits,
      handoffToken: session.handoffToken,
      bearer: session.bearer,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (error) {
    console.error("Login failed", error);
    res.status(error.status ?? 500).json({ ok: false, error: error.message });
  }
});

// Fetch market data. Query params:
//   ?path=/daily/KSE100  (defaults to /daily/KSE100)
app.get("/market", async (req, res) => {
  try {
    const path = req.query.path?.toString() || "/daily/KSE100";

    let session = await getAuthenticatedSession();
    let result = await getMarketData(session.bearer, session.dashboardCookies, path);

    // If the cached token was rejected, force one refresh and retry.
    if (result.status === 401 || result.status === 403) {
      session = await getAuthenticatedSession({ force: true });
      result = await getMarketData(session.bearer, session.dashboardCookies, path);
    }

    res.status(result.status).json({
      ok: result.status < 400,
      path,
      data: result.data,
    });
  } catch (error) {
    console.error("Market data failed", error);
    res.status(error.status ?? 500).json({ ok: false, error: error.message });
  }
});

// Fetch order history. Query params (all optional):
//   ?account=CC24944&fromdate=2022-01-01&todate=2026-08-23&type=ALL&scrip=ALL
app.get("/history", async (req, res) => {
  try {
    const account = req.query.account?.toString() || USERNAME;
    const fromdate = req.query.fromdate?.toString() || "2022-01-01";
    const todate =
      req.query.todate?.toString() || new Date().toISOString().slice(0, 10);
    const type = req.query.type?.toString() || "ALL";
    const scrip = req.query.scrip?.toString() || "ALL";
    const params = { account, fromdate, todate, type, scrip };

    let session = await getAuthenticatedSession();
    let result = await getOrderHistory(session, params);

    // A dead session usually comes back as the login HTML (non-JSON) rather
    // than a clean 401/403, so refresh + retry once on either signal.
    if (result.status === 401 || result.status === 403 || !result.isJson) {
      session = await getAuthenticatedSession({ force: true });
      result = await getOrderHistory(session, params);
    }

    res.status(result.isJson ? result.status : 502).json({
      ok: result.isJson && result.status < 400,
      params,
      data: result.data,
    });
  } catch (error) {
    console.error("Order history failed", error);
    res.status(error.status ?? 500).json({ ok: false, error: error.message });
  }
});

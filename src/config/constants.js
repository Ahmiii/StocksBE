import "dotenv/config";

// Identity headers sent on every broker request so the requests look like they
// came from a normal Chrome session.
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

// Extra headers a browser adds when it navigates to a document, i.e. loading
// the login page and submitting the login form.
const NAVIGATION_HEADERS = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

// Headers a browser adds for an in-page XHR, i.e. the order-history call. The
// broker checks x-requested-with and answers with JSON instead of a document.
const AJAX_HEADERS = {
  accept: "*/*",
  "x-requested-with": "XMLHttpRequest",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

const BROKER_URL = process.env.BROKER_URL;

// Must match the BrokerAccount.broker default in schema.prisma — it is part of
// the @@unique([userId, broker, clientCode]) key.
const BROKER_CODE = "AHL_ETRADE";

// syncStatus values. "disconnected" means the user unlinked the account: the
// stored credentials are cleared but the trade history is kept.
const SYNC_STATUS = {
  IDLE: "idle",
  SYNCING: "syncing",
  ERROR: "error",
  DISCONNECTED: "disconnected",
};

// Nightly sync: some time between 18:00 and 23:00 Karachi time on weekdays.
// The job wakes at SYNC_START_HOUR and waits a random slice of the window,
// so it runs at a different time every evening.
const SYNC_TIMEZONE = "Asia/Karachi";
const SYNC_START_HOUR = 18;
const SYNC_JITTER_MINUTES = 5 * 60;
const SYNC_SCHEDULE = `0 ${SYNC_START_HOUR} * * 1-5`;

// Path the login form posts to, relative to BROKER_URL.
const BROKER_LOGIN_PATH = "/Home/_Login";

// The endpoint really is spelled "GetOrderHisotry" — that is the broker's own
// typo. Correcting it 404s.
const BROKER_HISTORY_PATH = "/Home/GetOrderHisotry";

// Holdings sitting in the broker-linked CDC account — the tradable ones. Shares
// moved to a sub-investor CDC account are NOT listed here, so this is a subset
// of what the trade history implies you own.
const BROKER_COLLATERALS_PATH = "/Home/GetCollaterals";

// The order-history call wants trader + HouseName cookies alongside the session.
const BROKER_HOUSE_NAME = process.env.BROKER_HOUSE_NAME || "AHL";

// Order history is fetched over a date range; default to everything.
const HISTORY_DEFAULT_FROM = "2022-01-01";

// The ASP.NET session cookie the broker issues on the login page and refreshes
// on a successful login.
const SESSION_COOKIE_NAME = ".AspNetCore.Session";

// Marker the broker renders in the HTML when the credentials are rejected.
const INVALID_LOGIN_PATTERN = /Invalid Login Credentials/i;

// Returns a one-time handoff URL into the analytics dashboard. Following that
// URL is what makes arifhabib issue its own laravel_session cookie — which is
// the credential their market API actually checks.
const BROKER_ANALYTICS_PATH = "/Home/GetAnalyticsURL";

// Every tradable symbol on the exchange. "Symols" is the broker's typo.
const BROKER_SYMBOLS_PATH = "/Home/GetSymolsList";

export {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  AJAX_HEADERS,
  BROKER_URL,
  BROKER_CODE,
  SYNC_STATUS,
  SYNC_SCHEDULE,
  SYNC_TIMEZONE,
  SYNC_START_HOUR,
  SYNC_JITTER_MINUTES,
  BROKER_LOGIN_PATH,
  BROKER_HISTORY_PATH,
  BROKER_COLLATERALS_PATH,
  BROKER_HOUSE_NAME,
  HISTORY_DEFAULT_FROM,
  SESSION_COOKIE_NAME,
  INVALID_LOGIN_PATTERN,
  BROKER_ANALYTICS_PATH,
  BROKER_SYMBOLS_PATH,
};

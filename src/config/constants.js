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

const BROKER_URL = process.env.BROKER_URL;

// Path the login form posts to, relative to BROKER_URL.
const BROKER_LOGIN_PATH = "/Home/_Login";

// The ASP.NET session cookie the broker issues on the login page and refreshes
// on a successful login.
const SESSION_COOKIE_NAME = ".AspNetCore.Session";

// Marker the broker renders in the HTML when the credentials are rejected.
const INVALID_LOGIN_PATTERN = /Invalid Login Credentials/i;

// Our own cookie, handed to the API client, holding the broker cookie header we
// need to replay on later broker calls.
const AHL_SESSION_COOKIE = "ahl_session";

// Broker sessions expire on their own; this just stops a stale cookie lingering
// in the client forever.
const AHL_SESSION_MAX_AGE_MS = 1000 * 60 * 20;

export {
  BROWSER_HEADERS,
  NAVIGATION_HEADERS,
  BROKER_URL,
  BROKER_LOGIN_PATH,
  SESSION_COOKIE_NAME,
  INVALID_LOGIN_PATTERN,
  AHL_SESSION_COOKIE,
  AHL_SESSION_MAX_AGE_MS,
};

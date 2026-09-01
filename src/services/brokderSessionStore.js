const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;
const SAFETY_MARGIN_MS = 30 * 1000;

const saveSession = (brokerAccountId, { sessionCookie, cookieJar }) => {
  sessions.set(brokerAccountId, {
    sessionCookie,
    cookieJar,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
};

const getSession = (brokerAccountId) => {
  const session = sessions.get(brokerAccountId);
  if (!session) return null;

  if (Date.now() >= session.expiresAt - SAFETY_MARGIN_MS) {
    sessions.delete(brokerAccountId);
    return null;
  }
  return session;
};

const clearSession = (brokerAccountId) => sessions.delete(brokerAccountId);

/* -------------------------------------------------------------------------- */
/* Market data session                                                        */
/*                                                                            */
/* The analytics dashboard is a different host with its own cookie. Its server */
/* sends Max-Age=7200, so we hold it a little under two hours and re-run the   */
/* handoff when it lapses.                                                    */
/* -------------------------------------------------------------------------- */

// brokerAccountId -> { cookieHeader, expiresAt }
const marketSessions = new Map();
const MARKET_TTL_MS = 110 * 60 * 1000;

const saveMarketSession = (brokerAccountId, { cookieHeader }) => {
  marketSessions.set(brokerAccountId, {
    cookieHeader,
    expiresAt: Date.now() + MARKET_TTL_MS,
  });
};

const getMarketSession = (brokerAccountId) => {
  const session = marketSessions.get(brokerAccountId);
  if (!session) return null;

  if (Date.now() >= session.expiresAt) {
    marketSessions.delete(brokerAccountId);
    return null;
  }
  return session;
};

const clearMarketSession = (brokerAccountId) =>
  marketSessions.delete(brokerAccountId);

export {
  saveSession,
  getSession,
  clearSession,
  saveMarketSession,
  getMarketSession,
  clearMarketSession,
};
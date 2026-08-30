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

export { saveSession, getSession, clearSession };
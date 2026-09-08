import cron from "node-cron";
import { prisma } from "../config/db.js";
import {
  SYNC_STATUS,
  SYNC_SCHEDULE,
  SYNC_TIMEZONE,
  SYNC_START_HOUR,
  SYNC_JITTER_MINUTES,
} from "../config/constants.js";
import { canStoreSecrets, decrypt } from "../utils/secrets.js";
import { pause } from "../utils/pace.js";
import {
  brokerLogin,
  historyParams,
  syncAccount,
} from "../controllers/brokerAccountController.js";
import { syncPricesForAccount } from "../controllers/marketDataController.js";
import { syncCorporateActionsForAccount } from "../controllers/corporateActionController.js";
import { saveSession } from "../services/brokderSessionStore.js";

// The nightly routine for one account: log in with the stored password, then
// corporate actions (so the position rebuild can use them), trades and
// holdings, and finally the missing price bars.
const syncOneAccount = async (account) => {
  const login = await brokerLogin({
    accountNumber: account.clientCode,
    password: decrypt(account.credentialsEnc),
  });
  if (!login.ok) throw new Error(login.error);

  const session = { sessionCookie: login.sessionCookie, cookieJar: login.cookieJar };
  saveSession(account.id, session);

  const actions = await syncCorporateActionsForAccount({
    brokerAccountId: account.id,
    clientCode: account.clientCode,
  });

  const trades = await syncAccount({
    account,
    session,
    params: historyParams(account.clientCode),
  });
  if (!trades.ok) throw new Error(trades.error);

  const prices = await syncPricesForAccount(account);

  return {
    corporateActions: actions.actions,
    trades: trades.data.trades,
    positions: trades.data.positions,
    newPriceRows: prices.newRows,
  };
};

const markStatus = (accountId, syncStatus) =>
  prisma.brokerAccount.update({ where: { id: accountId }, data: { syncStatus } });

// Every account with a stored password, one after another.
const runDailySync = async () => {
  const accounts = await prisma.brokerAccount.findMany({
    where: {
      credentialsEnc: { not: null },
      syncStatus: { not: SYNC_STATUS.DISCONNECTED },
    },
    select: { id: true, clientCode: true, credentialsEnc: true },
  });
  console.log(`[sync] ${accounts.length} account(s) to sync`);

  for (const account of accounts) {
    await markStatus(account.id, SYNC_STATUS.SYNCING);
    try {
      const result = await syncOneAccount(account);
      console.log(`[sync] ${account.clientCode}:`, result);
    } catch (error) {
      console.error(`[sync] ${account.clientCode} failed: ${error.message}`);
      await markStatus(account.id, SYNC_STATUS.ERROR);
    }
  }
};

// Wait a random slice of the evening, then run. Each night lands somewhere
// different between SYNC_START_HOUR and five hours later.
const runAtARandomTime = async () => {
  await pause(0, SYNC_JITTER_MINUTES * 60 * 1000);
  console.log(`[sync] starting at ${new Date().toISOString()}`);
  await runDailySync();
};

// The clock in Karachi: today's date, the hour, and whether it is a weekday.
const karachiNow = () => {
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: SYNC_TIMEZONE });
  const hour = Number(
    now.toLocaleTimeString("en-GB", { timeZone: SYNC_TIMEZONE, hour12: false }).slice(0, 2),
  );
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return { today, hour, isWeekday: weekday >= 1 && weekday <= 5 };
};

// A restart during the evening wait kills the pending run. If the server
// comes up after the window opened and nothing has synced today, catch up
// in a few minutes instead of waiting for tomorrow.
const catchUpIfMissed = async () => {
  const { today, hour, isWeekday } = karachiNow();
  if (!isWeekday || hour < SYNC_START_HOUR) return;

  const startOfToday = new Date(`${today}T00:00:00+05:00`);
  const missed = await prisma.brokerAccount.count({
    where: {
      credentialsEnc: { not: null },
      syncStatus: { not: SYNC_STATUS.DISCONNECTED },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: startOfToday } }],
    },
  });
  if (missed === 0) return;

  console.log(`[sync] ${missed} account(s) not synced today; catching up in a few minutes`);
  await pause(60 * 1000, 5 * 60 * 1000);
  await runDailySync();
};

// Called once when the server starts.
const startDailySync = () => {
  if (!canStoreSecrets()) {
    console.warn("[sync] CREDENTIALS_KEY is not set, so the nightly sync is off.");
    return;
  }
  cron.schedule(SYNC_SCHEDULE, runAtARandomTime, { timezone: SYNC_TIMEZONE });
  console.log(
    `[sync] scheduled: weekdays between ${SYNC_START_HOUR}:00 and ${SYNC_START_HOUR + SYNC_JITTER_MINUTES / 60}:00 ${SYNC_TIMEZONE}`,
  );
  catchUpIfMissed().catch((error) => console.error("[sync] catch-up failed:", error.message));
};

// POST /broker/accounts/:id/full-sync — the nightly routine, right now.
const fullSyncNow = async (req, res) => {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true, clientCode: true, credentialsEnc: true },
  });
  if (!account) return res.status(404).json({ error: "account does not exist" });
  if (!account.credentialsEnc) {
    return res.status(400).json({
      error: "No stored password for this account. Link it again to enable sync.",
    });
  }

  await markStatus(account.id, SYNC_STATUS.SYNCING);
  try {
    const data = await syncOneAccount(account);
    res.status(200).json({ message: "success", data });
  } catch (error) {
    await markStatus(account.id, SYNC_STATUS.ERROR);
    res.status(502).json({ error: error.message });
  }
};

export { syncOneAccount, runDailySync, startDailySync, catchUpIfMissed, karachiNow, fullSyncNow };

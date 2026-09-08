import cron from "node-cron";
import { prisma } from "../config/db.js";
import { SYNC_STATUS, SYNC_SCHEDULE, SYNC_TIMEZONE } from "../config/constants.js";
import { canStoreSecrets, decrypt } from "../utils/secrets.js";
import {
  brokerLogin,
  historyParams,
  syncAccount,
} from "../controllers/brokerAccountController.js";
import { syncPricesForAccount } from "../controllers/marketDataController.js";
import { saveSession } from "../services/brokderSessionStore.js";

// The nightly routine for one account: log in with the stored password, pull
// trades and holdings, then fetch the missing price bars.
const syncOneAccount = async (account) => {
  const login = await brokerLogin({
    accountNumber: account.clientCode,
    password: decrypt(account.credentialsEnc),
  });
  if (!login.ok) throw new Error(login.error);

  const session = { sessionCookie: login.sessionCookie, cookieJar: login.cookieJar };
  saveSession(account.id, session);

  const trades = await syncAccount({
    account,
    session,
    params: historyParams(account.clientCode),
  });
  if (!trades.ok) throw new Error(trades.error);

  const prices = await syncPricesForAccount(account);

  return {
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

// Called once when the server starts.
const startDailySync = () => {
  if (!canStoreSecrets()) {
    console.warn("[sync] CREDENTIALS_KEY is not set, so the nightly sync is off.");
    return;
  }
  cron.schedule(SYNC_SCHEDULE, runDailySync, { timezone: SYNC_TIMEZONE });
  console.log(`[sync] scheduled "${SYNC_SCHEDULE}" ${SYNC_TIMEZONE}`);
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

export { syncOneAccount, runDailySync, startDailySync, fullSyncNow };

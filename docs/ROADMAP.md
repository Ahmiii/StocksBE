# Product roadmap

> Written 2026-09-08. What to build next, in order, to turn the tracker into a real portfolio and stock analytics app. Each step says why it matters, where the data comes from, what changes on the backend and in the app, and how you know it is done. Sizes: **S** = an evening, **M** = a weekend, **L** = a week of evenings.

**Where we are.** The app knows trades, positions, daily prices, a KSE100 benchmark, a watchlist, and a full portfolio-vs-index analysis. It does not know about cash, dividends, corporate actions, or anything about the companies themselves. Everything below fixes that, then builds on it.

**Data provider.** All market data comes from the Arif Habib analytics API behind the broker handoff. Its dashboard script also calls these endpoints, so they are available to us with the same session: `company-statement` (fundamentals), `payouts/*` (dividends), `news/SYMBOL`, `indicators` and `economy-data` (rates), `market?path=/equities` (live snapshot), `market?path=/intraday/SYMBOL/1D`, and daily bars for the indices KSE30, KMI30, ALLSHR, BKTI (banks), OGTI (oil & gas), PSXDIV20.

---

## Phase 0 — Foundation (do first, everything else leans on it)

### 0.1 Page token in the market session — S
- **Why:** fundamentals, payouts and news need a bearer token as well as the session cookie. The token is embedded in every dashboard page as `<meta name="access-token">` and **rotates on each page load** (the previous one dies).
- **Backend:** after `openDashboard`, load one dashboard page with the cookie, read the meta tag, store `{ cookieHeader, accessToken }` in the market session. On a 401 from a token endpoint, reload the page once and retry.
- **Done when:** `company-statement?symbol=LCI` returns 200 through the backend.

### 0.2 Scheduled sync — M
- **Why:** today nothing updates unless someone opens the app and the broker session (15 min) is alive. Analytics on stale prices is wrong analytics.
- **Decision to make:** unattended sync needs a broker login without you present. Either store the broker password encrypted (`credentialsEnc` already exists, unused) or accept that sync only runs while the app has recently linked. For a personal app, encrypt-at-rest with a key in `.env` is reasonable.
- **Backend (as built):** `node-cron` job on weekdays at a random time between 18:00 and 23:00 PKT, with a catch-up at startup if a restart ate the evening's run: broker login → corporate actions → trade sync → price sync. Status and time on the broker account row instead of a `sync_runs` table.
- **App:** Portfolio header shows "Synced 17:32" from the last run instead of the static "Sync now" label.
- **Done when:** the app opens on a Monday morning with Friday's closes already there.

### 0.3 Hygiene — S
- Global Express error handler (JSON, never HTML). Input validation on auth and broker routes.
- Delete `src/utils/test.js` (hard-coded broker credentials in git). Strip `sessionCookie` / `cookies` from the link-broker response.
- **Done when:** a missing field returns `{ "error": "…" }` with 400, and `git grep Stock1234` finds nothing.

---

## Phase 1 — Make the numbers true

### 1.1 Corporate actions — M — **done 2026-09-08**
- **Why:** ENGRO became 17 ENGROH shares in Jan 2025 and BAFL split 2-for-1 in Apr 2026; the database still shows 8 ENGRO and 33 BAFL. The broker cannot tell us because both sit in the sub-investor account.
- **Data (as built):** dividends, bonus and rights from the provider's `payouts/announcement-break-down/SYMBOL`; splits detected from the provider's unadjusted price feed against our adjusted closes; mergers by hand with `npm run corporate-action`. First run recorded 263 dividends, 17 bonus issues, 4 splits and 4 rights across 24 symbols. Phase 0 is also done.
- **Backend:** `corporate_actions` table (type SPLIT | BONUS | MERGER | DELIST, ratio, effective date, to-symbol). Applied in the position rebuild after sync and in the benchmark walk; `detectAdjustedSplits` becomes a warning instead of a guess. Mark ENGRO `delisted` in `listingStatus`.
- **App:** stale-price badge on holdings (`priceAsOf` older than a week). Already spec'd; ten minutes.
- **Done when:** positions show 17 ENGROH priced today and 66 BAFL, and the benchmark walk emits no "unrecorded split" warning.

### 1.2 Real day change — S
- **Why:** the header's "today" number was a placeholder and is now "unrealised". People open a portfolio app to see today.
- **Data:** previous close is already in `daily_prices`.
- **Backend:** positions endpoint adds `previousClose`, `dayChange`, `dayChangePct` per position and `dayChange` in the summary. During market hours, `market?path=/equities` gives a live snapshot; store it as today's bar with `fetchedAt`.
- **App:** header badge back to "today"; holdings rows get a day-change column.
- **Done when:** the header matches the broker's own "today's P&L" at the close.

### 1.3 Dividends and the cash ledger — L — **dividend half done 2026-09-08**
- **Built:** `GET /portfolio/:id/income` (entitled dividends from trades × recorded dividends: this fiscal year, last 12 months, projected, upcoming with buy-before dates, per holding) and the Income card plus dividend calendar on the Portfolio tab; the stock screen shows next dividend, trailing DPS and last split/bonus. Dividends are now inside the benchmark too: the time-weighted line counts a dividend as return on its ex-date, XIRR takes each one as an inflow, the headline shows holdings + dividends against a shadow index credited with 4% a year (`KSE100_DIVIDEND_YIELD`), and per-stock alpha includes dividends per share. **Still open:** the broker cash ledger (real deposits, withdrawals, credits, charges).
- **Why:** the largest missing piece. PSX is a dividend market (LCI 4.4%, FFC and the banks higher) and none of it is counted, so every return is understated and XIRR is built from trade flows instead of real deposits.
- **Data:** two sources. The broker's account statement / ledger (find the endpoint in the web app the same way `GetOrderHisotry` was found) for actual cash: deposits, withdrawals, dividend credits, charges, tax. The provider's `payouts/announcement-break-down/SYMBOL` for announced DPS and book-closure dates.
- **Backend:** `cash_events` table (date, type DEPOSIT | WITHDRAWAL | DIVIDEND | CHARGE | TAX, amount, symbol?). Sync from the ledger with the same fingerprint idea as trades. Benchmark walk: dividends are inflows that stay in the portfolio (total return); XIRR uses real deposits and withdrawals; headline adds `dividendsReceived` and `cash`.
- **App:** "Income" card on the Portfolio tab (dividends this year, yield on cost), a dividend calendar (upcoming book closures for held stocks), and cash shown next to holdings so the account value is the real one.
- **Done when:** account value in the app equals the broker's statement to the rupee, and the benchmark says "including Rs X of dividends".

### 1.4 Fundamentals — M
- **Why:** turns "price went up" into "P/E 11 vs sector 14, dividend covered twice, debt low". Also a free screener.
- **Data:** `company-statement?symbol=X&interval=annual&type=fundamentals`: 8 periods (TTM + 7 fiscal years), 41 ratios each with label, unit, key, and sector min/median/max. Percent fields arrive as fractions.
- **Backend:** `fundamentals` table (securityId, period, key, value, sectorMedian, fetchedAt). Fetch on demand with a one-day skip-if-current rule, and weekly for held symbols in the cron. `GET /market/fundamentals/:symbol` returns the latest period grouped: valuation, dividends, profitability, balance sheet, efficiency, each value beside its sector median.
- **App:** "Fundamentals" card on the stock screen with a small bar per ratio (you vs sector median). Watchlist rows get P/E and yield.
- **Done when:** LCI's card shows P/E 11.3, yield 4.4%, ROE 18.2% with sector bars.

---

## Phase 2 — Analytics from data you already have

### 2.1 Risk — M
- **Backend:** `GET /portfolio/:id/risk` from `daily_prices`: per stock volatility (annualised), beta vs KSE100, max drawdown; portfolio beta and volatility; Sharpe with a risk-free rate from `indicators` / `economy-data` or one config value; the three most correlated pairs.
- **App:** "Risk" card under the performance chart: beta, volatility, drawdown, with one plain sentence ("moves 1.2× the index").
- **Done when:** portfolio beta and the benchmark's max drawdown agree with the chart.

### 2.2 Allocation and concentration — S
- **Backend:** positions summary adds sector weights (the sector column exists) and top-five weight.
- **App:** sector pie and a warning when one stock is over 25% of the book. FFC is 24% today.

### 2.3 Contribution and trade stats — M
- **Backend:** `GET /portfolio/:id/attribution`: rupees each stock added to total gain (open and closed), realised profit by year, hit rate, average win vs average loss, holding period, and for closed positions "what it would be worth today" (the ILP question).
- **App:** "Where the gains came from" list and a "Closed positions" section on the Trades tab.

### 2.4 More benchmarks — S
- **Backend:** price sync includes KSE30, KMI30, ALLSHR, BKTI, OGTI. Benchmark endpoint takes `?index=` (default KSE100). Per-stock alpha uses the sector index when one exists (banks vs BKTI).
- **App:** benchmark picker chip on the performance card; "Shariah" toggle uses KMI30.

### 2.5 The screens the data already deserves — M
- "Vs KSE-100" detail screen (headline, three scores, phases sentence, per-stock alpha table) and the "Since bought" chip on the stock screen. Spec in `BENCHMARK_ANALYTICS.md` §8.1.

---

## Phase 3 — Product features

### 3.1 Alerts and push — M
- **Backend:** `alerts` table (symbol, rule: price above / below, % day move, 52-week high, dividend announced). Evaluated at the end of each cron run. `expo-notifications` push tokens stored per user.
- **App:** "Set alert" on the stock screen; notification opens that stock.

### 3.2 News and announcements — S
- Provider `news/SYMBOL`. Show the last five on the stock screen and a feed for held stocks on the Market tab, replacing the removed sectors block.

### 3.3 Tax view — S
- Capital gains tax estimate on realised profit for the fiscal year (15% for filers), and charges split out of `commission` into `taxes_levies`, which is always 0 today.

### 3.4 Intraday — M
- `market?path=/intraday/SYMBOL/1D` for a 1D chip on the stock screen and a live KSE100 line on the Market tab during hours.

### 3.5 Export and sharing — S
- CSV of trades and positions; a shareable image of the performance card.

---

## Order and dependencies

```
0.1 token ──► 1.4 fundamentals ──► 3.2 news
0.2 cron  ──► 1.2 live day change ─► 3.1 alerts
1.1 corporate actions ──► 1.3 cash ledger ──► 2.1 risk / 2.3 attribution
2.4 benchmarks ──► 2.5 screens
```

Start with **0.1, 1.1, 1.2** (all small, all fix things the app already claims to show), then **1.3** (the big one), then **1.4**. Phase 2 is mostly backend maths on data that is already there and can be picked in any order. Phase 3 is polish and only worth it once the numbers are right.

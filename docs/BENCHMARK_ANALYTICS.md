# Portfolio vs KSE100 — Analysis and Endpoint Spec

> A read-only analysis of the real portfolio against the KSE-100 benchmark, run on 2026-09-07 against the live database, followed by the design for a `GET /portfolio/:id/benchmark` endpoint that produces the same numbers for the app.

**Data as of:** 2026-09-04 (last price bar) · **Window:** 2024-07-29 → 2026-09-04 · **525 trading days, 255 trades, 24 symbols**

---

## Table of contents

1. [The plain-English story](#1-the-plain-english-story)
2. [Two things the data revealed](#2-two-things-the-data-revealed)
3. [Full results](#3-full-results)
4. [Three ways to measure — and why they disagree](#4-three-ways-to-measure--and-why-they-disagree)
5. [Caveats](#5-caveats)
6. [Endpoint spec: `GET /portfolio/:id/benchmark`](#6-endpoint-spec-get-portfolioidbenchmark)
   - [Part 1 — the headline](#part-1--the-headline-same-money-into-kse100-instead)
   - [Part 2 — the chart](#part-2--the-chart-two-lines-both-starting-at-100)
   - [Part 3 — the per-stock table](#part-3--the-table-each-stock-vs-the-index-since-you-bought-it)
   - [The split fix everything depends on](#the-split-fix-everything-depends-on)
   - [Response shape](#response-shape)
   - [Code structure](#code-structure)
7. [Reference: the analysis script](#7-reference-the-analysis-script)
8. [Roadmap: screens and corporate actions](#8-roadmap-screens-and-corporate-actions)

---

## 1. The plain-English story

**You put in 4.46 million rupees** over two years (all buys minus all sells).

**Today it is worth 5.08 million.** You made about 620k.

**If you had put the exact same rupees, on the exact same days, into KSE100 instead — you would have 5.45 million.** The index would have made you **371k more** than your own picks did.

### Why you are behind

It is not the recent buys. It is the first year.

| Period | Money in | Your return | KSE100 return |
|---|---|---|---|
| Jul 2024 → Jan 2026 | 25k → 2.0M | +66% | **+135%** |
| Feb 2026 → today | 2.0M → 4.5M | −3.6% | −5.3% |

In 2024–25 the market doubled and the early picks did not keep up. Since February 2026, with most of the money invested, the portfolio has done **slightly better** than the index.

The 371k gap is old damage. The current portfolio is fine.

### Which stocks

| | Stocks | Share of money |
|---|---|---|
| **Helping** | FFC (+14 pts vs index), MLCF (+15 pts) | 45% |
| **Hurting** | SYS (−13 pts), HUBC (−11 pts) | 17% |
| **Tracking the market** | MARI, LCI, AIRLINK | 37% |
| **Tiny Jul-2024 leftovers** | 12 sub-investor names, −72 pts average | 0.9% |

71% of capital is in positions that beat the index since purchase.

**Risk was the same.** Worst peak-to-trough fall: portfolio −23.6%, KSE100 −22.6%. Same risk, less return in 2024–25.

---

## 2. Two things the data revealed

### The price history is split-adjusted

SYS split 5:1 in June 2025. A scan for a price cliff in `daily_prices` found **nothing** — because the analytics API back-adjusts: every pre-split close is already stored ÷5.

Proof — every pre-split SYS trade shows a 5.0× ratio between what was paid and the stored close for that day:

```
trade date   symbol   traded @   stored close   ratio
2024-08-29   SYS         416         82.26      5.06
2024-09-02   SYS         411         81.74      5.03
2024-11-04   SYS         542        108.82      4.98
2025-04-22   SYS         496         99.10      5.00
2025-05-07   SYS         511        101.05      5.06
2024-07-29   BAFL         66.5       26.84      2.48   ← BAFL too, ~2.5:1
```

**Consequence:** any historical valuation must multiply pre-split share counts by the ratio, or the history is wrong. The first analysis run undervalued the SYS holding by ~78k for a year and ended 612 shares short. After the fix, the walk reconciles to the live snapshot within 1,856 PKR (0.04%).

### BAFL split too, and the position table does not know

BAFL is a sub-investor holding, so `GetCollaterals` could not correct it. `positions.quantity` says 33; the price series implies ~66–82 shares. It is 0.04% of the portfolio, so no conclusion changes — but it is the second split the trade-only path missed. That 1,856 PKR reconciliation gap is exactly 33 × 56.24.

---

## 3. Full results

### Snapshot (2026-09-04)

| | PKR |
|---|---|
| Cost basis of open positions | 4,694,225 |
| Market value | 5,081,560 |
| Unrealised P&L | +387,335 (+8.25%) |
| Realised P&L (all sells) | +232,281 |
| **Total P&L** | **+619,616** |
| Net cash put in (buys − sells) | 4,461,910 |

### Headline: same cash, same dates, into KSE100

| | Today | On 4.46M net cash in |
|---|---|---|
| Your portfolio | **5,083,416** | +13.9% |
| KSE100 shadow portfolio | 5,454,803 | +22.3% |
| **Difference** | **−371,387** | behind the index |

### Time-weighted return (deposits removed)

| | Return | Max drawdown |
|---|---|---|
| Portfolio | +60.4% | −23.6% |
| KSE100 | +122.4% | −22.6% |
| Alpha | **−62.1 pts** | |

By phase:

| | Portfolio | KSE100 | Net cash in at end |
|---|---|---|---|
| 2024-07-29 → 2026-02-02 | +66.4% | +134.8% | 1,999,632 |
| 2026-02-02 → 2026-09-04 | −3.6% | −5.3% | 4,461,910 |

### Month by month (both lines start at 100)

| Month end | Portfolio | KSE100 | Gap | Value (PKR) | Net cash in |
|---|---|---|---|---|---|
| 2024-07-31 | 99.5 | 98.8 | +0.7 | 23,213 | 25,672 |
| 2024-08-30 | 100.2 | 99.6 | +0.7 | 213,337 | 232,305 |
| 2024-09-30 | 97.7 | 102.9 | −5.2 | 246,064 | 273,494 |
| 2024-10-31 | 97.5 | 112.9 | −15.3 | 305,573 | 339,461 |
| 2024-11-29 | 103.5 | 128.6 | −25.1 | 372,756 | 388,967 |
| 2024-12-31 | 119.2 | 146.0 | −26.8 | 429,465 | 388,967 |
| 2025-01-31 | 114.1 | 144.9 | −30.8 | 411,013 | 388,967 |
| 2025-02-28 | 110.3 | 143.7 | −33.4 | 397,299 | 388,967 |
| 2025-03-27 | 118.5 | 149.4 | −30.9 | 426,992 | 388,967 |
| 2025-04-30 | 109.4 | 141.2 | −31.8 | 475,669 | 476,244 |
| 2025-05-30 | 117.4 | 151.8 | −34.5 | 630,831 | 588,948 |
| 2025-06-30 | 121.1 | 159.4 | −38.3 | 897,667 | 841,047 |
| 2025-07-31 | 130.6 | 176.8 | −46.3 | 1,184,876 | 1,059,791 |
| 2025-08-29 | 134.2 | 188.5 | −54.4 | 1,369,237 | 1,219,887 |
| 2025-09-30 | 155.4 | 209.9 | −54.6 | 1,727,115 | 1,343,474 |
| 2025-10-31 | 153.1 | 205.0 | −51.9 | 1,709,566 | 1,350,995 |
| 2025-11-28 | 161.5 | 211.4 | −50.0 | 2,076,499 | 1,610,184 |
| 2025-12-31 | 166.2 | 220.8 | −54.6 | 2,357,583 | 1,827,074 |
| 2026-01-30 | 165.9 | 233.6 | −67.8 | 2,522,058 | 1,999,632 |
| 2026-02-27 | 149.7 | 213.2 | −63.5 | 2,730,809 | 2,483,630 |
| 2026-03-31 | 142.8 | 188.7 | −45.9 | 3,260,676 | 3,136,177 |
| 2026-04-30 | 149.3 | 206.8 | −57.5 | 4,336,872 | 4,071,517 |
| 2026-05-29 | 160.8 | 220.7 | −59.9 | 4,700,350 | 4,094,506 |
| 2026-06-30 | 168.0 | 228.7 | −60.7 | 4,928,856 | 4,112,064 |
| 2026-07-31 | 159.7 | 223.4 | −63.7 | 4,947,358 | 4,367,471 |
| 2026-08-31 | 160.1 | 224.5 | −64.5 | 5,074,087 | 4,461,910 |
| 2026-09-04 | 160.4 | 222.4 | −62.1 | 5,083,416 | 4,461,910 |

### Money-weighted return (XIRR, annualised)

| | Per year |
|---|---|
| Your portfolio | +18.6% |
| KSE100 shadow | +29.5% |

### Each open position vs KSE100 since its cost-weighted buy date

| Symbol | Qty | Avg cost | Last | Stock | KSE100 | Alpha | Buy date | Cost basis | Weight |
|---|---|---|---|---|---|---|---|---|---|
| FFC | 2,270 | 499.41 | 548.11 | +9.75% | −3.88% | **+13.63** | 2026-01-05 | 1,133,661 | 24.2% |
| MLCF | 11,407 | 85.66 | 101.46 | +18.45% | +3.44% | **+15.00** | 2026-04-27 | 977,124 | 20.8% |
| MARI | 1,547 | 622.28 | 664.49 | +6.78% | +6.52% | +0.26 | 2025-10-23 | 962,667 | 20.5% |
| SYS | 4,360 | 129.83 | 126.98 | −2.20% | +10.64% | **−12.84** | 2025-10-29 | 566,059 | 12.1% |
| LCI | 2,415 | 223.73 | 217.10 | −2.96% | −2.87% | −0.10 | 2026-08-17 | 540,308 | 11.5% |
| HUBC | 1,388 | 171.86 | 207.44 | +20.70% | +31.46% | **−10.76** | 2025-07-07 | 238,542 | 5.1% |
| AIRLINK | 1,750 | 133.95 | 132.64 | −0.98% | −0.99% | +0.01 | 2026-08-04 | 234,412 | 5.0% |
| *12 sub-investor names* | | | | | | *−71.7 avg* | Jul 2024 | | 0.9% |

Cost-weighted alpha across open positions: **+3.70 pts**. Positions beating the index: 5 of 19, representing **71% of capital**.

---

## 4. Three ways to measure — and why they disagree

| Lens | You | KSE100 | Reads as |
|---|---|---|---|
| Time-weighted, full window | +60.4% | +122.4% | −62 pts — terrible |
| Money-weighted, per year (XIRR) | +18.6% | +29.5% | −11 pts/yr — bad |
| Open positions since purchase | | | **+3.7 pts — good** |

All three are correct. They answer different questions:

- **Time-weighted** treats every period equally regardless of how much money was in it. The 2024–25 lag (small capital, market doubled) dominates.
- **Money-weighted** weights by capital. Most capital arrived in 2026, when the portfolio tracked the index, so the gap is smaller.
- **Open positions since purchase** only sees stocks held today from their own buy dates — mostly 2026 — so it barely sees 2024–25 at all.

The phase split in section 3 is what reconciles them: *behind badly in 2024–25, tracking or slightly ahead since.*

---

## 5. Caveats

- **Dividends are excluded on both sides.** FFC, HUBC and MARI are heavy dividend payers; KSE100 is a price index (no dividends). The true gap is somewhat smaller than −371k. Closing this needs dividend records the backend does not have yet.
- **The shadow portfolio buys the index for free.** A real KSE100 ETF has fees; your cost basis includes commission. This slightly flatters the index.
- **Sub-investor holdings are split-blind.** `GetCollaterals` cannot correct them. Two splits found already (SYS, BAFL); more may exist. Total exposure is under 1% of capital.
- **Trade dates carry no time of day**, so a buy and the market's move on the same day are treated as simultaneous.

---

## 6. Endpoint spec: `GET /portfolio/:id/benchmark`

Computes everything above on read, from `trades` and `daily_prices`. The full daily walk — 525 days × 24 symbols — runs in well under a second, so no new table is needed. Cache later if it ever feels slow.

### Part 1 — the headline: same money into KSE100 instead

**The question:** every rupee that went into a stock, on the day it went in — what if it had bought KSE100 instead?

Think of KSE100 as a fund with units. Walk every trade in date order:

- **BUY** → rupees spent ÷ KSE100 level *that day* = index units bought. Add them.
- **SELL** → rupees received ÷ that day's KSE100 = units redeemed. Subtract them.
- **End** → units held × *today's* KSE100 = shadow value.

Illustrative (round numbers):

```
2024-07-29  BUY  BAFL for 2,198 PKR   KSE100 = 80,000   → +0.0275 units
2025-07-09  SELL ILP  for    71 PKR   KSE100 = 130,000  → −0.0005 units
…
today                                  KSE100 = 176,467  → units × 176,467 = shadow value
```

Actual portfolio value today is `Σ quantity × lastPrice` — the same number `positionsList` already computes.

Why this is the fairest single number: it uses **your** dates. Deposits cannot distort it.

### Part 2 — the chart: two lines, both starting at 100

**The problem:** a plot of portfolio *value* goes 25k → 5M, but almost all of that is money added, not stocks rising. It cannot be compared to an index.

**The fix:** each day, ask only *"how much did the things I already owned change in value today?"* — ignoring money added that day — and chain those daily changes.

```
for each trading day d, from the first trade to today:
  1. value YESTERDAY's holdings at TODAY's prices      → V_pre
  2. daily change = V_pre / V_post_yesterday             (e.g. 1.02)
  3. line = line × daily change                          (starts at 100)
  4. NOW apply today's trades to the holdings
  5. value today's holdings at today's prices          → V_post (used tomorrow)
```

Worked example:

```
Day 1  you hold stocks worth 100,000                        line = 100
Day 2  same stocks now worth 102,000   → ×1.02              line = 102
       you also BUY 50,000 more today  (ignored by the line)
Day 3  all holdings were 152,000, now 155,040 → ×1.02       line = 104.04
```

The 50,000 deposit never touched the line.

The KSE100 line: `KSE100(day) / KSE100(first day) × 100`.

Return one point per month-end (or per day). Where the gap opens on the chart is *when* you fell behind.

Edge cases:
- Before the first trade `V_post_yesterday` is 0 → skip the ratio; start chaining the day after.
- A symbol with no bar on a given day → carry the last known close forward.
- Trading calendar = the union of KSE100 bar dates and trade dates.

### Part 3 — the table: each stock vs the index since you bought it

For every stock currently held:

| Field | How |
|---|---|
| `stockReturn` | `(lastPrice − avgCost) / avgCost × 100` |
| `buyDate` | **cost-weighted average** of the buy dates — big buys pull it more than small ones. If it lands on a non-trading day, move forward to the next bar. |
| `benchmarkReturn` | `(KSE100 today − KSE100 on buyDate) / KSE100 on buyDate × 100` |
| `alpha` | `stockReturn − benchmarkReturn` — positive means you beat the index on this one |

Real example, FFC: avg cost 499.41 → 548.11 = **+9.75%**; buy date 2026-01-05; KSE100 over that window **−3.88%**; alpha **+13.63**.

Deposits do not distort this either — each stock is measured from its own start.

Sort by `costBasis` descending so the stocks that matter are on top.

### The split fix everything depends on

The price history is stored **already divided** for past splits (section 2). SYS:

```
2025-05-07  you paid 511/share       stored close that day = 101.05
```

Valuing 153 shares at 101 gives 15,600 instead of 78,000 — wrong by 5× until the split, and 612 shares short after it.

**Detection** — one loop over trades: if `tradePrice / storedClose` on the trade's date is far from 1 (threshold 1.6), the series is adjusted around that trade. Round the ratio → that is the split.

**Fix** — every trade of that symbol on or before the last such date counts `quantity × ratio` when valuing holdings. Cash flows stay as recorded (you really did pay 511).

This is what turned "no splits detected" into a walk that matches the snapshot to within 0.04%.

### Response shape

```json
{
  "message": "success",
  "data": {
    "asOf": "2026-09-04",
    "window": { "from": "2024-07-29", "to": "2026-09-04", "tradingDays": 525 },

    "headline": {
      "netCashIn":  4461910,
      "portfolio":  5083416,
      "benchmark":  5454803,
      "difference": -371387,
      "portfolioReturnOnCash": 13.93,
      "benchmarkReturnOnCash": 22.25
    },

    "timeWeighted": {
      "portfolio": 60.36, "benchmark": 122.42, "alpha": -62.06,
      "maxDrawdown": { "portfolio": -23.62, "benchmark": -22.57 }
    },

    "moneyWeighted": { "portfolioXirr": 18.60, "benchmarkXirr": 29.52 },

    "phases": [
      { "from": "2024-07-29", "to": "2026-02-02", "portfolio": 66.41, "benchmark": 134.76, "netCashInAtEnd": 1999632 },
      { "from": "2026-02-02", "to": "2026-09-04", "portfolio": -3.64, "benchmark": -5.26, "netCashInAtEnd": 4461910 }
    ],

    "series": [
      { "date": "2024-07-31", "portfolio": 99.5,  "benchmark": 98.8,  "value": 23213,   "netCashIn": 25672 },
      { "date": "2026-09-04", "portfolio": 160.4, "benchmark": 222.4, "value": 5083416, "netCashIn": 4461910 }
    ],

    "positions": [
      { "symbol": "FFC", "quantity": 2270, "avgCost": 499.41, "lastPrice": 548.11,
        "buyDate": "2026-01-05", "stockReturn": 9.75, "benchmarkReturn": -3.88,
        "alpha": 13.63, "costBasis": 1133661, "weight": 24.2 }
    ],

    "dataNotes": {
      "adjustedSplits": [ { "symbol": "SYS", "ratio": 5, "lastPreSplitTrade": "2025-05-07" } ],
      "dividendsIncluded": false
    }
  }
}
```

The `phases` block is the sentence that explains the whole chart — *"behind in 2024–25, tracking since"* — so it belongs in the JSON as text, not left for the client to derive.

### Code structure

**`src/utils/benchmark.js`** — pure functions, no DB, so they can be tested on a saved set of trades:

```js
detectAdjustedSplits(trades, prices)
  → { SYS: { ratio: 5, lastPreDate: "2025-05-07" } }

walkPortfolio(trades, prices, splits)
  → { series, netCashIn, portfolioValue, shadowValue, twr, maxDrawdown }

xirr(flows)
  → annualised rate  (bisection is fine)

positionsVsBenchmark(positions, trades, prices)
  → the per-stock table
```

**`src/controllers/portfolioController.js`** — `benchmark` handler:

1. Load the portfolio (scoped to `req.user.id`), its trades ordered by `executedAt, id`, and every `daily_prices` row for the traded symbols plus `KSE100`.
2. Convert Prisma `Decimal`s to numbers once.
3. Call the four functions; compute `phases` by reading the series at the cut date.
4. Respond.

**`src/routes/portfolioRoutes.js`** — `router.get("/:id/benchmark", benchmark)`.

**Later:** a `CorporateAction` table — not for the walk (adjusted prices already handle valuation) but to correct `positions.quantity` for sub-investor holdings like BAFL that `GetCollaterals` cannot fix.

---

## 7. Reference: the analysis script

The numbers in this document came from a read-only script run against the live database. Its logic is exactly the spec in section 6 — it is the reference implementation the endpoint should reproduce.

```js
// load trades (ordered), all daily_prices for traded symbols + KSE100
// build trading calendar = union(KSE100 bar dates, trade dates) from first trade
// forward-fill prices per symbol over the calendar

// --- split detection (adjusted series) ---
for each trade: r = trade.price / storedClose(trade.date)
  if r > 1.6: adj[symbol] = { ratio: round(r), lastPreDate: max(trade.date) }
qEff(trade) = adj[sym] && trade.date <= lastPreDate ? qty × ratio : qty

// --- daily walk ---
held = {}, prevV = 0, chain = 1, netIn = 0, units = 0
for d in calendar:
  Vpre = Σ held[s] × price(s, d)
  if prevV > 0: chain ×= Vpre / prevV
  for t in trades on d:
    flow = BUY ? qty×price+commission : −(qty×price−commission)
    netIn += flow;  units += flow / KSE100(d)
    held[t.sym] += BUY ? qEff(t) : −qty
  V = Σ held[s] × price(s, d);  prevV = V
  series.push({ d, V, netIn, twr: chain×100, kseIdx: KSE100(d)/KSE100(first)×100, shadow: units×KSE100(d) })

// --- XIRR: bisection on Σ flow / (1+r)^years, flows = trades ± , terminal = +value ---
// --- per position: cost-weighted buy date; stock vs KSE100 over that window ---
```

Verification used: the walk's final value must equal `Σ position.quantity × lastPrice` from the snapshot (it did, within the BAFL split residual), and the cost-weighted per-position alpha must reconcile with the phase split.

---

## 8. Roadmap: screens and corporate actions

Written 2026-09-08, after the endpoint shipped and the app's Portfolio chart was switched to it. Two things remain: the response carries more than the app shows, and two holdings are wrong in the database for a reason no sync can fix.

### 8.1 Screens (app: Crest-Analyst)

No new tab. One pushed screen, one chip, one badge. All of it reads the cached benchmark response — no new requests.

**"Vs KSE-100" detail screen** — `src/app/portfolio/benchmark.tsx`, opened by tapping the performance card on the Portfolio tab. Stack layout copied from `src/app/stock/_layout.tsx`. Top to bottom:

| Block | Source | Shows |
|---|---|---|
| Headline card | `headline` | "Your holdings Rs 50.8 lakh · same cash in KSE100 Rs 54.5 lakh · difference Rs −3.7 lakh" |
| Three scores | `timeWeighted`, `moneyWeighted` | TWR 60% vs 122% · XIRR 18.6% vs 29.5% · max drawdown −23.6% vs −22.6%, one plain line under each |
| Story sentence | `phases` | "Behind from Jul 2024 to Feb 2026, keeping pace since." |
| Per-stock table | `positions` | symbol · held since · your return · KSE100 same window · alpha, sorted by weight; tap → stock screen with "Since bought" preselected |

**"Since bought" chip on the stock screen** — shown only when the symbol is in `positions`. Slices the 5Y trend at the row's `buyDate` and rebases (the same trick the portfolio chart uses). Stats gain "Your avg cost" and "Alpha since bought". Watchlist-only stocks are unchanged.

**Stale badge on holdings rows** — the positions endpoint already returns `priceAsOf`. Older than 7 days → grey "price from 3 Jan 2025", no sparkline. This is the immediate fix for ENGRO and needs no backend work.

The Market tab stays the "market view" (each held stock's *price* vs the index, nothing about the position). Its two small bugs: the holdings request has no range so the window is a year, not the 30 days the comment claims (label reads "248d high"); and a stock with no bars shows "+0.0%" instead of being flagged.

### 8.2 Corporate actions (backend)

**Why the data is wrong.** `GetCollaterals` only sees the broker-linked CDC account. Holdings in the sub-investor account keep their trade-derived figures forever (see `mergePositions`). ENGRO and BAFL both live there, and both have had corporate actions the app cannot learn about:

| Symbol | Event | Effective | Reality | In the database |
|---|---|---|---|---|
| ENGRO | Delisted; each share swapped for **2.24407865 ENGROH** | 2025-01-14 | 17 ENGROH + cash for the fraction | 8 ENGRO, priced at 2025-01-03 |
| BAFL | **2-for-1** split (face value Rs 10 → Rs 5) | 2026-04-20 | 66 shares | 33 shares |

**The fix: a `corporate_actions` table filled in by hand.** Personal app, a few rows a year — a manual record beats any detection.

```
corporate_actions
  id             uuid
  security_id    uuid        -- the symbol the event happened to
  type           varchar     -- SPLIT | BONUS | MERGER | DELIST | DIVIDEND (later)
  to_security_id uuid?       -- MERGER only: the new symbol
  ratio          decimal     -- new shares per old share (SPLIT 2, MERGER 2.24407865)
  effective_date date
  note           text?
```

Records needed today:

| type | symbol | toSymbol | ratio | effectiveDate |
|---|---|---|---|---|
| SPLIT | BAFL | — | 2 | 2026-04-20 |
| MERGER | ENGRO | ENGROH | 2.24407865 | 2025-01-14 |

**Three consumers:**

1. **Position rebuild after sync** (`getHistory`). SPLIT/BONUS: for trade-derived positions (source `trades`), quantity × ratio, avgCost ÷ ratio. MERGER: move the position to `toSecurityId` with `floor(quantity × ratio)`, set the old security's existing `listingStatus` to `delisted`. Collateral-sourced positions are left alone — the broker already adjusted them.
2. **Price sync.** Nothing to add: once ENGROH is a held position it is fetched like any other.
3. **Benchmark walk** (`walkPortfolio`). Apply the records instead of guessing: `detectAdjustedSplits` becomes a *warning* ("price jump with no corporate action on 2025-05-07 for SYS") rather than a silent decision. MERGER: value the old symbol at its own price up to the effective date, then `toSymbol × ratio` after.

**Order of work:** stale badge (ten minutes, stops ENGRO lying) → table + position rebuild (numbers become right) → the two screens (numbers become visible) → DIVIDEND type in the same table (total return, the last thing the analysis is missing).

Sources: [PSX delisting of Engro Corporation, effective 14 Jan 2025](https://profit.pakistantoday.com.pk/2025/01/14/psx-announces-delisting-of-engro-corporation-effective-january-14/) · [Engro scheme of arrangement timelines (swap ratio)](https://www.marketscreener.com/quote/stock/ENGRO-CORPORATION-LIMITED-6492705/news/Engro-INDICATIVE-TIMELINES-FOR-IMPLEMENTATION-OF-THE-SCHEME-OF-ARRANGEMENT-OF-DAWOOD-HERCULES-CORP-48567255/) · [Bank Alfalah 2-for-1 stock split](https://www.bankalfalah.com/news-room/annual-results-for-2025-and-2-for-1-stock-split/) · [BAFL share count doubles after Rs 10 → Rs 5 split](https://mettisglobal.news/Bank-Alfalah-Limited-share-count-to-double-after-Rs10-to-Rs5-Split-59605)

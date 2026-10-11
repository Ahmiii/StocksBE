# Stock Portfolio Backend — Full Documentation

> One document that explains **what this backend does, how it is built, how the database is shaped, and how to call every API**.
> Written in simple English so a new developer or a frontend developer can read it without opening the code.

**Project:** `stock_portfolio_be` · **Author:** Ahmed Faraz · **Last updated:** 2026-10-11

---

## Table of contents

1. [What this project does](#1-what-this-project-does)
2. [Tech stack](#2-tech-stack)
3. [How to run it](#3-how-to-run-it)
4. [Environment variables](#4-environment-variables)
5. [Project structure](#5-project-structure)
6. [Backend architecture](#6-backend-architecture)
7. [Database design (ERD)](#7-database-design-erd)
8. [Authentication](#8-authentication)
9. [API reference](#9-api-reference)
   - [Auth](#91-auth)
   - [Broker accounts](#92-broker-accounts)
   - [Portfolio](#93-portfolio)
   - [Market data](#94-market-data)
   - [Watchlist](#95-watchlist)
10. [How the broker integration works](#10-how-the-broker-integration-works)
11. [How positions are calculated](#11-how-positions-are-calculated)
12. [In-memory sessions](#12-in-memory-sessions)
13. [Response and error conventions](#13-response-and-error-conventions)
14. [Known limitations and things to fix](#14-known-limitations-and-things-to-fix)
15. [Glossary](#15-glossary)

---

## 1. What this project does

This is the backend (server) for a **stock portfolio tracker for the Pakistan Stock Exchange (PSX)**.

In plain words, it lets a user:

1. **Create an account and log in** (email + password).
2. **Link their broker account** at Arif Habib Limited (AHL eTrade). The backend logs in to the broker website on the user's behalf.
3. **Sync trade history** from the broker. Every buy and sell the user ever made is downloaded and saved.
4. **See their portfolio**: which stocks they hold, how many shares, average cost, current price, profit/loss.
5. **Download daily prices** (5 years of history) for every stock they own, plus the KSE-100 index, so charts and P&L can be shown.
6. **Follow a watchlist and compare against the index**: the whole portfolio against KSE-100 with a time-weighted chart, XIRR and per-stock alpha.
7. **See dividends, corporate actions, financial statements and a valuation**: what each stock paid and when, the company's statements from the analytics API, and a reverse DCF that says what yearly growth the current price assumes.

The broker does not offer a public API. The backend talks to the broker's website the same way a browser would (it sends the same headers and cookies). This is the trickiest part of the project and is explained in [section 10](#10-how-the-broker-integration-works).

---

## 2. Tech stack

| Layer | Technology | Version | Why it is used |
|---|---|---|---|
| Runtime | Node.js (ES Modules) | 24.x | Runs the JavaScript. Node 24 is needed because the generated Prisma client is a `.ts` file that Node loads natively, and `Object.groupBy` is used. |
| Web framework | Express | 5.2 | Handles HTTP routes. Express 5 automatically catches errors thrown inside `async` route handlers. |
| Database | PostgreSQL | — | Stores users, accounts, trades, positions, prices. |
| ORM | Prisma | 7.10 | Talks to PostgreSQL with type-safe queries. Uses the `prisma-client` generator and the `@prisma/adapter-pg` driver adapter. |
| DB driver | `pg` | 8.x | The raw PostgreSQL driver that the Prisma adapter wraps. |
| Auth | `jsonwebtoken` + `bcryptjs` | 9.x / 3.x | JWT tokens for login sessions; bcrypt for hashing passwords. |
| HTTP client | `axios` | 1.x | Makes requests to the broker website and the market-data API. |
| Config | `dotenv` | 17.x | Loads `.env` into `process.env`. |
| Dev tool | `nodemon` | 3.x | Restarts the server when a file changes. |

There is **no** test framework, CORS, rate limiting, request logging, or validation library in the project today.

---

## 3. How to run it

### Requirements

- Node.js **24 or newer**
- A running PostgreSQL database
- Access to the broker website (AHL eTrade) and the Arif Habib analytics dashboard from the server

### Steps

```bash
# 1. Install packages
npm install

# 2. Create the .env file (see section 4 for the list of variables)
cp .env.example .env   # (there is no example file yet — create .env by hand)

# 3. Generate the Prisma client
#    The generated folder src/generated/prisma is git-ignored, so this must run after every fresh clone.
npx prisma generate

# 4. Create the database tables
npx prisma migrate deploy       # production
# or
npx prisma migrate dev          # development

# 5. Start the server (restarts on file change)
npm run dev
```

The server prints `Server is running on 5001` (or whatever `PORT` is set to).

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts `src/server.js` with nodemon. |
| `npm run contract:emit` | Runs `prisma contract emit`. |
| `npx prisma studio` | Opens a browser UI to look at the database. |

> The Prisma config file is named `prisma7.config.ts`. The Prisma CLI finds it automatically (`Loaded Prisma config from prisma7.config.ts`).

---

## 4. Environment variables

All variables live in `.env` (which is git-ignored — never commit it).

| Variable | Required | Default | What it is |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://localhost:5432/stock_portfolio` | PostgreSQL connection string. |
| `JWT_SECRET` | Yes | — | Secret key used to sign and verify login tokens. Keep it long and random. |
| `JWR_EXPIRES_IN` | No | `7d` | How long a login token is valid. The name has a typo (`JWR` not `JWT`) but the code reads it exactly like this, so keep the typo. |
| `BROKER_URL` | Yes | — | Base URL of the broker website, e.g. `https://web.ahletrade.com`. |
| `BROKER_HOUSE_NAME` | No | `AHL` | Value of the `HouseName` cookie the broker expects. |
| `DASHBOARD_URL` | Yes (for market sync) | — | Base URL of the Arif Habib analytics API used for daily prices. |
| `CREDENTIALS_KEY` | No (needed for the nightly sync) | — | 64 hex characters (32 bytes). Encrypts the broker password stored on link so the nightly sync can log in unattended. Without it nothing is stored and the job is off. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `DASHBOARD_COOKIE` | No | — | Manual fallback: a `laravel_session` cookie copied from a browser. Used only when there is no live broker session. Handy for backfilling prices outside trading hours. |
| `PORT` | No | `5001` | Port the server listens on. |
| `NODE_ENV` | No | — | If set to anything, the `jwt` cookie is marked `secure`. |

---

## 5. Project structure

```
Backend/
├── prisma/
│   ├── schema.prisma            # Database models (source of truth for tables)
│   └── migrations/              # SQL migration history (12 migrations)
├── prisma7.config.ts            # Prisma 7 config: schema path, migrations path, DB URL
├── src/
│   ├── server.js                # Entry point: creates Express app, mounts routes, handles shutdown
│   ├── config/
│   │   ├── db.js                # Creates the Prisma client (with pg adapter); connect/disconnect helpers
│   │   └── constants.js         # Broker URLs, paths, browser headers, status values, nightly-sync window, reverse-DCF assumptions
│   ├── middlewares/
│   │   └── authMiddleware.js    # Checks the Bearer JWT and loads req.user
│   ├── routes/
│   │   ├── authRoutes.js        # /auth/*
│   │   ├── brokerAccountRoutes.js # /broker/*
│   │   ├── portfolioRoutes.js   # /portfolio/*
│   │   ├── marketRoutes.js      # /market/*
│   │   └── watchlistRoutes.js   # /watchlist/*
│   ├── controllers/
│   │   ├── authController.js    # register, login
│   │   ├── brokerAccountController.js # link broker, list, disconnect, sync trades
│   │   ├── portfolioController.js # portfolio list, positions, trades, benchmark vs KSE100, dividend income
│   │   ├── marketDataController.js # price sync, securities import + search, trend chart (provider calls live in services/dashboardApi.js)
│   │   ├── corporateActionController.js # payouts from the provider (dividends, bonus, rights) → corporate_actions, one stock or every held + watched stock
│   │   ├── fundamentalsController.js # the provider's four company statements (fundamentals, income, balance, cashflow) → fundamentals, one stock or every held + watched stock
│   │   ├── valuationController.js # reverse DCF: the growth the current price assumes, computed from the stored statements
│   │   └── watchlistController.js # watchlist list / add / remove
│   ├── services/
│   │   ├── brokderSessionStore.js # In-memory store for broker + market cookies
│   │   └── dashboardApi.js      # Talking to the Arif Habib dashboard: handoff, token, price feed, token endpoints
│   ├── utils/
│   │   ├── extractAHLInfor.js   # Parses broker HTML/cookies, builds login form body
│   │   ├── tradeData.js         # Normalises trades, calculates/merges/reconciles positions
│   │   ├── dateRange.js         # Parses ?from=&to= (shared by positions and price history)
│   │   ├── benchmark.js         # Split detection, daily walk (TWR + KSE100 shadow), XIRR, per-stock alpha
│   │   ├── dividendIncon.js     # Shares held on a date; dividends you were entitled to (section 11.3, endpoint 22)
│   │   ├── pace.js              # Random pauses between provider calls, stop on 429 / 5xx (section 10.8)
│   │   ├── secrets.js           # AES-256-GCM encrypt / decrypt for the stored broker password
│   │   ├── generateToken.js     # Signs the JWT and sets a cookie
│   │   └── valuation.js         # Reverse DCF maths: periods by year, share count, starting cash, implied growth (section 9.4, endpoint 26)
│   ├── jobs/
│   │   └── dailySync.js         # Nightly sync: weekdays at a random time 18:00–23:00 Karachi, catch-up after a restart (section 10.6)
│   └── generated/prisma/        # Generated Prisma client (git-ignored)
├── package.json
└── .env                         # Secrets (git-ignored)
```

---

## 6. Backend architecture

### 6.1 Layers

The code follows a simple **route → middleware → controller → database** pattern. There is no separate "service layer" for business logic; the controllers do the work and call small helper functions from `utils/`.

```mermaid
flowchart LR
    Client["Client<br/>(web / mobile app)"]
    subgraph Server["Express server (src/server.js)"]
        direction TB
        JSON["express.json()"]
        Routes["Routes<br/>/auth · /broker · /portfolio · /market"]
        Auth["authMiddleware<br/>(verify JWT, load user)"]
        Ctrl["Controllers<br/>auth · brokerAccount · portfolio · marketData"]
        Utils["Utils<br/>extractAHLInfor · tradeData · generateToken"]
        Store["brokerSessionStore<br/>(in-memory Map)"]
        JSON --> Routes --> Auth --> Ctrl
        Ctrl --> Utils
        Ctrl --> Store
    end
    Prisma["Prisma Client<br/>(pg adapter)"]
    DB[("PostgreSQL")]
    Broker["AHL eTrade website<br/>(login, order history, collaterals)"]
    Dashboard["Arif Habib analytics API<br/>(daily prices)"]

    Client -- "HTTP + Bearer token" --> JSON
    Ctrl --> Prisma --> DB
    Ctrl -- "axios, browser-like headers" --> Broker
    Ctrl -- "axios, laravel_session cookie" --> Dashboard
```

### 6.2 What happens on every request

1. `express.json()` parses the JSON body.
2. The path is matched to one of four routers: `/auth`, `/broker`, `/portfolio`, `/market`.
3. For every router except `/auth`, `authMiddleware` runs first:
   - reads `Authorization: Bearer <token>`,
   - verifies the token with `JWT_SECRET`,
   - loads the user from the database (`id`, `email`, `fullName` — never the password hash),
   - puts it on `req.user`. If anything fails → `401`.
4. The controller runs. It reads from / writes to PostgreSQL through Prisma, and if needed calls the broker or market API through axios.
5. The controller sends a JSON response.

### 6.3 Start-up and shutdown

- On start: `connectDB()` opens the Prisma connection. If it fails the process exits with code 1.
- On `SIGINT` / `SIGTERM` (Ctrl-C, container stop): the HTTP server stops accepting connections, Prisma disconnects, then the process exits with 0.
- On an `unhandledRejection`: same shutdown, but exit code 1.

### 6.4 External systems

| System | Used for | How we authenticate |
|---|---|---|
| **AHL eTrade website** (`BROKER_URL`) | Login, order history (`/Home/GetOrderHisotry`), current holdings (`/Home/GetCollaterals`), analytics hand-off URL (`/Home/GetAnalyticsURL`) | ASP.NET session cookie (`.AspNetCore.Session`) obtained by logging in with the user's broker account number + password. |
| **Arif Habib analytics API** (`DASHBOARD_URL`) | Daily OHLCV price bars (`/market?path=/daily/SYMBOL`) | `laravel_session` cookie, obtained by following the analytics hand-off URL from the broker. |

> Note the broker endpoint really is spelled `GetOrderHisotry` (their typo). "Fixing" the spelling returns a 404.

---

## 7. Database design (ERD)

There are **9 tables**. UUIDs are used as primary keys everywhere except `daily_prices` (which uses a big auto-increment integer because it gets many rows). All money and quantity columns are `DECIMAL(18,4)` so there are no floating-point rounding problems.

### 7.1 Entity-relationship diagram

```mermaid
erDiagram
    users ||--o{ broker_accounts : "owns"
    users ||--o{ portfolios : "owns"
    broker_accounts ||--o| portfolios : "has one"
    broker_accounts ||--o{ trades : "source of"
    portfolios ||--o{ trades : "contains"
    portfolios ||--o{ positions : "holds"
    securities ||--o{ trades : "traded"
    securities ||--o{ positions : "held"
    securities ||--o{ daily_prices : "priced"
    users ||--o{ watchlist_items : "watches"
    securities ||--o{ watchlist_items : "watched"
    securities ||--o{ corporate_actions : "happened to"
    securities ||--o{ corporate_actions : "merged into"
    securities ||--o{ fundamentals : "reported by"

    users {
        uuid id PK
        varchar(255) email UK
        varchar(255) password_hash
        varchar(120) full_name
        timestamptz created_at
    }

    broker_accounts {
        uuid id PK
        uuid user_id FK
        varchar(32) broker "default AHL_ETRADE"
        varchar(64) client_code "broker account number"
        text credentials_enc "encrypted broker password, nullable"
        timestamptz token_expires_at "nullable, unused today"
        varchar(16) sync_status "idle | syncing | error | disconnected"
        varchar(255) sync_cursor "last 'to' date synced"
        timestamptz last_synced_at
        timestamptz created_at
    }

    portfolios {
        uuid id PK
        uuid user_id FK
        uuid broker_account_id FK "unique, nullable"
        varchar(120) name
        char(3) base_currency "default PKR"
        timestamptz created_at
    }

    securities {
        uuid id PK
        varchar(16) symbol UK
        varchar(12) isin UK "nullable"
        varchar(255) company_name
        varchar(120) sector "nullable"
        varchar(16) listing_status "default listed"
        timestamptz updated_at
    }

    trades {
        uuid id PK
        uuid portfolio_id FK
        uuid security_id FK
        uuid broker_account_id FK "nullable"
        varchar(64) broker_trade_id "nullable"
        varchar(64) broker_order_id "nullable, unused"
        varchar(4) side "BUY | SELL"
        decimal quantity
        decimal price
        decimal commission
        decimal taxes_levies
        decimal net_amount
        timestamptz executed_at
        varchar(16) source "default broker_sync"
        jsonb raw_payload "original broker row"
        timestamptz created_at
    }

    positions {
        uuid id PK
        uuid portfolio_id FK
        uuid security_id FK
        decimal quantity
        decimal avg_cost
        decimal realized_pnl
        timestamptz as_of
    }

    daily_prices {
        bigint id PK
        uuid security_id FK
        date trade_date
        decimal open "nullable"
        decimal high "nullable"
        decimal low "nullable"
        decimal close
        bigint volume "nullable"
        timestamptz fetched_at
    }

    watchlist_items {
        uuid id PK
        uuid user_id FK
        uuid security_id FK
        timestamptz created_at
    }

    corporate_actions {
        uuid id PK
        uuid security_id FK
        varchar(32) type "DIVIDEND | BONUS_SHARE | RIGHT_SHARE | SPLIT | MERGER"
        date ex_date
        decimal amount "nullable: Rs per share, or the right price"
        decimal ratio "nullable: new shares per old"
        uuid to_security_id FK "nullable, MERGER only"
        varchar(16) source "payouts | manual"
        varchar(32) provider_id "nullable"
        timestamptz created_at
    }

    fundamentals {
        uuid id PK
        uuid security_id FK
        varchar(16) statement "fundamentals | income | balance | cashflow"
        varchar(16) interval "annual"
        jsonb payload "the provider's answer, saved whole"
        timestamptz provider_at "nullable"
        timestamptz fetched_at
    }
```

### 7.2 Relationships in words

| From | To | Type | Meaning |
|---|---|---|---|
| `users` | `broker_accounts` | 1 → many | A user can link several broker accounts. |
| `users` | `portfolios` | 1 → many | A user can have several portfolios. |
| `broker_accounts` | `portfolios` | 1 → 0..1 | Each linked broker account gets exactly one portfolio (enforced by a unique index on `broker_account_id`). Prisma still exposes it as `portfolios[]` on the account, so API responses show an array with one item. |
| `broker_accounts` | `trades` | 1 → many | Which broker account a trade was imported from. `ON DELETE RESTRICT` — you cannot delete an account that still has trades. |
| `portfolios` | `trades` | 1 → many | All trades belong to a portfolio. |
| `portfolios` | `positions` | 1 → many | One position row per stock held in the portfolio. |
| `securities` | `trades` / `positions` / `daily_prices` | 1 → many | A security (stock or index) is shared by everyone; it is not per-user. |
| `users` / `securities` | `watchlist_items` | many ↔ many | A user's watchlist is a set of securities. The link row is per-user; the security itself is shared. |
| `securities` | `fundamentals` | 1 → many | Up to four rows per stock, one per statement (fundamentals, income, balance, cashflow). Shared data, not per-user. |

### 7.3 Unique constraints and indexes

These matter because the sync code relies on them for "upsert" (insert-or-update) behaviour.

| Table | Unique constraint | Purpose |
|---|---|---|
| `users` | `email` | One account per email. |
| `broker_accounts` | `(user_id, broker, client_code)` | The same user cannot link the same broker account twice. Used by `POST /broker/accounts` to upsert. |
| `portfolios` | `broker_account_id` | One portfolio per broker account. Used to upsert the portfolio when linking. |
| `securities` | `symbol`, `isin` | One row per stock symbol. Used to upsert securities during sync. |
| `trades` | `(broker_account_id, broker_trade_id)` | Prevents importing the same trade twice. Used to upsert trades during sync. |
| `positions` | `(portfolio_id, security_id)` | One position per stock per portfolio. Used to upsert positions. |
| `daily_prices` | `(security_id, trade_date)` | One price bar per stock per day. Lets `createMany({ skipDuplicates })` re-run safely. |
| `watchlist_items` | `(user_id, security_id)` | A stock is on a user's watchlist at most once. `POST /watchlist/:securityId` upserts against it, so adding twice is a no-op. |
| `fundamentals` | `(security_id, statement)` | One saved answer per stock per statement. The statements sync upserts against it, so a refresh replaces the payload instead of adding a row. |

| Table | Index | Purpose |
|---|---|---|
| `broker_accounts` | `user_id` | Fast "list my accounts". |
| `portfolios` | `user_id` | Fast "list my portfolios". |
| `trades` | `(portfolio_id, executed_at DESC)` | Fast paginated trade list, newest first. |
| `trades` | `security_id` | Fast lookup by stock. |
| `positions` | `security_id` | Fast lookup by stock. |
| `watchlist_items` | `user_id` | Fast "my watchlist". |

### 7.4 Table-by-table details

**`users`** — one row per registered person. `password_hash` is a bcrypt hash (10 salt rounds). The plain password is never stored and never returned by any API.

**`broker_accounts`** — a link between a user and one account at a broker. `client_code` is the broker account number the user types in (e.g. `CC12345`). `sync_status` is `idle` normally, `syncing` while the nightly job or a full-sync runs, `error` when that failed, and `disconnected` after the user unlinks. `credentials_enc` holds the broker password encrypted with AES-256-GCM (`src/utils/secrets.js`, key from `CREDENTIALS_KEY`) so the nightly sync can log in unattended; it stays `null` when the key is not set, and such accounts are skipped by the job. `token_expires_at` is never written. Broker cookies are never stored in the database (see [section 12](#12-in-memory-sessions)).

**`portfolios`** — a bucket of trades and positions. Today a portfolio is always created automatically when a broker account is linked, and is named `AHL <client_code>`. `base_currency` is always `PKR`.

**`securities`** — the master list of stocks and indexes (e.g. `FFC`, `OGDC`, `KSE100`). Filled two ways: the trade sync creates a row on-the-fly for any symbol it meets (with `company_name` = symbol as a placeholder), and `POST /market/securities/:id` imports the broker's full approved list (~557 rows) with real company names and sectors, overwriting those placeholders. `isin` is never filled. Only a small subset (held, watched, `KSE100`) ever gets prices; the rest exist so the watchlist search has something to find.

**`trades`** — every executed buy or sell. `raw_payload` keeps the exact JSON row the broker sent, so nothing is lost if the parsing logic changes later. `broker_trade_id` is a generated fingerprint (see [section 10.3](#103-how-trades-get-a-stable-id)). `source` is always `broker_sync` today.

**`positions`** — the current holding for one stock in one portfolio: how many shares (`quantity`), what they cost on average (`avg_cost`), and profit already locked in from past sells (`realized_pnl`). Recomputed on every sync.

**`daily_prices`** — one row per stock per trading day with open/high/low/close/volume. Filled two ways: the broker sync writes today's close from the broker's `mtmPrice`; the market sync writes full OHLCV history from the analytics API.

**`watchlist_items`** — one row per (user, security) the user wants to follow. It holds nothing but the link and when it was added; prices come from `daily_prices` at read time. Watched securities are automatically included in the price sync scope.

**`corporate_actions`** — one row per event that changes what a share pays or how many you hold. `DIVIDEND`: `amount` is Rs per share. `BONUS_SHARE`: `ratio` is new shares per old, so a 10 % bonus is `1.1`. `RIGHT_SHARE`: `ratio` is the shares you may buy per share held and `amount` is their price; recorded, never applied, because taking up a right is a purchase you make separately. `SPLIT`: `ratio` is `2` for two-for-one. `MERGER`: `ratio` is new shares per old and `to_security_id` is the stock they became (ENGRO → ENGROH). `source` is `payouts` when the payouts sync wrote the row (section 10.6, endpoint 21) and `manual` for the rows only a person can know: the provider's feed carries dividends, bonuses and rights but **not** splits or mergers. `provider_id` is the provider's announcement id. Unique on (security, type, ex-date), so a re-sync updates a row instead of duplicating it. Read by the position rebuild (section 11.3, 11.4) and by the dividend income endpoint (22); nothing is stored back.

**`fundamentals`** — the provider's company statements, saved whole. One row per stock per `statement`: `fundamentals` (41 ratios, each with the sector's min, median and max), `income`, `balance` and `cashflow` (annual, in Rs thousands; the newest period first, then up to seven fiscal years). `payload` is the provider's JSON exactly as it came, so a new ratio or a renamed field costs nothing; readers match periods by `periods[].year`, never by position, because the statements do not all start at the same period (income starts at TTM, balance at the latest quarter, cashflow has neither). Written by the statements sync (endpoints 24, 25) with an upsert on (security, statement); read by the valuation endpoint (26). An ETF answers with no `fields` and gets no row. Not refreshed by the nightly job (limitation 26).

---

## 8. Authentication

### 8.1 How login works

1. The client calls `POST /auth/register` or `POST /auth/login`.
2. The server checks the password against the bcrypt hash.
3. The server signs a **JWT** containing `{ id, email }` with `JWT_SECRET`, valid for `JWR_EXPIRES_IN` (default 7 days).
4. The token is returned in the JSON body. (It is also set as an `httpOnly` cookie named `jwt`, but the server does not read that cookie back — only the header below works.)

### 8.2 How to call a protected endpoint

Send the token in the `Authorization` header on every request to `/broker`, `/portfolio`, or `/market`:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 8.3 What can go wrong

| Situation | Status | Body |
|---|---|---|
| Header missing or not `Bearer ...` | 401 | `{ "error": "No authentication token found" }` |
| Token expired | 401 | `{ "error": "Session expired, please log in again" }` |
| Token invalid / wrong secret | 401 | `{ "error": "Invalid authentication token" }` |
| Token valid but user deleted | 401 | `{ "error": "User no longer exists" }` |

### 8.4 Ownership rules

Every protected endpoint filters by `req.user.id`. A user can only see or change **their own** broker accounts, portfolios, positions, and trades. Requesting someone else's resource gives `404` (for broker accounts) or an empty list (for portfolio positions/trades).

---

## 9. API reference

**Base URL:** `http://localhost:5001` (local)
**Content type:** all request and response bodies are JSON.
**Auth:** 🔒 = needs `Authorization: Bearer <token>`.

### Endpoint summary

| # | Method | Path | Auth | Purpose |
|---|---|---|---|---|
| 1 | POST | `/auth/register` | — | Create a user and get a token |
| 2 | POST | `/auth/login` | — | Log in and get a token |
| 3 | POST | `/broker/accounts` | 🔒 | Link a broker account (logs in to the broker) |
| 4 | GET | `/broker/accounts` | 🔒 | List my linked broker accounts |
| 5 | PATCH | `/broker/accounts/:id/disconnect` | 🔒 | Unlink a broker account (keeps history) |
| 6 | POST | `/broker/accounts/:id/sync` | 🔒 | Download trades + holdings and rebuild positions |
| 7 | GET | `/portfolio/list` | 🔒 | List my portfolios |
| 8 | GET | `/portfolio/:id/position-list` | 🔒 | Current holdings with P&L, day change and a summary |
| 9 | GET | `/portfolio/:id/trade-list` | 🔒 | Paginated trade history |
| 10 | POST | `/market/sync/:id` | 🔒 | Download ~5 years of daily prices for held + watched securities and `KSE100` |
| 11 | GET | `/market/prices/:symbol` | 🔒 | Stored daily price bars for one symbol (e.g. `KSE100`) |
| 12 | POST | `/market/securities/:id` | 🔒 | One-time import of the broker's full approved symbol list |
| 13 | GET | `/market/securities?q=` | 🔒 | Search securities by symbol or company name |
| 14 | GET | `/market/trend/:symbol?period=` | 🔒 | One stock vs `KSE100`, both rebased to 100 — chart payload |
| 15 | GET | `/watchlist` | 🔒 | My watchlist with last price and day change; `KSE100` on top |
| 16 | POST | `/watchlist/:securityId` | 🔒 | Add a security to my watchlist |
| 17 | DELETE | `/watchlist/:securityId` | 🔒 | Remove a security from my watchlist |
| 18 | GET | `/portfolio/:id/benchmark` | 🔒 | Portfolio vs `KSE100`: same-cash shadow, time-weighted chart, XIRR, per-stock alpha |
| 19 | POST | `/broker/accounts/:id/full-sync` | 🔒 | The nightly routine on demand: log in with the stored password, then trades + prices + payouts |
| 20 | POST | `/market/payout/:symbol` | 🔒 | Fetch one stock's dividends, bonus and right shares from the analytics API and save them to `corporate_actions` |
| 21 | POST | `/market/bulk-payouts/sync/:id` | 🔒 | The same for every held + watched stock, one at a time with a pause; the nightly job runs this |
| 22 | GET | `/portfolio/:id/dividend-income` | 🔒 | Dividends you were entitled to since your first buy, per stock and in total, plus the announced ones ahead |
| 23 | GET | `/market/payout/:symbol` | 🔒 | Everything on record for one stock: dividends, bonus, rights, splits, mergers. Reads the table only; feeds the stock screen |
| 24 | POST | `/market/fundamentals/:symbol` | 🔒 | Fetch one stock's four statements from the analytics API and save them to `fundamentals` |
| 25 | POST | `/market/bulk-fundamentals/sync/:id` | 🔒 | The same for every held + watched stock, one at a time with a pause |
| 26 | GET | `/market/valuation/:symbol` | 🔒 | Reverse DCF: the yearly growth the current price assumes, next to the growth the company delivered |

---

### 9.1 Auth

#### 1. `POST /auth/register`

Creates a new user and returns a login token.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | Must be unique. |
| `password` | string | yes | Any length; hashed with bcrypt. |
| `fullName` | string | yes | Max 120 characters. |

```json
{ "email": "ali@example.com", "password": "secret123", "fullName": "Ali Khan" }
```

**Success — `201 Created`**

```json
{
  "message": "success",
  "data": {
    "user": { "id": "3f1c…", "fullName": "Ali Khan", "email": "ali@example.com" },
    "token": "eyJhbGciOi…"
  }
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "email, password and fullName are required." }` | A field is missing. |
| 400 | `{ "error": "email is not valid." }` | Not an email address. |
| 400 | `{ "error": "password must be at least 6 characters." }` | Too short. |
| 400 | `{ "error": "user already exists" }` | Email is already registered. |

---

#### 2. `POST /auth/login`

**Request body**

```json
{ "email": "ali@example.com", "password": "secret123" }
```

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "user": { "id": "3f1c…", "fullName": "Ali Khan", "email": "ali@example.com" },
    "token": "eyJhbGciOi…"
  }
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "email and password are required." }` | A field is missing. |
| 401 | `{ "error": "Invalid email or password" }` | Email not found or password wrong (same message for both, on purpose). |

> Register and login return the same shape, so a client can treat them alike.

---

### 9.2 Broker accounts

#### 3. `POST /broker/accounts` 🔒

Links an AHL eTrade account to the logged-in user. The server logs in to the broker website with the given credentials. If login works, it:

- creates (or re-activates) a `broker_accounts` row,
- creates a `portfolios` row named `AHL <accountNumber>` if one does not exist,
- keeps the broker session cookies **in memory for 15 minutes** so the next sync call can reuse them,
- stores the broker password **encrypted** (AES-256-GCM with `CREDENTIALS_KEY`) so the nightly sync can log in without you. When `CREDENTIALS_KEY` is not set, nothing is stored.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `accountNumber` | string | yes | Broker client code, e.g. `CC12345`. |
| `password` | string | yes | Broker trading password, sent whole. Until October 2026 the broker asked for a few random character positions; its new login form takes the full password. |

```json
{ "accountNumber": "CC12345", "password": "MyBrokerPass1" }
```

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": { "brokerAccountId": "8a2e…", "portfolioId": "c47b…" }
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "accountNumber and password are required." }` | Missing field. |
| 400 | `{ "error": "Invalid broker credentials." }` | Broker rejected the login. 400 rather than 401, because the app signs the user out on any 401 (section 13). |
| 400 | `{ "error": "Could not reach the broker: …" }` | Network error talking to the broker site: down, DNS, HTTPS refused. |
| 502 | `{ "error": "The broker did not start a session." }` | The login answered without a 302 or without a session cookie, which means the broker changed its login page again. |

---

#### 4. `GET /broker/accounts` 🔒

Lists the caller's linked broker accounts, newest first.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "accounts": [
      {
        "id": "8a2e…",
        "broker": "AHL_ETRADE",
        "clientCode": "CC12345",
        "syncStatus": "idle",
        "lastSyncedAt": "2026-09-04T09:15:22.000Z",
        "createdAt": "2026-08-30T12:00:00.000Z",
        "portfolios": [ { "id": "c47b…", "name": "AHL CC12345" } ]
      }
    ]
  }
}
```

`syncStatus` is `idle`, `syncing`, `error` or `disconnected`. `lastSyncedAt` is `null` until the first sync.

---

#### 5. `PATCH /broker/accounts/:id/disconnect` 🔒

Unlinks a broker account. Sets `syncStatus` to `disconnected`, clears the stored password so the nightly sync skips it, and drops the in-memory broker session. **Trades, positions and the portfolio are kept.**

**Path params:** `id` — broker account UUID.

**Success — `200 OK`**

```json
{
  "message": "account disconnected successfully",
  "data": { "account": { "id": "8a2e…", "clientCode": "CC12345", "syncStatus": "disconnected" } }
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "account does not exist" }` | Not found or belongs to another user. |

---

#### 6. `POST /broker/accounts/:id/sync` 🔒

The main import job. Reads the broker's order history and current holdings, saves trades, rebuilds positions, and records today's prices. It does **not** log in — it reuses the in-memory session from the link call. If that session is gone (15 minutes passed, or server restarted), you get `401` and must call `POST /broker/accounts` again.

Safe to call repeatedly: trades already imported are not duplicated.

**Path params:** `id` — broker account UUID.

**Query params (all optional)**

| Param | Default | Notes |
|---|---|---|
| `from` | `2022-01-01` | Start date `YYYY-MM-DD`. |
| `to` | today | End date `YYYY-MM-DD`. |
| `type` | `ALL` | Passed straight to the broker (e.g. `BUY`, `SELL`, `ALL`). |
| `scrip` | `ALL` | Passed straight to the broker: one symbol, or `ALL`. |

Example: `POST /broker/accounts/8a2e…/sync?from=2024-01-01&to=2024-12-31`

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "securities": 12,
    "trades": 87,
    "positions": 9,
    "prices": 7,
    "fromCollaterals": 7,
    "fromTrades": 2,
    "mismatches": [
      {
        "symbol": "FFC",
        "computedQty": 500,
        "brokerQty": 550,
        "delta": 50,
        "impliedRatio": 1.1,
        "costBasisMatches": true
      }
    ],
    "from": "2022-01-01",
    "to": "2026-09-04"
  }
}
```

| Field | Meaning |
|---|---|
| `securities` | Distinct symbols seen (created if new). |
| `trades` | Trade rows processed (inserted or refreshed). |
| `positions` | Position rows written. |
| `prices` | Today's price rows written from the broker's `mtmPrice`. |
| `fromCollaterals` | Positions whose quantity/cost came from the broker's live holdings list. |
| `fromTrades` | Positions computed only from trade history (stock held in a sub-investor CDC account, which the broker's holdings list does not show). |
| `mismatches` | Stocks where our trade-based share count differs from the broker's. `costBasisMatches: true` with a positive `delta` usually means a stock split or bonus shares we never saw as a trade. |

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "Broker session expired. Reconnect the account to continue." }` | No live session, or the broker answered with its login page instead of data. |
| 404 | `{ "error": "account does not exist" }` | Not found / not yours. |

---

#### 19. `POST /broker/accounts/:id/full-sync` 🔒

Runs the nightly routine for one account right now (section 10.6): log in to the broker with the stored password, pull trades and holdings, rebuild positions, fetch missing price bars, then refresh payouts into `corporate_actions`. Use it to test the job or to refresh after market hours without waiting for the evening run. Takes two to three minutes because of the pauses between provider calls.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": { "trades": 261, "positions": 25, "newPriceRows": 21, "corporateActions": 285 }
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "account does not exist" }` | Unknown id or not your account. |
| 400 | `{ "error": "No stored password for this account. Link it again to enable sync." }` | The account was linked before `CREDENTIALS_KEY` existed, or was disconnected. |
| 502 | `{ "error": "Invalid broker credentials." }` (or another broker message) | The broker login or history call failed. `syncStatus` becomes `error`. |

---

### 9.3 Portfolio

#### 7. `GET /portfolio/list` 🔒

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "portfoliolist": [
      {
        "id": "c47b…",
        "userId": "3f1c…",
        "brokerAccountId": "8a2e…",
        "name": "AHL CC12345",
        "baseCurrency": "PKR",
        "createdAt": "2026-08-30T12:00:00.000Z"
      }
    ]
  }
}
```

---

#### 8. `GET /portfolio/:id/position-list` 🔒

Current holdings with the latest known price and profit/loss numbers. All numbers are real JSON numbers (not strings). Optionally also returns a price **trend** per stock for a date range, for charts.

**Path params:** `id` — portfolio UUID.

**Query params (optional — send both or neither)**

| Param | Format | Default | Notes |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | today − 1 year | Start of the trend window (inclusive). |
| `to` | `YYYY-MM-DD` | today | End of the trend window (inclusive). Must not be before `from`; the window may be at most 5 years wide. |

Each position gets a `trend` array of `{ date, close }` in oldest-first order for the window. Without dates the window is the **last 12 months ending today**. One PSX trading year is about 249 bars.

**Which stocks are returned:** only those **held at some point inside the window** — the quantity at the start of `from` was above zero, or there was a BUY inside the window. So a stock bought after `to` is left out, and with the default window a stock you fully sold more than a year ago is left out too. A position with no trade rows at all (shares that only appear in the broker's holdings list) is kept while its quantity is above zero. `summary` totals only the rows returned, so for a past window it means "today's value of what I held then" — call the endpoint without dates for the headline numbers.

Example: `GET /portfolio/c47b…/position-list?from=2025-09-05&to=2026-09-05`

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "range": { "from": "2025-09-05", "to": "2026-09-05" },
    "positions": [
      {
        "id": "d1a0…",
        "portfolioId": "c47b…",
        "symbol": "FFC",
        "companyName": "FFC",
        "quantity": 550,
        "avgCost": 102.5,
        "lastPrice": 118.4,
        "priceAsOf": "2026-09-04",
        "previousClose": 117.9,
        "previousCloseDate": "2026-09-03",
        "dayChange": 275,
        "dayChangePct": 0.42,
        "investedValue": 56375,
        "marketValue": 65120,
        "unrealizedPnl": 8745,
        "unrealizedPct": 15.51,
        "realizedPnl": 1200,
        "trend": [
          { "date": "2025-09-05", "close": 101.2 },
          { "date": "2025-09-08", "close": 102.75 },
          { "date": "2026-09-04", "close": 118.4 }
        ]
      }
    ],
    "summary": {
      "invested": 56375,
      "marketValue": 65120,
      "unrealizedPnl": 8745,
      "unrealizedPct": 15.51,
      "dayChange": 275,
      "dayChangePct": 0.42,
      "dayChangeAsOf": "2026-09-04",
      "dayChangeFrom": "2026-09-03",
      "dayChangeCoverage": 100,
      "realizedPnl": 1200,
      "openPositions": 1,
      "pricedPositions": 1,
      "unpricedPositions": 0
    }
  }
}
```

| Field | How it is calculated |
|---|---|
| `investedValue` | `quantity × avgCost` |
| `lastPrice` / `priceAsOf` | Newest row in `daily_prices` for that stock. `null` if we have no price yet. |
| `previousClose` / `dayChange` / `dayChangePct` | The price row before the newest one, and `quantity × (lastPrice − previousClose)`. All `null` when the stock has only one price row, or when its newest price is older than the newest price in the portfolio (a delisted stock like ENGRO has no "today"). "Previous" means the previous row, so a Monday compares with Friday. |
| `summary.dayChange` / `dayChangePct` / `dayChangeAsOf` / `dayChangeFrom` | The rupee changes added up, as a percent of what those holdings were worth the day before (weighted, not an average of percents), the trading day they belong to, and the day they are measured from (`previousCloseDate` on the rows; Friday on a Monday). The app writes the caption from it: "vs Fri 4 Sept close". `dayChangeCoverage` is the share of market value that had a price for that day: on the evening of a sync the broker has priced the held stocks but the provider's bars for the smaller ones arrive later, so it can sit below 100% for a few hours. The app shows "today" only when `dayChange` is not null and adds "N% of holdings" when coverage is under 95%. |
| `marketValue` | `quantity × lastPrice` (or `null`) |
| `unrealizedPnl` | `marketValue − investedValue` (or `null`) |
| `unrealizedPct` | `unrealizedPnl / investedValue × 100` (or `null`) |
| `summary.*` | Totals **only over positions that have a price** (`quantity > 0` and `lastPrice` not null). `unpricedPositions` tells the UI how many were left out, so it can show a warning instead of quietly under-reporting. |
| `trend` | All `daily_prices` rows for that stock inside the window, oldest first. `[]` when the stock has no bars in the window (e.g. a delisted stock) — `lastPrice` still comes from the newest bar it ever had, so `summary` never changes with the window. |
| `range` | The window used (the default is the last 12 months ending today). |

If the portfolio is not yours, `positions` is simply an empty array (status 200).

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "from and to must be sent together." }` | Only one of the two dates was sent. |
| 400 | `{ "error": "from and to must be YYYY-MM-DD dates." }` | Bad format or impossible date (e.g. `2026-02-31`). |
| 400 | `{ "error": "from must not be after to." }` | Reversed window. |
| 400 | `{ "error": "Range is too wide: at most 5 years." }` | Window longer than 5 years. |

---

#### 9. `GET /portfolio/:id/trade-list` 🔒

Paginated list of trades, newest first.

**Path params:** `id` — portfolio UUID.

**Query params**

| Param | Default | Max | Notes |
|---|---|---|---|
| `limit` | 50 | 100 | Page size. |
| `offset` | 0 | — | How many rows to skip. |

Example: `GET /portfolio/c47b…/trade-list?limit=20&offset=40`

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "trades": [
      {
        "id": "e9f3…",
        "portfolioId": "c47b…",
        "side": "BUY",
        "quantity": "500.0000",
        "price": "102.5000",
        "commission": "153.7500",
        "netAmount": "51403.7500",
        "executedAt": "2026-03-12T00:00:00.000Z",
        "security": { "symbol": "FFC", "companyName": "FFC" }
      }
    ],
    "pagination": { "total": 87, "limit": 20, "offset": 40, "hasMore": true }
  }
}
```

> **Note:** unlike the positions endpoint, `quantity`, `price`, `commission` and `netAmount` here come back as **strings** (Prisma `Decimal`). Convert with `Number()` on the client.

---

#### 18. `GET /portfolio/:id/benchmark` 🔒

The whole portfolio against `KSE100`, computed on read from `trades` and `daily_prices` (about 160 ms for two years of history). No query params: the response is the full history since the first trade, and the app slices it per range and rebases at the slice's first point.

**Path params:** `id` — portfolio UUID. Must belong to the caller.

**Success — `200 OK`** (series and positions abbreviated)

```json
{
  "message": "success",
  "data": {
    "asOf": "2026-09-04",
    "window": { "from": "2024-07-29", "to": "2026-09-04", "tradingDays": 525 },
    "headline": {
      "netCashIn": 4461909.97,
      "portfolio": 5083415.94,
      "benchmark": 5454803.26,
      "difference": -371387.32,
      "portfolioReturnOnCash": 13.93,
      "benchmarkReturnOnCash": 22.25
    },
    "timeWeighted": {
      "portfolio": 60.36, "benchmark": 122.42, "alpha": -62.06,
      "maxDrawdown": { "portfolio": -23.62, "benchmark": -22.57 }
    },
    "moneyWeighted": { "portfolioXirr": 18.6, "benchmarkXirr": 29.52 },
    "phases": [
      { "from": "2024-07-29", "to": "2026-02-02", "portfolio": 66.41, "benchmark": 134.76, "netCashInAtEnd": 1999631.62 },
      { "from": "2026-02-02", "to": "2026-09-04", "portfolio": -3.64, "benchmark": -5.26, "netCashInAtEnd": 4461909.97 }
    ],
    "series": [
      { "date": "2024-07-29", "portfolio": 100, "benchmark": 100, "value": 17669.62, "netCashIn": 20027.61 },
      { "date": "2026-09-04", "portfolio": 160.36, "benchmark": 222.42, "value": 5083415.94, "netCashIn": 4461909.97 }
    ],
    "positions": [
      { "symbol": "FFC", "quantity": 2270, "avgCost": 499.41, "lastPrice": 548.11,
        "buyDate": "2026-01-05", "stockReturn": 9.75, "benchmarkReturn": -3.88,
        "alpha": 13.63, "costBasis": 1133660.7, "weight": 24.15 }
    ],
    "dataNotes": {
      "adjustedSplits": [
        { "symbol": "SYS", "date": "2025-06-04", "ratio": 5 },
        { "symbol": "BAFL", "date": "2026-04-20", "ratio": 2 }
      ],
      "unrecordedSplits": [],
      "dividendsIncluded": false
    }
  }
}
```

**Field guide**

| Field | Meaning |
|---|---|
| `headline` | Every rupee spent on a buy bought `KSE100` units at that day's level, every sell redeemed them; `benchmark` is those units at today's level. `portfolio` is `Σ quantity × lastPrice`. Deposits cannot distort this. |
| `timeWeighted` | Both lines start at 100 on the first trade. Each day values yesterday's holdings at today's prices, chains the change, *then* applies the day's trades — so money added never moves the line. Slice and rebase on the client for any shorter window. |
| `moneyWeighted` | XIRR (annualised) of the actual cash flows, with today's value as the final inflow; `benchmarkXirr` uses the shadow value instead. |
| `phases` | The time-weighted return split at 2026-02-01 — the sentence that explains the chart. One phase if every trade is after the cut. |
| `series` | One point per trading day (union of `KSE100` bar dates and trade dates). |
| `positions` | Open positions only, sorted by `costBasis` desc. `buyDate` is the cost-weighted average of the buys, moved to the next trading day; `benchmarkReturn` is `KSE100` over `buyDate → asOf`. |
| `dataNotes.adjustedSplits` | Every `SPLIT` and `BONUS_SHARE` row on record in `corporate_actions` for the traded stocks (`date` is the ex date). The stored price history is already divided for them, so a trade made before one is multiplied by its `ratio` when valuing holdings, buys and sells alike. These are the same rows the positions use. |
| `dataNotes.unrecordedSplits` | A warning, normally empty. A trade paid far above that day's stored close, with no split or bonus on record after it, means a row is missing in `corporate_actions`. The `ratio` here is a guess from prices and is never used in the numbers. Because old prices shrink a little with every dividend, an old trade of a high-dividend stock can appear here falsely after several years. |

The maths, the verification against the live data, and the roadmap (corporate actions table, extra screens) are in [`BENCHMARK_ANALYTICS.md`](BENCHMARK_ANALYTICS.md).

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "Portfolio not found." }` | Unknown id, or not your portfolio. |
| 400 | `{ "error": "No trades to benchmark." }` | The portfolio has never been synced. |
| 400 | `{ "error": "KSE100 prices not synced yet." }` | Run `POST /market/sync/:id` first. |

---

#### 22. `GET /portfolio/:id/dividend-income` 🔒

What the dividends recorded in `corporate_actions` were worth to *you*: for every dividend, the shares you held the day before its ex-date times the rupees per share. Computed on read from `trades` and `corporate_actions`; nothing is stored. Gross, before the 15 % withholding tax.

**Path params:** `id` — portfolio UUID. Must belong to the caller.

**Success — `200 OK`** (lists abbreviated)

```json
{
  "message": "success",
  "data": {
    "total": 168290,
    "byStock": [
      { "symbol": "FFC", "dividends": 4, "rupees": 68900 },
      { "symbol": "HUBC", "dividends": 6, "rupees": 31828.5 }
    ],
    "dividends": [
      { "symbol": "FFC", "exDate": "2025-11-04T00:00:00.000Z", "perShare": 9.5, "shares": 730, "rupees": 6935 },
      { "symbol": "FFC", "exDate": "2026-08-10T00:00:00.000Z", "perShare": 14.5, "shares": 2210, "rupees": 32045 }
    ],
    "upcomingDividend": [
      { "symbol": "LCI", "exDate": "2026-09-18T00:00:00.000Z", "ownBy": "2026-09-17T00:00:00.000Z", "perShare": 5.25, "shares": 2915, "expected": 15303.75 },
      { "symbol": "MARI", "exDate": "2026-09-21T00:00:00.000Z", "ownBy": "2026-09-18T00:00:00.000Z", "perShare": 18.7, "shares": 1547, "expected": 28928.9 }
    ]
  }
}
```

**Field guide**

| Field | Meaning |
|---|---|
| `dividends` | Every `DIVIDEND` row with an ex-date up to today where you held shares that day. `shares` is `sharesHeldOn(trades, shareChanges, securityId, exDate)`: the trade walk (section 11) run on this stock's trades and splits dated **strictly before** the ex-date, because a share bought on the ex-date does not get the dividend. So FFC's four dividends land on 730, 1,310, 2,210 and 2,210 shares, not on today's 2,270. |
| `byStock` | The rows above added up per stock: how many dividends and how many rupees. Not sorted; the app sorts by `rupees`. |
| `total` | All rupees together. |
| `upcomingDividend` | `DIVIDEND` rows with an ex-date after today, for stocks you hold. `shares` is what you hold now; `expected` is `shares × perShare` if you keep them. `ownBy` is the last weekday before the ex-date: buy on or before it to get the dividend, do not sell before the ex-date to keep it. Monday ex-dates give a Friday `ownBy`. |

Limits: dividends before a stock was bought are skipped, which is most of the 250+ rows in the table. Mergers are not applied here, so ENGROH dividends after the ENGRO swap are not counted yet. Bonus shares are not listed (they change the share count, section 11.3, but pay no money).

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "Portfolio not found." }` | Unknown id, or not your portfolio. |

---

### 9.4 Market data

#### 10. `POST /market/sync/:id` 🔒

Downloads daily price history (about 5 years of open/high/low/close/volume) for the securities that matter: **every stock currently held** (a position with quantity > 0), **every stock on any user's watchlist**, and the `KSE100` benchmark. The other ~500 rows in `securities` exist for search only and are never fetched. Safe to re-run: a symbol whose newest stored bar is already today (Karachi date) is skipped without making a request, and for the rest `skipDuplicates` means only new days are inserted. Requests are spaced one to three seconds apart (section 10.8), so a sync of ~24 symbols takes about a minute.

The `:id` is a **broker account** id, because the market API needs a session that is obtained by following that account's analytics hand-off (see [section 10.5](#105-getting-market-data-prices)). If there is no live broker session but `DASHBOARD_COOKIE` is set in `.env`, that cookie is used instead.

**Path params:** `id` — broker account UUID.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "securities": 20,
    "fetched": 18,
    "skipped": 1,
    "newRows": 22,
    "results": [
      { "symbol": "FFC", "fetched": 1240, "saved": 1 },
      { "symbol": "KSE100", "skipped": "already current" },
      { "symbol": "XYZ", "error": 404 }
    ]
  }
}
```

Each item in `results` is one of `{ symbol, fetched, saved }`, `{ symbol, skipped: "already current" }`, or `{ symbol, error }` where `error` is an HTTP status or message. `saved` is the count of **new** rows (the API always returns the full history, so on a re-run this is usually 0 or 1). One failing symbol does not stop the others.

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "Broker session expired. Reconnect the account so a market session can be issued." }` | No broker session and no `DASHBOARD_COOKIE`. |
| 400 | `{ "error": "The broker did not return an analytics URL." }` / `"The dashboard handoff did not return a session cookie."` | Hand-off to the analytics site failed. |
| 404 | `{ "error": "account does not exist" }` | Not found / not yours. |

> This call fetches symbols one after another with a random one-to-three-second pause between them. With ~24 held + watched symbols it takes about a minute; the HTTP request stays open until it finishes. The pacing is deliberate — a burst of requests against the analytics site looks like a scraper, a spaced sequence looks like someone browsing.

---

#### 11. `GET /market/prices/:symbol` 🔒

Daily price bars for one symbol, read straight from the `daily_prices` table. No broker or market session is needed, so it works whenever the database does — but the data is only as fresh as the last `POST /market/sync/:id` run, which is why `asOf` is returned. Use it for the KSE-100 benchmark line (`/market/prices/KSE100`) or for any single stock's chart.

**Path params:** `symbol` — stock or index symbol, case-insensitive (e.g. `KSE100`, `ffc`).

**Query params (optional — send both or neither)**

| Param | Default | Notes |
|---|---|---|
| `from` / `to` | last 12 months ending today | `YYYY-MM-DD`; same rules as the positions endpoint (inclusive, `from ≤ to`, max 5 years). Every bar inside the window is returned. |

Examples: `GET /market/prices/KSE100` (last year) · `GET /market/prices/KSE100?from=2026-08-01&to=2026-08-31`

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "symbol": "KSE100",
    "range": { "from": "2026-08-01", "to": "2026-08-31" },
    "asOf": "2026-08-31",
    "bars": [
      { "date": "2026-08-03", "open": 171020.5, "high": 171890.2, "low": 170411.7, "close": 171644.9, "volume": 231551200 },
      { "date": "2026-08-31", "open": 175149.2, "high": 175796.2, "low": 174893.7, "close": 174929.7, "volume": 192168147 }
    ]
  }
}
```

Bars are oldest first. `open`, `high`, `low`, `volume` can be `null` for the placeholder bar the broker sync writes (it only knows the close).

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | same four messages as the positions endpoint | Bad `from`/`to`. |
| 404 | `{ "error": "security does not exist" }` | Symbol never seen by any sync. |

---

#### 12. `POST /market/securities/:id` 🔒

One-time import of the broker's complete symbol list (from `GET /Home/GetSymolsList` — the broker's own typo). Run it once after linking an account; it fills `securities` with every approved symbol on the exchange so the watchlist search has something to find. Re-running is safe: it upserts by `symbol`, refreshing names and sectors, and the placeholder rows the trade sync created (`company_name` = symbol) get their real company names.

The `:id` is a **broker account** id; the call needs that account's live broker session (the 15 minutes after `POST /broker/accounts`). It talks to the broker site, not the analytics site.

**What is kept:** rows with `approved: "Approved"`, excluding `market: "FUT"` (futures contracts such as `AGHA-OCT`). The source lists each symbol 2–3 times (REG / ODL / FUT markets); one row per symbol is stored. An empty `sectorName` becomes `null`. Company names keep the broker's suffixes — `(XD)` ex-dividend, `(DEF)` defaulter segment — as they were sent.

**Path params:** `id` — broker account UUID.

**Success — `200 OK`**

```json
{ "message": "success", "data": { "received": 1644, "saved": 557 } }
```

`received` is the raw row count from the broker; `saved` is the number of distinct symbols written.

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "Broker session expired. Reconnect the account." }` | No live broker session. |
| 404 | `{ "error": "account does not exist" }` | Not found / not yours. |

> Upserts one symbol at a time; expect a few seconds for ~550 rows.

---

#### 13. `GET /market/securities?q=` 🔒

Search `securities` by symbol or company name, case-insensitive — the picker for "add to watchlist". Reads the database only; no broker or market session needed.

Two kinds of row are excluded, both per-user: stocks you **currently hold** (a position with quantity > 0 in any of your portfolios — they already appear on the portfolio screen) and stocks **already on your watchlist**. So the picker only ever offers things you can usefully add, and the same query returns different rows for different users.

**Query params**

| Param | Required | Notes |
|---|---|---|
| `q` | yes | At least 2 characters. Matched with `contains` against both `symbol` and `companyName`. |

Returns at most 20 rows, ordered by symbol.

Example: `GET /market/securities?q=fert` → `EFERT`, `FATIMA`, `FFBL`, `FFC`.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "securities": [
      { "id": "…", "symbol": "EFERT", "companyName": "Engro Fertilizers Limited", "sector": "FERTILIZER" },
      { "id": "…", "symbol": "FFC", "companyName": "Fauji Fertilizer Company Limited", "sector": "FERTILIZER" }
    ]
  }
}
```

Pass `id` to `POST /watchlist/:securityId`.

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "q must be at least 2 characters" }` | Missing or too-short `q`. |

---

#### 14. `GET /market/trend/:symbol?period=` 🔒

One stock against the `KSE100` benchmark over a period — the payload for a two-line comparison chart. Both series are **rebased to 100 on the first day** of the range, so a 550-rupee stock and a 176,000-point index share one axis, and the gap between the two lines reads directly as out- or under-performance in percentage points. Reads `daily_prices` only.

**Path params:** `symbol` — stock symbol, case-insensitive.

**Query params**

| Param | Default | Values |
|---|---|---|
| `period` | `6M` | `1W`, `1M`, `3M`, `6M`, `1Y`, `3Y`, `5Y` |

The period is a calendar window ending today, then reduced to the trading days that **both** the stock and the index have a close for — so the two lines always line up. A `6M` request returns ~120 points, `1W` about 5. If the stock listed after the window began (e.g. `BFAGRO`, March 2025), the range is clamped to the stock's first bar; `range.from` in the response says where the line really starts.

`1D` is **not supported**. A daily-bars table gives one point per day; an intraday chart needs the minute feed (`/intraday/<SYMBOL>/1D` on the analytics API), which is not stored.

Example: `GET /market/trend/FFC?period=6M`

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "symbol": "FFC",
    "period": "6M",
    "range": { "from": "2026-03-09", "to": "2026-09-04" },
    "series": [
      { "date": "2026-03-09", "close": 471.4,  "stock": 100,    "benchmark": 100 },
      { "date": "2026-09-04", "close": 548.11, "stock": 116.27, "benchmark": 119.69 }
    ],
    "summary": { "stockReturn": 16.27, "benchmarkReturn": 19.69, "outperformance": -3.42 }
  }
}
```

Chart `stock` and `benchmark`; show `close` in the tooltip (the real price); put `summary` in the header. `outperformance` is `stockReturn − benchmarkReturn` in percentage points — negative means the stock trailed the index over the window.

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "period must be one of 1W, 1M, 3M, 6M, 1Y, 3Y, 5Y" }` | Unknown period. |
| 404 | `{ "error": "security does not exist" }` | Unknown symbol. |
| 404 | `{ "error": "not enough price history for this period" }` | Fewer than 2 shared trading days — usually prices were never synced for this symbol. |

---

#### 20. `POST /market/payout/:symbol` 🔒

Fetches one stock's payout announcements from the analytics API (`/payouts/announcement-break-down/SYMBOL`), keeps the published ones that have an ex-date, and upserts them into `corporate_actions` with `source = "payouts"`. One provider row can become up to three of ours: a `DIVIDEND` when `dividend > 0`, a `BONUS_SHARE` when `bonus > 0` (`ratio = 1 + bonus / 100`) and a `RIGHT_SHARE` when `rightIssue > 0` (`ratio = rightIssue / 100`, `amount = rightPrice`). A POST because it writes; to only read what is on record use endpoint 23. The nightly job uses endpoint 21.

Needs a live market session, because this feed wants the page token as well as the cookie (section 10.7). Link the account or run `full-sync` first.

**Path params:** `symbol` — case-insensitive.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "symbol": "SYS",
    "count": 14,
    "saved": 11,
    "extractdata": [
      { "type": "DIVIDEND", "exDate": "2026-04-01", "amount": 2, "ratio": null, "providerId": "9…" },
      { "type": "BONUS_SHARE", "exDate": "2022-04-01", "amount": null, "ratio": 2, "providerId": "8…" }
    ]
  }
}
```

`count` is rows from the provider, `saved` is rows written (published, with an ex-date). Running it twice gives the same `saved`: the unique key (security, type, ex-date) turns the second run into updates.

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "security does not exist" }` | Unknown symbol. |
| 404 | `{ "error": "No broker account linked." }` | The caller has no broker account. |
| 400 | `{ "error": "Broker session expired. Reconnect the account so a market session can be issued." }` | No live session; link or full-sync first. |

---

#### 21. `POST /market/bulk-payouts/sync/:id` 🔒

Endpoint 20 for every stock you hold or watch (`KSE100` excluded), one after another with a one-to-three-second pause between calls (section 10.8). A stock that fails is noted and skipped; a 429 or 5xx from the provider stops the run for the day. This is what the nightly job calls (section 10.6), so it is only needed by hand after adding to the watchlist or to refresh before the evening.

**Path params:** `id` — broker account UUID. Must belong to the caller.

**Success — `200 OK`** (`results` abbreviated)

```json
{
  "message": "success",
  "data": {
    "securities": 24,
    "saved": 285,
    "results": [
      { "symbol": "AIRLINK", "saved": 9 },
      { "symbol": "BCL", "saved": 0 },
      { "symbol": "ENGRO", "saved": 24 }
    ]
  }
}
```

A row with `error` instead of `saved` is a stock whose call failed. ETFs come back with `saved: 0`; they do not pay through this feed. Takes about a minute for 24 stocks because of the pauses.

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "account does not exists" }` | Unknown id or not your account. |
| 400 | `{ "error": "Broker session expired. …" }` | No live session; link or full-sync first. |

---

#### 23. `GET /market/payout/:symbol` 🔒

Everything `corporate_actions` holds for one stock, newest first, read from the table only: no provider call, no session needed, a few milliseconds. This is what the stock screen's "Dividends & actions" block reads: next announced dividend, rupees per share paid in the last twelve months, the last split or bonus, and how many dividends are on record. It also returns the hand-entered split and merger rows the payouts feed never had.

**Path params:** `symbol` — case-insensitive.

**Success — `200 OK`** (abbreviated)

```json
{
  "message": "success",
  "data": {
    "actions": [
      { "type": "DIVIDEND", "exDate": "2026-09-18", "ratio": null, "amount": 5.25, "toSymbol": null, "source": "payouts" },
      { "type": "SPLIT", "exDate": "2025-07-21", "ratio": 5, "amount": null, "toSymbol": null, "source": "manual" },
      { "type": "DIVIDEND", "exDate": "2024-09-19", "ratio": null, "amount": 33, "toSymbol": null, "source": "payouts" }
    ]
  }
}
```

`exDate` is a plain `YYYY-MM-DD` so the app can compare it with today's date as text. `toSymbol` is set only on a `MERGER` row, the stock the shares became. Per-share amounts are as announced: the Rs 33 above is per old LCI share, before the five-for-one split (limitation 25).

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "security does not exist" }` | Unknown symbol. |

---

#### 24. `POST /market/fundamentals/:symbol` 🔒

Fetches one stock's four company statements from the analytics API (`/company-statement?symbol=X&interval=annual&type=…` with the types `fundamentals`, `income`, `balance` and `cashflow`) and upserts each into `fundamentals`, one row per statement, the provider's JSON saved whole (section 7.4). For a stock that is not held or watched yet this is the only way to get statements; endpoint 25 covers the rest. A statement that comes back without `fields` (an ETF) is skipped. Four provider calls with a one-to-three-second pause between them (section 10.8), so about fifteen seconds.

Needs a live market session, because this feed wants the page token as well as the cookie (section 10.7). Link the account or run `full-sync` first.

**Path params:** `symbol` — case-insensitive.

**Success — `200 OK`**

```json
{ "message": "success", "data": { "symbol": "LCI", "saved": 4 } }
```

`saved` is the number of statements written, 0 to 4. Running it again replaces the four payloads and refreshes `fetched_at`; nothing accumulates.

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "security does not exist" }` | Unknown symbol. |
| 404 | `{ "error": "No broker account linked." }` | The caller has no broker account. |
| 400 | `{ "error": "Broker session expired. …" }` | No live session, or the provider refused part-way; link or full-sync first. |

---

#### 25. `POST /market/bulk-fundamentals/sync/:id` 🔒

Endpoint 24 for every stock you hold or watch (`KSE100` excluded), alphabetically, with the usual pause between calls. A stock that fails is noted and skipped; a 429 or 5xx from the provider stops the run. Unlike payouts this is **not** part of the nightly job yet (limitation 26), so run it by hand after adding to the watchlist, or when a company has published new accounts. Roughly fifteen seconds per stock, so several minutes for a full portfolio.

**Path params:** `id` — broker account UUID. Must belong to the caller.

**Success — `200 OK`** (`results` abbreviated)

```json
{
  "message": "success",
  "data": {
    "securities": 24,
    "saved": 88,
    "results": [
      { "symbol": "AIRLINK", "saved": 4 },
      { "symbol": "MIIETF", "saved": 0 },
      { "symbol": "XYZ", "error": "Request failed with status code 500" }
    ]
  }
}
```

`saved` counts statements, so a stock with full data contributes 4. ETFs come back with `saved: 0`.

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "account does not exist" }` | Unknown id or not your account. |
| 400 | `{ "error": "Broker session expired. …" }` | No live session; link or full-sync first. |

---

#### 26. `GET /market/valuation/:symbol` 🔒

A **reverse DCF**. Instead of guessing a fair value, it asks the opposite question: given today's price, what yearly growth in cash is the market assuming for the next five years? That number sits next to the growth the company actually delivered, so the reader judges whether the price expects more or less than the past. Everything is computed on read from `fundamentals`, `corporate_actions` and `daily_prices`; nothing is stored, no provider call, no session needed. The maths lives in `src/utils/valuation.js`.

How the number is built:

1. **Starting cash.** The average of the latest three fiscal years. For most companies that is free cash flow: operating cash flow plus the (negative) purchases of fixed and intangible assets plus dividends received. If that average is not positive, profit after tax is used instead and `basis` says `"profit"`. For banks (sector `COMMERCIAL BANKS`) operating cash flow means nothing, so the dividends they paid are used (`"dividends paid"`). Fewer than three fiscal years on record means "not applicable".
2. **Share count.** Paid-up share capital on the latest balance sheet divided by par. Par is Rs 10 divided by every recorded `SPLIT` ratio in `corporate_actions`, because the provider's own share counts and per-share figures break after a split. The result is cross-checked against the provider's latest fiscal-year share count, moved into today's share units; more than 5 % apart and the stock answers "share count could not be confirmed" rather than a wrong number.
3. **Market cap** = latest stored close × shares.
4. **Discount rate** `r` = risk-free 11 % + equity premium 6 % = 17 %. Terminal growth 5 %, growth period 5 years (`constants.js`). The implied growth is the rate at which the starting cash, grown for five years and then at the terminal rate for ever, discounted at `r`, adds up to the market cap. It is found by bisection between −50 % and +100 %, two hundred halvings, the same trick as XIRR.
5. **Delivered growth** = compound yearly growth of profit after tax from the oldest fiscal year in the income statement to the latest, up to seven years. Null when either end is missing or not positive.
6. **Sensitivity**: the implied growth again at `r − 1 %` and `r + 1 %`, so the reader sees how much the answer leans on the discount rate.

Statements are stored in Rs thousands, so `shares`, `marketCap` and `startingCash` are multiplied by 1,000 on the way out. Growth figures are percentages, rounded to two decimals.

**Path params:** `symbol` — case-insensitive.

**Success — `200 OK`** (values illustrative)

```json
{
  "message": "success",
  "data": {
    "symbol": "LCI",
    "applicable": true,
    "asOf": "2026-10-09",
    "price": 420.5,
    "shares": 1468000000,
    "marketCap": 617294000000,
    "basis": "free cash flow",
    "startingCash": 48100000000,
    "assumptions": { "r": 0.17, "terminalGrowth": 0.05, "years": 5 },
    "impliedGrowth": 18.6,
    "profitGrowth": 21.4,
    "sensitivity": { "rMinus1": 16.9, "rPlus1": 20.3 }
  }
}
```

Read it as: "at Rs 420 the market is pricing LCI as if its cash grows 18.6 % a year for five years; it has delivered 21.4 % a year on profit". A negative `impliedGrowth` means the price already assumes shrinking cash (HUBC, for instance).

When the number cannot be computed honestly the endpoint still answers `200`, with `applicable: false` and a `reason`: `"no statements for this stock"` (run endpoint 24 first), `"no price for this stock"`, or `"share count could not be confirmed"`. A stock with no positive cash to value should answer the same way but currently crashes (limitation 28).

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "security does not exist" }` | Unknown symbol. |

---

### 9.5 Watchlist

A per-user list of securities to follow. Items reference `securities`, so anything the search endpoint returns can be added. Watched symbols are automatically included in the price sync (endpoint 10), so they get prices on the next run.

#### 15. `GET /watchlist` 🔒

The user's watchlist with the latest price and the day's move for each item, plus the same figures for `KSE100` as a benchmark row to show on top. Everything comes from `daily_prices` — the last two closes per symbol — so it is as fresh as the last price sync.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "benchmark": {
      "securityId": "…", "symbol": "KSE100", "companyName": "KSE-100 Index", "sector": null,
      "lastPrice": 175328.82, "change": 399.13, "changePct": 0.23, "asOf": "2026-09-04"
    },
    "items": [
      { "securityId": "…", "symbol": "MLCF", "companyName": "Maple Leaf Cement Factory Limited", "sector": "CEMENT",
        "lastPrice": 101.46, "change": 2.40, "changePct": 2.42, "asOf": "2026-09-04" },
      { "securityId": "…", "symbol": "FFC", "companyName": "Fauji Fertilizer Company Limited", "sector": "FERTILIZER",
        "lastPrice": 548.11, "change": -0.57, "changePct": -0.10, "asOf": "2026-09-04" }
    ]
  }
}
```

`change` = latest close − previous close; `changePct` is that over the previous close. Items are in the order they were added. Comparing an item's `changePct` with the benchmark's tells you at a glance whether it beat the market today.

**Nulls the UI must handle:** a symbol added since the last price sync has no bars → `lastPrice`, `change`, `changePct`, `asOf` are all `null`. A symbol with only one bar has a `lastPrice` but `change` / `changePct` are `null`. Render "—", not 0. `benchmark` is `null` only if `KSE100` has never been synced.

---

#### 16. `POST /watchlist/:securityId` 🔒

Add a security to the watchlist. Idempotent — adding one that is already there returns `200` and changes nothing (unique index on `(user_id, security_id)`). No request body.

**Fetch-on-add.** If the security has no rows in `daily_prices` yet, and a market session is alive for one of your broker accounts (the analytics cookie cached by a sync in the last ~2 hours), its full price history is downloaded in the same request — one call, ~1,240 rows — so the stock appears in `GET /watchlist` with a price straight away. If there is no live session the row is still inserted and `pricesLoaded` is `false`; the next `POST /market/sync/:id` fills it in, because watched symbols are in the sync scope. A security that already has prices is never re-fetched.

**Path params:** `securityId` — a `securities.id`, typically from `GET /market/securities?q=`.

**Success — `200 OK`**

```json
{ "message": "success", "data": { "symbol": "FFC", "pricesLoaded": true } }
```

`pricesLoaded: false` means "show — for now"; it fills on the next price sync.

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "security does not exist" }` | Unknown `securityId`. |

---

#### 17. `DELETE /watchlist/:securityId` 🔒

Remove a security from the watchlist. Scoped to the caller — a `securityId` that is on someone else's list, or on nobody's, is a `404`.

Only the `watchlist_items` link row is deleted. The `securities` row and its `daily_prices` history are kept — they are shared data, and re-adding the stock later needs no re-download. A stock that is neither held nor watched by anyone simply drops out of the price sync scope, so its history stops growing until it is added again.

**Success — `200 OK`**

```json
{ "message": "success" }
```

**Errors**

| Status | Body | When |
|---|---|---|
| 404 | `{ "error": "not in watchlist" }` | Not on this user's list. |

---

## 10. How the broker integration works

The broker (AHL eTrade) has no API. The backend pretends to be a Chrome browser: it sends the same headers a browser sends, keeps the cookies the site gives back, and parses the HTML it receives. All of this lives in `brokerAccountController.js`, `services/dashboardApi.js`, `marketDataController.js`, `extractAHLInfor.js` and `constants.js`.

### 10.1 Linking an account (login)

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as Backend
    participant B as AHL eTrade website
    participant DB as PostgreSQL
    participant M as In-memory session store

    C->>API: POST /broker/accounts {accountNumber, password}
    API->>B: POST /Home/_Login<br/>UserName=CC12345&Password=…<br/>(maxRedirects: 0)
    alt 302 → /Home/Index + Set-Cookie .AspNetCore.Session, trader, HouseName
        API->>DB: upsert broker_accounts (user, AHL_ETRADE, clientCode)
        API->>DB: upsert portfolios (name "AHL CC12345")
        API->>M: saveSession(brokerAccountId, cookies) — 15 min TTL
        API-->>C: 200 {brokerAccountId, portfolioId}
    else 200 page containing "Invalid Login Credentials"
        API-->>C: 400 Invalid broker credentials
    else anything else (no 302, no cookie)
        API-->>C: 502 The broker did not start a session
    end
```

Key points:

- **Whole password.** Since the broker rebuilt its website in early October 2026 ("Web Trade Cast"), the login is a plain form: `UserName` and `Password` posted to `/Home/_Login`. The old form, which enabled a few random character positions (`Digit1`, `Digit4`, …) and made the backend parse the page first, is gone, and so is the parsing code.
- **No redirects.** Axios is told `maxRedirects: 0`. A successful login answers with a `302` to `/Home/Index` and the cookies we need (`.AspNetCore.Session`, `trader`, `HouseName`) are on that response; following the redirect would lose them.
- **Failure detection.** A wrong password answers HTTP 200 with a page containing `Invalid Login Credentials`, which becomes a `400`. Anything else that is not a 302 with a session cookie is a `502`, the signal that the broker changed its page again. A network error (site down, HTTPS refused, as happened on the night of 1 October 2026) is a `400` with `Could not reach the broker: …`.

### 10.2 Syncing trades

```mermaid
flowchart TD
    A["POST /broker/accounts/:id/sync"] --> B{"Account belongs<br/>to user?"}
    B -- no --> B404["404"]
    B -- yes --> C{"Session in<br/>memory?"}
    C -- no --> C401["401 reconnect"]
    C -- yes --> D["GET /Home/GetOrderHisotry<br/>GET /Home/GetCollaterals"]
    D --> E{"History<br/>is JSON?"}
    E -- "no (got login page)" --> F["clear session → 401"]
    E -- yes --> G["normalizeTradeRows<br/>(side, dates, commission, stable id)"]
    G --> H["upsert securities<br/>(one per symbol)"]
    H --> I["upsert trades<br/>(key: brokerAccountId + brokerTradeId)"]
    I --> J["update broker_accounts<br/>syncStatus=idle, lastSyncedAt, syncCursor"]
    J --> K["load ALL trades for portfolio<br/>→ calculatePositions"]
    K --> L["mergePositions<br/>(broker holdings override qty/avgCost)"]
    L --> M["reconcilePositions<br/>→ mismatches list"]
    M --> N["upsert positions"]
    N --> O["upsert daily_prices for today<br/>close = mtmPrice"]
    O --> P["200 summary"]
```

Two broker endpoints are used:

| Endpoint | What it returns | How it is used |
|---|---|---|
| `GET /Home/GetOrderHisotry?account=…&fromdate=…&todate=…&type=ALL&scrip=ALL` | JSON array of executed orders. Each row has `scrip`, `quantity`, `grossRate`, `netAmount`, `type` (BUY/SELL), `executionDate` (e.g. `"Aug 28, 2026"`). | Becomes `trades`. **Required** — if it fails the sync stops. |
| `GET /Home/GetCollaterals?account=…` | JSON array of what the user currently holds in the broker-linked CDC account. Each row has `symbol`, `quantityTotal`, `avgRateBuy`, `mtmPrice` (today's market price). Already adjusted for splits and bonus shares. | Improves `positions` and writes today's price. **Optional** — if it fails, sync continues with trades only. |

Cookies sent with these calls: the `.AspNetCore.Session` from login, plus `trader=<clientCode>` and `HouseName=AHL` (defaults are added if the broker didn't set them).

### 10.3 How trades get a stable ID

The broker does not give a trade ID. To avoid importing the same trade twice, the backend builds one:

```
key  = scrip | quantity | grossRate | netAmount | type | executionDate
hash = sha1(key)
brokerTradeId = hash + ":" + n     // n = how many identical rows came before this one (0, 1, 2…)
```

The `:n` suffix means two genuinely identical trades on the same day (same stock, qty, price) are both kept. The pair `(broker_account_id, broker_trade_id)` is unique in the database, so re-syncing just refreshes `raw_payload`.

### 10.4 Normalising a broker row

| Our field | From broker | Rule |
|---|---|---|
| `symbol` | `scrip` | as-is |
| `side` | `type` | `SELL` if type is "SELL" (any case), otherwise `BUY` |
| `quantity` | `quantity` | as-is |
| `price` | `grossRate` | as-is |
| `netAmount` | `netAmount` | absolute value |
| `commission` | derived | BUY: `net − (qty × price)` · SELL: `(qty × price) − net`. This is really "all charges" (commission + taxes) because the broker only gives one net number. |
| `taxesLevies` | — | always `0` |
| `executedAt` | `executionDate` | `"Aug 28, 2026"` → `2026-08-28T00:00:00Z`. Time of day is not available. |
| `rawPayload` | whole row | kept as JSON |

### 10.5 Getting market data (prices)

The analytics dashboard (`DASHBOARD_URL`) is a different website with its own login cookie (`laravel_session`). To get one without a second password:

1. Ask the broker for a hand-off URL: `GET /Home/GetAnalyticsURL` (needs the broker session). It returns a URL with a one-time token.
2. Open that URL and follow up to 5 redirects **by hand**, collecting every `Set-Cookie` on the way (axios would drop cookies from redirects it follows itself). One of the hops sets `laravel_session`.
3. Cache that cookie in memory for 110 minutes (the server sends `Max-Age=7200`).
4. Call `GET {DASHBOARD_URL}/market?path=/daily/<SYMBOL>` with the cookie. It returns `{ data: [ { date: "2026-08-28 16:00:00", open, high, low, close, volume }, … ] }`.
5. Insert rows with `createMany({ skipDuplicates: true })` — the `(security_id, trade_date)` unique key makes re-runs harmless.

Dates from the API have no timezone; the backend takes the `YYYY-MM-DD` part as written so the day does not shift.

If the market API answers `401` mid-run, the cached cookie is thrown away so the next call re-does the hand-off.

**Scope and pacing.** The sync only fetches securities that are held, on a watchlist, or the benchmark. The `securities` table carries the whole exchange (~557 rows) for search, and fetching five years for every row would be hundreds of calls for data nobody views. A symbol whose newest stored bar is already today (Karachi date) is skipped without a request. Calls are spaced one to three seconds apart (section 10.8) so a sync reads as a person browsing rather than a scraper.

**Securities import.** The full symbol list comes from a different endpoint on the **broker** site, `GET /Home/GetSymolsList`, using the broker session rather than the analytics one. It is a one-time import — see endpoint 12.

---

### 10.6 Nightly sync

`src/jobs/dailySync.js`, started from `server.js`. On weekdays it runs **once, at a random time between 18:00 and 23:00 Asia/Karachi** (`SYNC_START_HOUR` and `SYNC_JITTER_MINUTES` in `constants.js`: the job wakes at 18:00 and waits a random slice of the window). If the server starts after 18:00 and no account has synced today, because a restart killed the pending run, it catches up within five minutes. For every broker account that has a stored password and is not disconnected, it does:

1. `brokerLogin` with the decrypted password (`src/utils/secrets.js`, AES-256-GCM, key from `CREDENTIALS_KEY`);
2. `syncAccount` — the same code as `POST /broker/accounts/:id/sync`: trades, holdings, positions, today's close from `mtmPrice`;
3. `syncPricesForAccount` — the same code as `POST /market/sync/:id`: missing daily bars for held + watched symbols and `KSE100`;
4. `saveAllSecuritiesPayoutPerAccount` — the same code as `POST /market/bulk-payouts/sync/:id`: dividends, bonuses and rights for held + watched symbols into `corporate_actions`, which is how announced ex-dates ahead reach the app. Company statements are **not** refreshed here yet (endpoint 25, limitation 26).

`syncStatus` on the account is `syncing` while it runs, `idle` on success (with `lastSyncedAt`), `error` on failure; failures are logged to the console and the next account still runs. The app's Portfolio header shows this as "Synced 8 Sep, 17:32" / "Last sync failed". `POST /broker/accounts/:id/full-sync` runs the same routine on demand.

### 10.7 Token endpoints on the analytics API

Some dashboard endpoints (`company-statement` for fundamentals, `payouts/*`, `news/*`) need a **bearer token as well as the cookie**. Every dashboard page embeds a fresh token in `<meta name="access-token">`, and the previous one stops working. `fetchDashboardApi(path, params, account)` in `services/dashboardApi.js` loads one page per market session to read it, caches it next to the cookie, and on a 401 (a browser tab rotated it) fetches a new one and retries once. The payouts endpoints (20, 21) and the statements endpoints (24, 25) use it.

### 10.8 Looking like the browser

The provider sees one account fetching its own data once a day, which is what a person does; the point is not to *look* like a script. Four rules, all in `services/dashboardApi.js` and `src/utils/pace.js`:

- **Same headers as Chrome on every call** (`apiHeaders`): the browser user-agent, `Accept-Language`, `sec-ch-ua`, `X-Requested-With`, and a `Referer` of the company page the call belongs to (`/research/company/FFC` for FFC's bars). Before this, the price and token calls went out with `User-Agent: axios/1.20.0`.
- **Irregular pacing**: one to three seconds between symbols (`pauseBetweenCalls`), never a fixed interval, never in parallel.
- **A different time every evening** for the nightly job, anywhere in a five-hour window (section 10.6).
- **Stop for the day** on a 429 or a 5xx (`providerSaysStop`): the loop breaks instead of retrying, and the next run is tomorrow's.

Total footprint on a normal night: about 25 price calls and 24 payout calls spread over two or three minutes, once a day, from one account.

## 11. How positions are calculated

`calculatePositions` in `tradeData.js` walks every trade of a portfolio **oldest first**, grouped by stock, and keeps three running numbers:

```
For each trade of a stock, in date order:

  BUY:
    cost      = qty × price + commission
    avgCost   = (avgCost × heldQty + cost) / (heldQty + qty)   ← weighted average
    heldQty   = heldQty + qty

  SELL:
    proceeds    = qty × price − commission
    realizedPnl = realizedPnl + (proceeds − avgCost × qty)
    heldQty     = heldQty − qty                                 ← avgCost unchanged

At the end: if heldQty == 0, avgCost = 0
```

This is the standard **average-cost method**. Buying raises/lowers the average; selling locks in profit against that average and does not change it.

### 11.1 Merging with the broker's live holdings (`mergePositions`)

The broker's holdings list (`GetCollaterals`) is more trustworthy for **quantity** and **average cost** because it already accounts for stock splits and bonus shares (which never appear as trades). So:

- If a stock appears in the broker's holdings → use the broker's `quantityTotal` and `avgRateBuy`, mark `source: "collaterals"`.
- If not (e.g. shares moved to a sub-investor CDC account, or fully sold) → keep our computed values, mark `source: "trades"`.
- `realizedPnl` **always** comes from our trade walk, because the broker reports it as 0.

### 11.2 Spotting mismatches (`reconcilePositions`)

For each stock in both lists, if our quantity ≠ broker quantity, a mismatch is reported (not auto-fixed):

| Field | Meaning |
|---|---|
| `delta` | `brokerQty − ourQty` |
| `impliedRatio` | `brokerQty / ourQty`, e.g. `1.1` = 10 % bonus, `2` = 2-for-1 split |
| `costBasisMatches` | `true` if total cost (`qty × avgCost`) is the same on both sides within 0.1 %. True + positive delta = split/bonus. False = a trade we missed or shares elsewhere. |

---

### 11.3 Bonus shares and splits (`calculatePositions(trades, shareChanges)`)

The walk also receives the `BONUS_SHARE` and `SPLIT` rows from `corporate_actions`, ordered by ex-date. Before each trade it applies every change dated after the previous trade and on or before this one; after the last trade it applies whatever is left (the BAFL split came after the only BAFL buy). Applying one change is three lines:

```javascript
totalCost = avgCost × heldQty
heldQty   = floor(heldQty × ratio)        ← 33 × 2 = 66 for a 2-for-1 split
avgCost   = totalCost / heldQty           ← 66.62 becomes 33.31; the money is unchanged
```

`floor` because 7 % of 33 shares is 2.31 and the exchange pays the 0.31 in cash. A change dated before the first buy acts on zero shares and does nothing, which is why the old bonus rows the feed carries (SYS 2019–2022, MEBL, MARI's ten-for-one in September 2024) are harmless: every one predates the purchase. Verified 2026-09-10 on the live trades: BAFL 33 → 66 shares at 66.62 → 33.31, the other 23 stocks identical.

### 11.4 Mergers (`applyMergers(positions, mergers)`)

After the walk, for each `MERGER` row: the old stock's shares become `floor(quantity × ratio)` shares of `to_security_id` carrying the same total cost, and the old position drops to zero. 8 ENGRO at 330.57 (Rs 2,644) became 17 ENGROH at 155.56; the 0.95 of a share was paid in cash at the time. `mergePositions` then runs as before. ENGROH sits in the sub-investor account, so the computed figures stay, ENGRO disappears from the holdings (the app lists only positions with shares) and the daily price sync picks ENGROH up because it is now held.

Two limits. The merger is applied after the whole walk, not at its date, so a trade in the new stock dated after the merger would be ordered wrongly (there is none today). And `sharesHeldOn` in the dividend income (endpoint 22) does not apply mergers, so ENGROH dividends since the swap are not counted yet.

---

## 12. In-memory sessions

`services/brokderSessionStore.js` keeps two `Map`s in the Node process:

| Store | Key | Value | Lifetime |
|---|---|---|---|
| Broker session | `brokerAccountId` | `{ sessionCookie, cookieJar }` | 15 minutes (with a 30-second safety margin — it is treated as expired 30 s early) |
| Market session | `brokerAccountId` | `{ cookieHeader }` | 110 minutes |

What this means in practice:

- **No cookie or token is saved to the database.** The only stored secret is `credentials_enc`, the broker password encrypted for the nightly sync (section 7.4); `token_expires_at` is never written.
- After 15 minutes of no use, or after any **server restart**, the user must call `POST /broker/accounts` again before syncing.
- If you run more than one server instance (load balancer, PM2 cluster), sessions are **not shared** between them.

---

## 13. Response and error conventions

**Success**

Most endpoints return:

```json
{ "message": "success", "data": { … } }
```

The only exception: disconnect uses a different `message` text.

**Errors that the code handles**

```json
{ "error": "human readable message" }
```

Every endpoint, auth included, uses this shape. Clients can read `error` and show it as is.

**Status codes used**

| Code | Meaning here |
|---|---|
| 200 | OK |
| 201 | Created (register) |
| 400 | Bad input (missing field, duplicate email, short password), **and any problem with the broker or the market data provider**: wrong broker password, session expired, broker unreachable (`BROKER_PROBLEM_STATUS` in `constants.js`). These were 401 until 2026-09-20; the app signs the user out on any 401, so a mistyped broker password used to log people out. |
| 401 | Not logged in or a token problem: our own login only. |
| 404 | Broker account not found or not yours |
| 502 | The broker website did not respond the way we expected |
| 500 | Unexpected error. The global handler in `server.js` answers `{ "error": "Something went wrong." }` and logs the real message to the console. |

---

## 14. Known limitations and things to fix

These are facts about the code as it is today. They are listed so nobody is surprised — not all of them need fixing right away.

**Security**

1. ~~`POST /broker/accounts` returns the broker's `sessionCookie` and full `cookies` to the client.~~ Fixed: the response is now only `brokerAccountId` and `portfolioId`.
2. ~~`src/utils/test.js` contains hard-coded broker credentials and is committed to git.~~ Deleted. Note the credentials remain in git history; change the broker password if that matters.
3. No CORS, `helmet`, or rate limiting is configured. Login and register have no brute-force protection.
4. The `jwt` cookie set by `generateToken.js` has `secure: process.env.NODE_ENV` (a string, not a boolean) and `maxAge: 100*60*60*25*7` = 63,000,000 ms ≈ **17.5 hours**, not 7 days. The cookie is not read by the server anyway (no `cookie-parser`), so only the `Authorization` header works.

**Robustness**

5. ~~No input validation on `/auth/register` and `/auth/login`.~~ Fixed: missing fields, a bad email, or a password under 6 characters return `400 { "error" }`.
6. ~~No global Express error handler → unexpected errors return HTML, not JSON.~~ Fixed: unknown routes return `404 { "error" }` and thrown errors `500 { "error": "Something went wrong." }`, logged to the console.
7. ~~`PATCH …/disconnect` does not clear the in-memory broker session, so `sync` keeps working for up to 15 minutes after "disconnect".~~ Fixed: `disconnectAccount` calls `clearSession`.
8. Broker sessions live only in memory (see section 12): lost on restart, not shared across instances.
9. `POST /market/sync/:id`, `POST /market/bulk-payouts/sync/:id` and `POST /market/bulk-fundamentals/sync/:id` process symbols one at a time inside a single HTTP request, with a random one-to-three-second pause between them (section 10.8), so each takes about a minute for 24 symbols. The nightly job (section 10.6) does the same work unattended, so these requests are only for a manual refresh; a long watchlist would still make them slow.

**Data quality**

10. ~~`securities.company_name` is set to the symbol as a placeholder; `isin` and `sector` are never filled.~~ Mostly fixed: `POST /market/securities/:id` fills real names and sectors from the broker's list. `isin` is still never filled, and names keep the broker's `(XD)` / `(DEF)` suffixes, which change over time.
11. `trades.taxes_levies` is always 0; all charges are lumped into `commission`.
12. Trade `executed_at` only has the date (UTC midnight); the broker does not give a time.
13. The trade fingerprint (section 10.3) depends on the broker's row values. If the broker later changes any value or the date format for old rows, those trades would be imported again as "new".
14. The broker sync writes today's `daily_prices` row with only `close` (from `mtmPrice`), under today's **UTC** date even on weekends. Because the market sync uses `skipDuplicates`, it will not overwrite that row with full open/high/low/volume later. Fixed on 2026-09-09: the price sync now judges "already current" by the newest **provider** row (`volume` not null), so a broker close-only row for today no longer stops the fetch that back-fills the provider's earlier days. Before that fix, the seven broker-priced holdings were missing Monday 7 Sept entirely.
15. ~~Positions computed only from trades can go negative if sells exceed buys (e.g. bonus shares that never appeared as a buy).~~ Fixed: bonus shares, splits and mergers now come from `corporate_actions` and are applied in the walk (sections 11.3, 11.4); the broker's holdings still win for broker-held stocks via `mergePositions`.

**API design**

16. ~~Response shapes are not fully consistent (`message` vs `status`, `error` vs `message`, `token` location).~~ Fixed for auth: register and login now return `{ "message": "success", "data": { "user", "token" } }` and errors as `{ "error" }`. `POST /broker/accounts` still returns only `{ "data": … }`. See section 13.
17. `GET /portfolio/:id/position-list` and `/trade-list` return an empty list (200) for a portfolio that is not yours, instead of 404.
18. The env variable is named `JWR_EXPIRES_IN` (typo). Renaming it means changing both `.env` and `generateToken.js`.
19. `GET /market/trend/:symbol` has no `1D` period. Intraday charts need the minute feed (`/intraday/<SYMBOL>/1D` on the analytics API), which is not stored — `daily_prices` is one row per day.
20. `GET /watchlist` gives only the day's change per row. There is no sparkline (mini 30-day line) per item; it would be a cheap addition if the UI wants one.
21. Period windows in `GET /market/trend` are calendar-based (`6M` ≈ 183 days back), so the point count varies with holidays and listing dates rather than being fixed.

**Corporate actions and dividends**

22. Splits and mergers are not in the provider's payouts feed, so they are entered by hand as `manual` rows in `corporate_actions` (one `INSERT` each, or a small POST route later). Entered so far: BAFL two-for-one on 2026-04-20 and ENGRO → ENGROH at 2.24407865 on 2025-01-14. Entered since: LCI five-for-one on 2025-07-21 and SYS five-for-one on 2025-06-04. Any new split or merger still has to be typed in by hand.
23. Payouts are synced only for held + watched stocks. A stock has no dividend history until it is held or on the watchlist, so a newly held or watched stock has no rows until the next nightly sync runs.
24. `GET /portfolio/:id/dividend-income` is gross: PSX withholds 15 % for filers before the money reaches the account. Since 2026-09-20 merged shares count (ENGROH dividends after the swap), but bonus shares received are still not listed.
25. Dividends before a split or bonus are per *old* share. Anything that sums them across such an event, a twelve-month yield for instance, must divide each one by every later ratio first. Nothing does this yet; raw BAFL sums come out about double.

**Fundamentals and valuation**

26. Company statements are fetched only on demand (endpoints 24, 25); the nightly job does not refresh them, so a stock's valuation can sit on last year's accounts until someone runs the bulk sync.
27. The risk-free rate in the reverse DCF is a constant 11 % in `constants.js`, meant to be the 10-year PIB yield. The provider's `indicators` feed has the live rate; it is not read yet.
28. `GET /market/valuation/:symbol` crashes (500) when `startingCash` finds no positive cash to value: the `if (cash === null)` guard in `valuationController.js` is an empty block, so the code falls through to `cash.cash`. It should answer `applicable: false` with reason "no positive cash to value".
29. The share count assumes a par value of Rs 10 adjusted by recorded splits. A stock with another par (NATF, Rs 5) or an inconsistent provider history (MTL) fails the 5 % cross-check and answers "share count could not be confirmed".
30. Statements are stored in Rs thousands exactly as the provider sends them; the valuation multiplies by 1,000 on the way out. Any new reader must remember the unit.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **AHL / AHL eTrade** | Arif Habib Limited, a Pakistani stock broker, and its online trading website. |
| **PSX** | Pakistan Stock Exchange. |
| **KSE-100 / `KSE100`** | The main PSX index. Stored as a security so its history sits next to stocks. |
| **Scrip / symbol** | Short code for a stock, e.g. `FFC`, `OGDC`. |
| **CDC account** | Central Depository Company account where shares are actually held. The broker's "collaterals" list shows only the CDC account linked to the broker, not a separate "sub-investor" account. |
| **Collaterals** | The broker's word for "shares you currently hold with us". |
| **mtmPrice** | Mark-to-market price — today's market price of a holding, from the broker. |
| **Position** | How many shares of one stock you hold in one portfolio, plus average cost and realised profit. |
| **Average cost** | Total money paid for the shares you still hold ÷ number of shares. |
| **Realised P&L** | Profit or loss already locked in by selling. |
| **Unrealised P&L** | Paper profit or loss on shares you still hold, at today's price. |
| **OHLCV** | Open, High, Low, Close, Volume — one day's price bar. |
| **Upsert** | Database operation: insert the row if it does not exist, otherwise update it. |
| **JWT** | JSON Web Token — the signed login token sent in the `Authorization` header. |
| **Session cookie** | The `.AspNetCore.Session` cookie the broker uses to know you are logged in. |
| **laravel_session** | The cookie the analytics dashboard uses to know you are logged in. |
| **Hand-off** | The one-time URL the broker gives that logs you in to the analytics dashboard without a second password. |
| **Corporate action** | An event decided by the company that changes what a share pays or how many you hold: dividend, bonus shares, right shares, split, merger. Stored in `corporate_actions`. |
| **Ex-date** | The first day a share trades without the announced dividend or bonus. You must own the shares before this day to get it. |
| **TTL** | Time-to-live — how long a cached session is kept before it is thrown away. |

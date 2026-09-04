# Stock Portfolio Backend — Full Documentation

> One document that explains **what this backend does, how it is built, how the database is shaped, and how to call every API**.
> Written in simple English so a new developer or a frontend developer can read it without opening the code.

**Project:** `stock_portfolio_be` · **Author:** Ahmed Faraz · **Last updated:** 2026-09-04

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
| `DASHBOARD_COOKIE` | No | — | Manual fallback: a `laravel_session` cookie copied from a browser. Used only when there is no live broker session. Handy for backfilling prices outside trading hours. |
| `PORT` | No | `5001` | Port the server listens on. |
| `NODE_ENV` | No | — | If set to anything, the `jwt` cookie is marked `secure`. |

---

## 5. Project structure

```
Backend/
├── prisma/
│   ├── schema.prisma            # Database models (source of truth for tables)
│   └── migrations/              # SQL migration history (8 migrations)
├── prisma7.config.ts            # Prisma 7 config: schema path, migrations path, DB URL
├── src/
│   ├── server.js                # Entry point: creates Express app, mounts routes, handles shutdown
│   ├── config/
│   │   ├── db.js                # Creates the Prisma client (with pg adapter); connect/disconnect helpers
│   │   └── constants.js         # Broker URLs, paths, browser headers, status values
│   ├── middlewares/
│   │   └── authMiddleware.js    # Checks the Bearer JWT and loads req.user
│   ├── routes/
│   │   ├── authRoutes.js        # /auth/*
│   │   ├── brokerAccountRoutes.js # /broker/*
│   │   ├── portfolioRoutes.js   # /portfolio/*
│   │   └── marketRoutes.js      # /market/*
│   ├── controllers/
│   │   ├── authController.js    # register, login
│   │   ├── brokerAccountController.js # link broker, list, disconnect, sync trades
│   │   ├── portfolioController.js # portfolio list, positions, trades
│   │   └── marketDataController.js # daily price sync
│   ├── services/
│   │   └── brokderSessionStore.js # In-memory store for broker + market cookies
│   ├── utils/
│   │   ├── extractAHLInfor.js   # Parses broker HTML/cookies, builds login form body
│   │   ├── tradeData.js         # Normalises trades, calculates/merges/reconciles positions
│   │   ├── generateToken.js     # Signs the JWT and sets a cookie
│   │   └── test.js              # Old experiment script — NOT used by the server (see section 14)
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

There are **7 tables**. UUIDs are used as primary keys everywhere except `daily_prices` (which uses a big auto-increment integer because it gets many rows). All money and quantity columns are `DECIMAL(18,4)` so there are no floating-point rounding problems.

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
        text credentials_enc "nullable, unused today"
        timestamptz token_expires_at "nullable, unused today"
        varchar(16) sync_status "idle | disconnected"
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

| Table | Index | Purpose |
|---|---|---|
| `broker_accounts` | `user_id` | Fast "list my accounts". |
| `portfolios` | `user_id` | Fast "list my portfolios". |
| `trades` | `(portfolio_id, executed_at DESC)` | Fast paginated trade list, newest first. |
| `trades` | `security_id` | Fast lookup by stock. |
| `positions` | `security_id` | Fast lookup by stock. |

### 7.4 Table-by-table details

**`users`** — one row per registered person. `password_hash` is a bcrypt hash (10 salt rounds). The plain password is never stored and never returned by any API.

**`broker_accounts`** — a link between a user and one account at a broker. `client_code` is the broker account number the user types in (e.g. `CC12345`). `sync_status` is `idle` normally and `disconnected` after the user unlinks. `credentials_enc` and `token_expires_at` exist in the schema but are **never written** today — the backend does not store broker passwords or cookies in the database (see [section 12](#12-in-memory-sessions)).

**`portfolios`** — a bucket of trades and positions. Today a portfolio is always created automatically when a broker account is linked, and is named `AHL <client_code>`. `base_currency` is always `PKR`.

**`securities`** — the master list of stocks and indexes (e.g. `FFC`, `OGDC`, `KSE100`). Rows are created on-the-fly during sync. Today `company_name` is just set to the symbol, and `isin` / `sector` stay empty.

**`trades`** — every executed buy or sell. `raw_payload` keeps the exact JSON row the broker sent, so nothing is lost if the parsing logic changes later. `broker_trade_id` is a generated fingerprint (see [section 10.3](#103-how-trades-get-a-stable-id)). `source` is always `broker_sync` today.

**`positions`** — the current holding for one stock in one portfolio: how many shares (`quantity`), what they cost on average (`avg_cost`), and profit already locked in from past sells (`realized_pnl`). Recomputed on every sync.

**`daily_prices`** — one row per stock per trading day with open/high/low/close/volume. Filled two ways: the broker sync writes today's close from the broker's `mtmPrice`; the market sync writes full OHLCV history from the analytics API.

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
| 7 | GET | `/portfolio/getPortfolioList` | 🔒 | List my portfolios |
| 8 | GET | `/portfolio/:id/positions` | 🔒 | Current holdings with P&L and a summary |
| 9 | GET | `/portfolio/:id/trades` | 🔒 | Paginated trade history |
| 10 | POST | `/market/sync/:id` | 🔒 | Download ~5 years of daily prices for all securities |

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
  "data": { "id": "3f1c…", "fullName": "Ali Khan" },
  "token": "eyJhbGciOi…"
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "message": "user already exists" }` | Email is already registered. |
| 500 | HTML error page | A required field is missing (no validation yet — see section 14). |

---

#### 2. `POST /auth/login`

**Request body**

```json
{ "email": "ali@example.com", "password": "secret123" }
```

**Success — `200 OK`**

```json
{
  "status": "success",
  "data": {
    "user": { "id": "3f1c…", "fullName": "Ali Khan", "email": "ali@example.com" },
    "token": "eyJhbGciOi…"
  }
}
```

**Errors**

| Status | Body | When |
|---|---|---|
| 401 | `{ "message": "Invalid email or passowrd" }` | Email not found or password wrong (same message for both, on purpose). |

> The response shape of register and login is slightly different (`message` vs `status`, and where `token` sits). Frontend code should handle both.

---

### 9.2 Broker accounts

#### 3. `POST /broker/accounts` 🔒

Links an AHL eTrade account to the logged-in user. The server logs in to the broker website with the given credentials. If login works, it:

- creates (or re-activates) a `broker_accounts` row,
- creates a `portfolios` row named `AHL <accountNumber>` if one does not exist,
- keeps the broker session cookies **in memory for 15 minutes** so the next sync call can reuse them.

The broker password is **not saved** anywhere.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `accountNumber` | string | yes | Broker client code, e.g. `CC12345`. |
| `password` | string | yes | Broker trading password. The broker asks for a few random character positions of it, not the whole thing. |

```json
{ "accountNumber": "CC12345", "password": "MyBrokerPass1" }
```

**Success — `200 OK`**

```json
{
  "data": {
    "brokerAccountId": "8a2e…",
    "portfolioId": "c47b…",
    "status": 302,
    "sessionCookie": ".AspNetCore.Session=CfDJ8…",
    "cookies": { ".AspNetCore.Session": "CfDJ8…", "trader": "CC12345", "HouseName": "AHL" },
    "enabledDigits": [1, 4, 7]
  }
}
```

`brokerAccountId` and `portfolioId` are the values the client needs for later calls. `status`, `sessionCookie`, `cookies` and `enabledDigits` are debug information from the broker login (see section 14 about removing them).

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "accountNumber and password are required." }` | Missing field. |
| 400 | `{ "error": "Password is too short: the broker asked for character 8." }` | The broker asked for a character position beyond the password length. |
| 401 | `{ "error": "Invalid broker credentials." }` | Broker rejected the login. |
| 502 | `{ "error": "No session cookie was returned by the broker login page." }` | Broker site did not behave as expected. |
| 502 | `{ "error": "No enabled Digit fields were found in the broker login page." }` | Broker login page layout changed. |

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

`syncStatus` is `idle` or `disconnected`. `lastSyncedAt` is `null` until the first sync.

---

#### 5. `PATCH /broker/accounts/:id/disconnect` 🔒

Unlinks a broker account. Sets `syncStatus` to `disconnected` and clears the (unused) stored-credential columns. **Trades, positions and the portfolio are kept.**

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
| 401 | `{ "error": "Broker session expired. Reconnect the account to continue." }` | No live session, or the broker answered with its login page instead of data. |
| 404 | `{ "error": "account does not exist" }` | Not found / not yours. |

---

### 9.3 Portfolio

#### 7. `GET /portfolio/getPortfolioList` 🔒

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

#### 8. `GET /portfolio/:id/positions` 🔒

Current holdings with the latest known price and profit/loss numbers. All numbers are real JSON numbers (not strings).

**Path params:** `id` — portfolio UUID.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
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
        "investedValue": 56375,
        "marketValue": 65120,
        "unrealizedPnl": 8745,
        "unrealizedPct": 15.51,
        "realizedPnl": 1200
      }
    ],
    "summary": {
      "invested": 56375,
      "marketValue": 65120,
      "unrealizedPnl": 8745,
      "unrealizedPct": 15.51,
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
| `marketValue` | `quantity × lastPrice` (or `null`) |
| `unrealizedPnl` | `marketValue − investedValue` (or `null`) |
| `unrealizedPct` | `unrealizedPnl / investedValue × 100` (or `null`) |
| `summary.*` | Totals **only over positions that have a price** (`quantity > 0` and `lastPrice` not null). `unpricedPositions` tells the UI how many were left out, so it can show a warning instead of quietly under-reporting. |

If the portfolio is not yours, `positions` is simply an empty array (status 200).

---

#### 9. `GET /portfolio/:id/trades` 🔒

Paginated list of trades, newest first.

**Path params:** `id` — portfolio UUID.

**Query params**

| Param | Default | Max | Notes |
|---|---|---|---|
| `limit` | 50 | 100 | Page size. |
| `offset` | 0 | — | How many rows to skip. |

Example: `GET /portfolio/c47b…/trades?limit=20&offset=40`

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

### 9.4 Market data

#### 10. `POST /market/sync/:id` 🔒

Downloads daily price history (about 5 years of open/high/low/close/volume) for **every security in the database**, plus the `KSE100` index as a benchmark. Safe to re-run: existing days are skipped, so the first run backfills and later runs only add new days.

The `:id` is a **broker account** id, because the market API needs a session that is obtained by following that account's analytics hand-off (see [section 10.5](#105-getting-market-data-prices)). If there is no live broker session but `DASHBOARD_COOKIE` is set in `.env`, that cookie is used instead.

**Path params:** `id` — broker account UUID.

**Success — `200 OK`**

```json
{
  "message": "success",
  "data": {
    "securities": 13,
    "newRows": 15402,
    "results": [
      { "symbol": "FFC", "fetched": 1240, "saved": 1240 },
      { "symbol": "KSE100", "fetched": 1240, "saved": 1240 },
      { "symbol": "XYZ", "error": 404 }
    ]
  }
}
```

Each item in `results` is either `{ symbol, fetched, saved }` or `{ symbol, error }` where `error` is an HTTP status or message. One failing symbol does not stop the others.

**Errors**

| Status | Body | When |
|---|---|---|
| 401 | `{ "error": "Broker session expired. Reconnect the account so a market session can be issued." }` | No broker session and no `DASHBOARD_COOKIE`. |
| 401 | `{ "error": "The broker did not return an analytics URL." }` / `"The dashboard handoff did not return a session cookie."` | Hand-off to the analytics site failed. |
| 404 | `{ "error": "account does not exist" }` | Not found / not yours. |

> This call fetches symbols one after another and can take a while (many seconds to minutes) when there are many securities. The HTTP request stays open until it finishes.

---

## 10. How the broker integration works

The broker (AHL eTrade) has no API. The backend pretends to be a Chrome browser: it sends the same headers a browser sends, keeps the cookies the site gives back, and parses the HTML it receives. All of this lives in `brokerAccountController.js`, `marketDataController.js`, `extractAHLInfor.js` and `constants.js`.

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
    API->>B: GET / (login page)
    B-->>API: HTML + Set-Cookie .AspNetCore.Session
    Note over API: Parse which "DigitN" inputs are enabled,<br/>e.g. [1, 4, 7]
    API->>B: POST /Home/_Login<br/>UserName=CC12345&Digit1=M&Digit4=r&Digit7=e<br/>(cookie: session)
    B-->>API: HTML (+ refreshed cookies: session, trader, HouseName)
    alt HTML contains "Invalid Login Credentials"
        API-->>C: 401 Invalid broker credentials
    else login OK
        API->>DB: upsert broker_accounts (user, AHL_ETRADE, clientCode)
        API->>DB: upsert portfolios (name "AHL CC12345")
        API->>M: saveSession(brokerAccountId, cookies) — 15 min TTL
        API-->>C: 200 {brokerAccountId, portfolioId, …}
    end
```

Key points:

- **Partial password.** The broker's login form shows one input per password character but only enables a few random positions each time. The backend reads the HTML to find which positions are enabled and sends only those characters (`buildLoginBody`). This is why the whole password is needed in the request but only some characters go to the broker.
- **No redirects.** Axios is told `maxRedirects: 0`. A successful login answers with a `302` and the cookies we need are on that response; following the redirect would lose them.
- **Failure detection.** The broker returns HTTP 200 even on a wrong password. The only signal is the text `Invalid Login Credentials` in the HTML.

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

---

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

## 12. In-memory sessions

`services/brokderSessionStore.js` keeps two `Map`s in the Node process:

| Store | Key | Value | Lifetime |
|---|---|---|---|
| Broker session | `brokerAccountId` | `{ sessionCookie, cookieJar }` | 15 minutes (with a 30-second safety margin — it is treated as expired 30 s early) |
| Market session | `brokerAccountId` | `{ cookieHeader }` | 110 minutes |

What this means in practice:

- **Nothing about the broker login is saved to the database.** `credentials_enc` and `token_expires_at` in `broker_accounts` are never written.
- After 15 minutes of no use, or after any **server restart**, the user must call `POST /broker/accounts` again before syncing.
- If you run more than one server instance (load balancer, PM2 cluster), sessions are **not shared** between them.

---

## 13. Response and error conventions

**Success**

Most endpoints return:

```json
{ "message": "success", "data": { … } }
```

Exceptions: `POST /auth/login` uses `"status": "success"`; `POST /broker/accounts` returns only `{ "data": … }`; disconnect uses a different `message` text.

**Errors that the code handles**

```json
{ "error": "human readable message" }
```

Auth endpoints use `{ "message": "…" }` instead of `error`.

**Status codes used**

| Code | Meaning here |
|---|---|
| 200 | OK |
| 201 | Created (register) |
| 400 | Bad input (missing field, duplicate email, short password) |
| 401 | Not logged in / token problem / broker session expired / broker login wrong |
| 404 | Broker account not found or not yours |
| 502 | The broker website did not respond the way we expected |
| 500 | Unexpected error. There is **no global error handler**, so Express 5 returns its default **HTML** error page, not JSON. |

---

## 14. Known limitations and things to fix

These are facts about the code as it is today. They are listed so nobody is surprised — not all of them need fixing right away.

**Security**

1. `POST /broker/accounts` returns the broker's `sessionCookie` and full `cookies` to the client. The client does not need them; they should be removed from the response.
2. `src/utils/test.js` is an old experiment (it references an `app` that is never defined, so it cannot run). It contains **hard-coded fallback broker credentials** and is committed to git. It should be deleted or moved out of the repo.
3. No CORS, `helmet`, or rate limiting is configured. Login and register have no brute-force protection.
4. The `jwt` cookie set by `generateToken.js` has `secure: process.env.NODE_ENV` (a string, not a boolean) and `maxAge: 100*60*60*25*7` = 63,000,000 ms ≈ **17.5 hours**, not 7 days. The cookie is not read by the server anyway (no `cookie-parser`), so only the `Authorization` header works.

**Robustness**

5. No input validation on `/auth/register` and `/auth/login`. A missing `email` or `password` causes a crash inside Prisma/bcrypt → HTML 500 page.
6. No global Express error handler → unexpected errors return HTML, not JSON.
7. `PATCH …/disconnect` does not clear the in-memory broker session, so `sync` keeps working for up to 15 minutes after "disconnect".
8. Broker sessions live only in memory (see section 12): lost on restart, not shared across instances.
9. `POST /market/sync/:id` processes symbols one at a time inside a single HTTP request. With many securities it is slow and could hit client timeouts. A background job would be better.

**Data quality**

10. `securities.company_name` is set to the symbol as a placeholder; `isin` and `sector` are never filled.
11. `trades.taxes_levies` is always 0; all charges are lumped into `commission`.
12. Trade `executed_at` only has the date (UTC midnight); the broker does not give a time.
13. The trade fingerprint (section 10.3) depends on the broker's row values. If the broker later changes any value or the date format for old rows, those trades would be imported again as "new".
14. The broker sync writes today's `daily_prices` row with only `close` (from `mtmPrice`), under today's **UTC** date even on weekends. Because the market sync uses `skipDuplicates`, it will not overwrite that row with full open/high/low/volume later.
15. Positions computed only from trades can go negative if sells exceed buys (e.g. bonus shares that never appeared as a buy). The broker's holdings usually correct this via `mergePositions`.

**API design**

16. Response shapes are not fully consistent (`message` vs `status`, `error` vs `message`, `token` location). See section 13.
17. `GET /portfolio/:id/positions` and `/trades` return an empty list (200) for a portfolio that is not yours, instead of 404.
18. The env variable is named `JWR_EXPIRES_IN` (typo). Renaming it means changing both `.env` and `generateToken.js`.

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
| **TTL** | Time-to-live — how long a cached session is kept before it is thrown away. |

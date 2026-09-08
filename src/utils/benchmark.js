
const INDEX = "KSE100";
const DAY_MS = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365.25 * DAY_MS;

// Calendar days between two "YYYY-MM-DD" dates.
const daysBetween = (from, to) => (new Date(to) - new Date(from)) / DAY_MS;

// A holding is kept in today's share units. To count shares as they were on
// an earlier day, divide out the splits and bonuses that came after it.
const unitsFactorAfter = (symbol, day, actions) => {
  let factor = 1;
  for (const action of actions) {
    if (action.symbol === symbol && action.type !== "MERGER" && action.exDate > day) {
      factor *= action.ratio;
    }
  }
  return factor;
};

// Latest close on or before `date`.
const closeOnOrBefore = (closes, date) => {
  let found = null;
  for (const [day, close] of closes) {
    if (day > date) break;
    found = close;
  }
  return found;
};

// First bar on or after `date` (a buy date can land on a weekend).
const barOnOrAfter = (closes, date) => {
  for (const [day, close] of closes) {
    if (day >= date) return { date: day, close };
  }
  return null;
};

// Rupees that left on a BUY (positive) or came back on a SELL (negative).
const cashOut = (trade) =>
  trade.side === "BUY"
    ? trade.quantity * trade.price + trade.commission
    : -(trade.quantity * trade.price - trade.commission);

// The price history is stored already divided for past splits. So a trade
// priced far above that day's stored close reveals a split: paying 511 when
// the stored close is 101 means 5:1, and every trade up to that day must
// count 5x when valuing holdings.
export const detectAdjustedSplits = (trades, prices) => {
  const splits = {};
  for (const trade of trades) {
    const storedClose = prices[trade.symbol]?.get(trade.date);
    if (!storedClose) continue;

    const ratio = trade.price / storedClose;
    if (ratio < 1.6) continue;

    const known = splits[trade.symbol];
    if (!known || trade.date > known.lastPreDate) {
      splits[trade.symbol] = { ratio: Math.round(ratio), lastPreDate: trade.date };
    }
  }
  return splits;
};

// Every trading day from the first trade: KSE100 bar dates plus trade dates.
const tradingDays = (trades, prices) => {
  const firstTradeDate = trades[0].date;
  const days = new Set(trades.map((trade) => trade.date));
  for (const day of prices[INDEX].keys()) {
    if (day >= firstTradeDate) days.add(day);
  }
  return [...days].sort();
};

// A lookup of close per symbol per trading day. A day with no bar keeps the
// last close before it; before the first bar the close is 0.
const priceLookup = (prices, days) => {
  const filled = {};
  for (const [symbol, closes] of Object.entries(prices)) {
    const perDay = new Map();
    let last = 0;
    for (const day of [...new Set([...closes.keys(), ...days])].sort()) {
      if (closes.has(day)) last = closes.get(day);
      perDay.set(day, last);
    }
    filled[symbol] = perDay;
  }
  return (symbol, day) => filled[symbol]?.get(day) ?? 0;
};

// Corporate actions, as the controller loads them:
//   [{ symbol, type: "SPLIT" | "BONUS" | "MERGER", exDate, ratio, toSymbol }]
// Prices are already adjusted for splits and bonus shares, so a trade made
// before one counts ratio× more shares today.
const sharesToday = (trade, actions) => {
  let ratio = 1;
  for (const action of actions) {
    if (action.symbol === trade.symbol && action.type !== "MERGER" && action.exDate > trade.date) {
      ratio *= action.ratio;
    }
  }
  return trade.quantity * ratio;
};

// Trades restated in today's units and symbols, for the per-position table.
export const restateTrades = (trades, actions) =>
  trades.map((trade) => {
    let symbol = trade.symbol;
    let ratio = 1;
    for (const action of actions) {
      if (action.symbol !== symbol || action.exDate <= trade.date) continue;
      ratio *= action.ratio;
      if (action.type === "MERGER") symbol = action.toSymbol;
    }
    return { ...trade, symbol, quantity: trade.quantity * ratio, price: trade.price / ratio };
  });

// Walks the portfolio one trading day at a time. Returns two lines that both
// start at 100 on the first trade:
//   portfolio – time-weighted: each day, value yesterday's holdings at
//               today's prices (plus any dividend that went ex today) and
//               chain the change, THEN apply today's trades. Money added
//               never moves the line. Dividends count as return on the day
//               and are then treated as paid out in cash.
//   benchmark – KSE100 rebased to the first trade, credited with the index's
//               own dividends at `indexYield` a year so the race is fair.
// Every rupee spent also buys KSE100 units that day, which gives the
// "same money into the index" shadow value.
// dividends: [{ symbol, exDate, amount }] with amount in Rs per share as of
// that day.
export const walkPortfolio = (trades, prices, actions = [], dividends = [], indexYield = 0) => {
  const days = tradingDays(trades, prices);
  const priceOf = priceLookup(prices, days);
  const tradesOn = Object.groupBy(trades, (trade) => trade.date);

  // An ex-date can fall on a holiday; count the dividend on the next trading day.
  const firstTradingDayFrom = (date) => days.find((day) => day >= date);
  const dividendsOn = Object.groupBy(
    dividends.filter((dividend) => firstTradingDayFrom(dividend.exDate)),
    (dividend) => firstTradingDayFrom(dividend.exDate),
  );
  const mergersOn = Object.groupBy(
    actions.filter((action) => action.type === "MERGER"),
    (action) => action.exDate,
  );

  // The index with its dividends reinvested: price × a factor that grows at
  // indexYield a year. Units are bought and valued at this level.
  let indexAccrual = 1;
  let previousDay = days[0];
  const indexLevel = (day) => priceOf(INDEX, day) * indexAccrual;
  const indexStart = indexLevel(days[0]);

  const sharesBought = (trade) => sharesToday(trade, actions);

  // Cash from dividends going ex today, for the shares held right now.
  const dividendCashOn = (day, holdings) => {
    let cash = 0;
    for (const dividend of dividendsOn[day] ?? []) {
      const sharesThen =
        (holdings[dividend.symbol] ?? 0) / unitsFactorAfter(dividend.symbol, day, actions);
      if (sharesThen > 0) cash += sharesThen * dividend.amount;
    }
    return cash;
  };

  const holdings = {};
  const valueOn = (day) => {
    let total = 0;
    for (const [symbol, quantity] of Object.entries(holdings)) {
      total += quantity * priceOf(symbol, day);
    }
    return total;
  };

  let line = 100;
  let valueYesterday = 0;
  let netCashIn = 0;
  let indexUnits = 0;
  let dividendsReceived = 0;
  const dividendFlows = [];
  let portfolioPeak = 0;
  let portfolioWorstFall = 0;
  let indexPeak = 0;
  let indexWorstFall = 0;
  const series = [];

  for (const day of days) {
    // 0. the index earns its dividends too, spread over the calendar
    indexAccrual *= (1 + indexYield) ** (daysBetween(previousDay, day) / 365);
    previousDay = day;

    // 1. how did what I already owned do today, dividend included?
    const dividendCash = dividendCashOn(day, holdings);
    if (valueYesterday > 0) line *= (valueOn(day) + dividendCash) / valueYesterday;
    if (dividendCash > 0) {
      dividendsReceived += dividendCash;
      dividendFlows.push({ date: day, amount: dividendCash });
    }

    // 2. now apply today's trades
    for (const trade of tradesOn[day] ?? []) {
      const cash = cashOut(trade);
      netCashIn += cash;
      indexUnits += cash / indexLevel(day);
      const change = trade.side === "BUY" ? sharesBought(trade) : -trade.quantity;
      holdings[trade.symbol] = (holdings[trade.symbol] ?? 0) + change;
    }

    // 3. a merger swaps the old shares for the new symbol (fractions are paid in cash)
    for (const merger of mergersOn[day] ?? []) {
      const oldShares = holdings[merger.symbol] ?? 0;
      if (oldShares <= 0) continue;
      holdings[merger.toSymbol] = (holdings[merger.toSymbol] ?? 0) + Math.floor(oldShares * merger.ratio);
      holdings[merger.symbol] = 0;
    }

    const valueToday = valueOn(day);
    const benchmark = (indexLevel(day) / indexStart) * 100;

    portfolioPeak = Math.max(portfolioPeak, line);
    portfolioWorstFall = Math.min(portfolioWorstFall, line / portfolioPeak - 1);
    indexPeak = Math.max(indexPeak, benchmark);
    indexWorstFall = Math.min(indexWorstFall, benchmark / indexPeak - 1);

    series.push({
      date: day,
      portfolio: line,
      benchmark,
      value: valueToday,
      netCashIn,
      dividends: dividendsReceived,
      shadow: indexUnits * indexLevel(day),
    });
    valueYesterday = valueToday;
  }

  const last = series[series.length - 1];
  return {
    series,
    netCashIn,
    dividendsReceived,
    dividendFlows,
    portfolioValue: last.value,
    shadowValue: last.shadow,
    portfolioReturn: last.portfolio - 100,
    benchmarkReturn: last.benchmark - 100,
    maxDrawdown: { portfolio: portfolioWorstFall * 100, benchmark: indexWorstFall * 100 },
  };
};

// Annualised money-weighted return, found by bisection.
// flows: [{ date, amount }] with money paid in negative and money back positive.
export const xirr = (flows) => {
  const start = new Date(flows[0].date);
  const yearsFromStart = (date) => (new Date(date) - start) / MS_PER_YEAR;

  const netPresentValue = (rate) => {
    let total = 0;
    for (const flow of flows) {
      total += flow.amount / (1 + rate) ** yearsFromStart(flow.date);
    }
    return total;
  };

  let low = -0.99;
  let high = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (netPresentValue(low) * netPresentValue(mid) <= 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
};

// Cost-weighted average of the buy dates: a big buy pulls it more than a small one.
const averageBuyDate = (buys) => {
  let cost = 0;
  let weightedTime = 0;
  for (const buy of buys) {
    const spent = buy.quantity * buy.price + buy.commission;
    cost += spent;
    weightedTime += spent * new Date(buy.date).getTime();
  }
  return new Date(weightedTime / cost).toISOString().slice(0, 10);
};

// Each open position against KSE100 since the day it was bought. Dividends
// received since then count towards the stock, and the index is credited
// with `indexYield` a year over the same window.
export const positionsVsBenchmark = (
  positions,
  trades,
  prices,
  asOf,
  dividends = [],
  actions = [],
  indexYield = 0,
) => {
  const index = prices[INDEX];
  const indexNow = closeOnOrBefore(index, asOf);
  const rows = [];

  for (const position of positions) {
    if (position.quantity <= 0) continue;

    const lastPrice = closeOnOrBefore(prices[position.symbol] ?? new Map(), asOf);
    if (!lastPrice) continue;

    const buys = trades.filter(
      (trade) => trade.symbol === position.symbol && trade.side === "BUY",
    );
    // No buys on record means the shares arrived another way (a merger the
    // position table has not caught up with yet); nothing to measure from.
    if (buys.length === 0) continue;
    const boughtOn = barOnOrAfter(index, averageBuyDate(buys));
    if (!boughtOn) continue;

    // Dividends per share since the buy date, in today's share units.
    let dividendsPerShare = 0;
    for (const dividend of dividends) {
      const sinceBuy = dividend.exDate > boughtOn.date && dividend.exDate <= asOf;
      if (dividend.symbol !== position.symbol || !sinceBuy) continue;
      dividendsPerShare += dividend.amount / unitsFactorAfter(position.symbol, dividend.exDate, actions);
    }

    const years = daysBetween(boughtOn.date, asOf) / 365;
    const stockReturn = ((lastPrice + dividendsPerShare) / position.avgCost - 1) * 100;
    const benchmarkReturn = ((indexNow / boughtOn.close) * (1 + indexYield) ** years - 1) * 100;

    rows.push({
      symbol: position.symbol,
      quantity: position.quantity,
      avgCost: position.avgCost,
      lastPrice,
      dividendsPerShare,
      buyDate: boughtOn.date,
      stockReturn,
      benchmarkReturn,
      alpha: stockReturn - benchmarkReturn,
      costBasis: position.quantity * position.avgCost,
    });
  }

  const totalCost = rows.reduce((sum, row) => sum + row.costBasis, 0);
  for (const row of rows) row.weight = (row.costBasis / totalCost) * 100;
  return rows.sort((a, b) => b.costBasis - a.costBasis);
};

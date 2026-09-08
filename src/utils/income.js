// Dividend income worked out from trades and the recorded corporate actions.
// Pure functions: no database.
//
// trades:    [{ securityId, side, quantity, executedAt: Date }], oldest first
// actions:   [{ securityId, type, exDate: Date, ratio, amount, toSecurityId }], oldest first
// positions: [{ securityId, symbol, quantity, avgCost, lastPrice }]
import { applyCorporateActions } from "./tradeData.js";

// Withholding tax on dividends for a tax filer.
export const DIVIDEND_TAX_RATE = 0.15;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pakistan's fiscal year runs July to June: FY2027 is Jul 2026 – Jun 2027.
export const fiscalYearOf = (date) =>
  date.getUTCFullYear() + (date.getUTCMonth() >= 6 ? 1 : 0);

// The last weekday before `date` — the day you must own the shares by.
const previousWeekday = (date) => {
  const day = new Date(date);
  do {
    day.setUTCDate(day.getUTCDate() - 1);
  } while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  return day;
};

const changesShareCount = (action) =>
  action.type === "SPLIT" || action.type === "BONUS" || action.type === "MERGER";

const afterTax = (gross) => ({ gross, net: gross * (1 - DIVIDEND_TAX_RATE) });

// Shares of each security held on `date`, in that date's share units.
const sharesOn = (trades, actions, date) => {
  const tradesBefore = trades.filter((trade) => trade.executedAt < date);
  const actionsBefore = actions.filter(
    (action) => changesShareCount(action) && action.exDate <= date,
  );

  const held = {};
  for (const trade of applyCorporateActions(tradesBefore, actionsBefore)) {
    const change = trade.side === "BUY" ? trade.quantity : -trade.quantity;
    held[trade.securityId] = (held[trade.securityId] ?? 0) + change;
  }
  return held;
};

// Every dividend the portfolio was entitled to so far: shares held on the
// ex-date times the amount per share. Newest first. Announced dividends that
// have not gone ex yet are listed separately as "upcoming".
export const entitledDividends = (trades, actions, symbolOf, today) => {
  const rows = [];
  for (const action of actions) {
    if (action.type !== "DIVIDEND" || action.exDate > today) continue;

    const shares = sharesOn(trades, actions, action.exDate)[action.securityId] ?? 0;
    if (shares <= 0) continue;

    rows.push({
      symbol: symbolOf(action.securityId),
      exDate: action.exDate,
      amount: action.amount,
      shares,
      ...afterTax(shares * action.amount),
    });
  }
  return rows.sort((a, b) => b.exDate - a.exDate);
};

// The whole income picture for the Portfolio tab.
export const incomeSummary = ({ trades, actions, positions, watchedIds, symbolOf, today }) => {
  const entitled = entitledDividends(trades, actions, symbolOf, today);
  const sumGross = (rows) => rows.reduce((sum, row) => sum + row.gross, 0);

  const thisFiscalYear = fiscalYearOf(today);
  const yearAgo = new Date(today.getTime() - 365 * DAY_MS);
  const thisYear = entitled.filter((row) => fiscalYearOf(row.exDate) === thisFiscalYear);
  const lastTwelveMonths = entitled.filter((row) => row.exDate > yearAgo);

  // Dividend per share paid over the last twelve months, per security.
  const trailingDps = {};
  for (const action of actions) {
    if (action.type === "DIVIDEND" && action.exDate > yearAgo && action.exDate <= today) {
      trailingDps[action.securityId] = (trailingDps[action.securityId] ?? 0) + action.amount;
    }
  }

  const holdings = positions
    .map((position) => {
      const dps = trailingDps[position.securityId] ?? 0;
      const next = actions.find(
        (action) =>
          action.type === "DIVIDEND" &&
          action.securityId === position.securityId &&
          action.exDate > today,
      );
      return {
        symbol: position.symbol,
        shares: position.quantity,
        avgCost: position.avgCost,
        lastPrice: position.lastPrice,
        trailingDps: dps,
        projected: position.quantity * dps,
        yieldOnCost: position.avgCost > 0 ? (dps / position.avgCost) * 100 : null,
        currentYield: position.lastPrice > 0 ? (dps / position.lastPrice) * 100 : null,
        thisYear: sumGross(thisYear.filter((row) => row.symbol === position.symbol)),
        nextExDate: next?.exDate ?? null,
      };
    })
    .sort((a, b) => b.projected - a.projected);

  const projectedGross = holdings.reduce((sum, holding) => sum + holding.projected, 0);
  const costBasis = positions.reduce((sum, p) => sum + p.quantity * p.avgCost, 0);
  const marketValue = positions.reduce((sum, p) => sum + p.quantity * (p.lastPrice ?? 0), 0);

  // Dividends announced but not yet gone ex, on held and watched stocks.
  const positionOf = new Map(positions.map((position) => [position.securityId, position]));
  const upcoming = actions
    .filter(
      (action) =>
        action.type === "DIVIDEND" &&
        action.exDate >= today &&
        (positionOf.has(action.securityId) || watchedIds.has(action.securityId)),
    )
    .map((action) => {
      const position = positionOf.get(action.securityId);
      return {
        symbol: symbolOf(action.securityId),
        exDate: action.exDate,
        buyBefore: previousWeekday(action.exDate),
        amount: action.amount,
        held: Boolean(position),
        shares: position?.quantity ?? 0,
        expected: position ? afterTax(position.quantity * action.amount) : null,
      };
    });

  // Income by fiscal year, latest first.
  const grossByYear = new Map();
  for (const row of entitled) {
    const year = fiscalYearOf(row.exDate);
    grossByYear.set(year, (grossByYear.get(year) ?? 0) + row.gross);
  }
  const byYear = [...grossByYear]
    .sort((a, b) => b[0] - a[0])
    .map(([fiscalYear, gross]) => ({ fiscalYear, ...afterTax(gross) }));

  return {
    thisYear: { fiscalYear: thisFiscalYear, dividends: thisYear.length, ...afterTax(sumGross(thisYear)) },
    lastTwelveMonths: { dividends: lastTwelveMonths.length, ...afterTax(sumGross(lastTwelveMonths)) },
    projected: {
      ...afterTax(projectedGross),
      yieldOnCost: costBasis > 0 ? (projectedGross / costBasis) * 100 : null,
      currentYield: marketValue > 0 ? (projectedGross / marketValue) * 100 : null,
    },
    byYear,
    upcoming,
    holdings,
    entitled: entitled.slice(0, 20),
    taxRate: DIVIDEND_TAX_RATE,
  };
};

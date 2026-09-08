import crypto from "node:crypto";

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export const normalizeTradeRows = (rows) => {
  const seen = new Map();
  const normalizeRows = rows?.map((value) => {
    const rowKey = `${value?.scrip}|${value?.quantity}|${value?.grossRate}|${value?.netAmount}|${value?.type}|${value?.executionDate}`;
    const hash = crypto.createHash("sha1").update(rowKey).digest("hex");
    const n = seen.get(hash) ?? 0; // how many identical rows so far?
    seen.set(hash, n + 1); // remember for the next one

    const side = value?.type?.toUpperCase() === "SELL" ? "SELL" : "BUY";
    const gross = value?.quantity * value?.grossRate;
    const net = Math.abs(value?.netAmount);
    const [month, day, year] = value?.executionDate
      ?.replace(",", "")
      .split(" ");

    return {
      symbol: value?.scrip,
      side,
      quantity: value?.quantity,
      price: value?.grossRate,
      netAmount: net,
      commission: side === "SELL" ? gross - net : net - gross,
      taxesLevies: 0,
      executedAt: new Date(Date.UTC(Number(year), MONTHS[month], Number(day))),
      brokerTradeId: `${hash}:${n}`,
      rawPayload: {
        ...value,
      },
    };
  });
  return normalizeRows;
};

// Folds the broker's collaterals into the positions computed from trades.
//
// GetCollaterals lists only what sits in the broker-linked CDC account, and it
// is already adjusted for splits and bonus issues — so where a symbol appears
// there, its quantity and average cost are more current than anything we can
// derive from trades. Symbols missing from it are held in the sub-investor CDC
// account; those keep the computed figures.
//
// realizedPnl always comes from the trade walk: collaterals reports plSettled
// as 0 and knows nothing about closed positions.
export const mergePositions = ({ computed, collaterals, securityIdBySymbol }) => {
  const bySecurityId = new Map(
    (computed ?? []).map((p) => [p.securityId, { ...p, source: "trades" }]),
  );

  for (const row of collaterals ?? []) {
    const securityId = securityIdBySymbol.get(row?.symbol);
    if (!securityId) continue;

    const fromTrades = bySecurityId.get(securityId);
    bySecurityId.set(securityId, {
      securityId,
      quantity: Number(row?.quantityTotal),
      avgCost: Number(row?.avgRateBuy),
      realizePnl: fromTrades?.realizePnl ?? 0,
      source: "collaterals",
    });
  }

  return [...bySecurityId.values()];
};

// Symbols where the broker's share count disagrees with ours. A positive delta
// with a matching cost basis means a split or bonus we never saw; a negative one
// means either shares sitting in the sub-investor account or a missed sell.
export const reconcilePositions = ({ computed, collaterals, securityIdBySymbol }) => {
  const bySecurityId = new Map((computed ?? []).map((p) => [p.securityId, p]));
  const mismatches = [];

  for (const row of collaterals ?? []) {
    const securityId = securityIdBySymbol.get(row?.symbol);
    const ours = securityId ? bySecurityId.get(securityId) : undefined;
    if (!ours) continue;

    const brokerQty = Number(row?.quantityTotal);
    if (ours.quantity === brokerQty) continue;

    const ourCost = ours.quantity * ours.avgCost;
    const brokerCost = brokerQty * Number(row?.avgRateBuy);

    mismatches.push({
      symbol: row.symbol,
      computedQty: ours.quantity,
      brokerQty,
      delta: brokerQty - ours.quantity,
      impliedRatio: Number((brokerQty / ours.quantity).toFixed(6)),
      // Unchanged total cost is the signature of a split or bonus rather than a
      // trade we failed to import.
      costBasisMatches: Math.abs(ourCost - brokerCost) < Math.max(1, ourCost * 0.001),
    });
  }

  return mismatches;
};

// Restates trades in today's share units. Prices and the broker's holdings
// are already adjusted for splits and bonus shares, so a trade made before
// one must be scaled the same way: quantity × ratio, price ÷ ratio, for every
// SPLIT or BONUS dated after the trade. A MERGER also moves the trade to the
// new security. actions: [{ securityId, type, exDate, ratio, toSecurityId }].
export const applyCorporateActions = (trades, actions = []) => {
  if (actions.length === 0) return trades;
  const byDate = [...actions].sort((a, b) => a.exDate - b.exDate);

  return trades.map((trade) => {
    let securityId = trade.securityId;
    let ratio = 1;
    let merged = false;
    for (const action of byDate) {
      if (action.securityId !== securityId || action.exDate <= trade.executedAt) continue;
      ratio *= Number(action.ratio);
      if (action.type === "MERGER") {
        securityId = action.toSecurityId;
        merged = true;
      }
    }
    // A merger pays the fraction in cash, so 8 × 2.244 is 17 shares, not 17.95.
    const quantity = Number(trade.quantity) * ratio;
    return {
      ...trade,
      securityId,
      quantity: merged ? Math.floor(quantity) : quantity,
      price: Number(trade.price) / ratio,
    };
  });
};

export const calculatePositions = (trades, actions = []) => {
  let groupedData = Object.groupBy(
    applyCorporateActions(trades, actions),
    (trade) => trade.securityId,
  );
  let parsData = Object.entries(groupedData).map(([key, value]) => {
    let stockQty = 0;
    let avgCost = 0;
    let realizePnl = 0;
    value.forEach((element) => {
      const qty = Number(element?.quantity);
      const price = Number(element?.price);
      const commission = Number(element?.commission);
      if (element?.side === "BUY") {
        const cost = qty * price + commission;
        avgCost = (avgCost * stockQty + cost) / (stockQty + qty);
        stockQty = stockQty + qty;
      } else {
        const proceeds = qty * price - commission;
        realizePnl = realizePnl + (proceeds - avgCost * qty);
        stockQty = stockQty - qty;
      }
    });
    if (stockQty === 0) avgCost = 0;
    return { securityId: key, quantity: stockQty, avgCost, realizePnl };
  });
  return parsData;
};

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

export const calculatePositions = (trades) => {
  let groupedData = Object.groupBy(trades, (trade) => trade.securityId);
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

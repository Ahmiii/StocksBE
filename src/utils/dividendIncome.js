import { calculatePositions } from "./tradeData.js";

//how many shares of a stock were held on a date, shares bought on that date do not count
export const sharesHeldOn = (trades, shareChanges, securityId, date) => {
  const tradesBefore = [];
  for (const trade of trades) {
    if (trade.securityId === securityId && trade.executedAt < date) {
      tradesBefore.push(trade);
    }
  }
  const changesBefore = [];
  for (const change of shareChanges) {
    if (change.securityId === securityId && change.exDate < date) {
      changesBefore.push(change);
    }
  }
  const positions = calculatePositions(tradesBefore, changesBefore);
  if (positions.length === 0) {
    return 0;
  }
  return positions[0].quantity;
};
//every dividend you were entitled to, shares held on the ex date times rupees per share
export const dividendsReceived = (
  trades,
  shareChanges,
  dividends,
  symbolOf,
) => {
  const received = [];
  for (const dividend of dividends) {
    const shares = sharesHeldOn(
      trades,
      shareChanges,
      dividend.securityId,
      dividend.exDate,
    );
    if (shares === 0) {
      continue;
    }
    const perShare = Number(dividend.amount);
    received.push({
      symbol: symbolOf[dividend.securityId],
      exDate: dividend.exDate,
      perShare,
      shares,
      rupees: shares * perShare,
    });
  }
  return received;
};

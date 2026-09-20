import { calculatePositions } from "./tradeData.js";

//how many shares of a stock were held on a date, shares bought on that date do not count.
//mergers is optional: shares that came from a stock that was swapped into this one are added
export const sharesHeldOn = (trades, shareChanges, securityId, date, mergers = []) => {
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
  let shares = 0;
  if (positions.length > 0) {
    shares = positions[0].quantity;
  }

  //a merger before that date, like ENGRO into ENGROH: the old stock's shares on the merger day, times the ratio, whole shares only
  for (const merger of mergers) {
    if (merger.toSecurityId === securityId && merger.exDate < date) {
      const oldShares = sharesHeldOn(trades, shareChanges, merger.securityId, merger.exDate);
      shares = shares + Math.floor(oldShares * Number(merger.ratio));
    }
  }
  return shares;
};
//every dividend you were entitled to, shares held on the ex date times rupees per share
export const dividendsReceived = (
  trades,
  shareChanges,
  dividends,
  symbolOf,
  mergers = [],
) => {
  const received = [];
  for (const dividend of dividends) {
    const shares = sharesHeldOn(
      trades,
      shareChanges,
      dividend.securityId,
      dividend.exDate,
      mergers,
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

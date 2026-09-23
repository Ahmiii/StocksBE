//one statement's values by year, like { TTM: 9692006, "2025": 11638410 }.
//periods[i] goes with values[i]. a year with no number is left out
export const byYear = (payload, key) => {
  const valuesByYear = {};
  if (!payload || !payload.fields || !payload.periods) {
    return valuesByYear;
  }
  let field;
  for (const candidate of payload.fields) {
    if (candidate.key === key) {
      field = candidate;
    }
  }
  if (!field) {
    return valuesByYear;
  }
  for (let i = 0; i < payload.periods.length; i++) {
    const value = field.values[i];
    if (value !== null && value !== undefined) {
      valuesByYear[payload.periods[i].year] = value;
    }
  }
  return valuesByYear;
};

//the fiscal years of a statement, newest first, without the TTM and MRQ columns
export const fiscalPeriods = (payload) => {
  const periods = [];
  if (!payload || !payload.periods) {
    return periods;
  }
  for (const period of payload.periods) {
    if (period.year !== "TTM" && period.year !== "MRQ") {
      periods.push(period);
    }
  }
  return periods;
};

//shares in thousands, from the share capital on the balance sheet. par is Rs 10, halved by a 2 for 1 split.
//the provider's own share count breaks after a split, so it is only used as a cross-check
export const shareCount = (balance, fundamentals, splits) => {
  const shareCapital = byYear(balance, "share_cap").MRQ;
  if (!shareCapital) {
    return null;
  }
  let splitFactor = 1;
  for (const split of splits) {
    splitFactor = splitFactor * split.ratio;
  }
  const shares = shareCapital / (10 / splitFactor);

  //the provider's count for its latest fiscal year, moved into today's share units
  const periods = fiscalPeriods(fundamentals);
  if (periods.length === 0) {
    return null;
  }
  let providerShares = byYear(fundamentals, "shares")[periods[0].year];
  if (!providerShares) {
    return null;
  }
  for (const split of splits) {
    if (split.date > periods[0].period_end) {
      providerShares = providerShares * split.ratio;
    }
  }
  if (Math.abs(shares / providerShares - 1) > 0.05) {
    return null;
  }
  return shares;
};

//the cash the valuation starts from: the average of the latest three fiscal years.
//a company: free cash flow, or profit when that is not positive. a bank: the dividends it paid
export const startingCash = (cashflow, income, isBank) => {
  const years = fiscalPeriods(cashflow);
  if (years.length < 3) {
    return null;
  }
  const operating = byYear(cashflow, "net_cf_oa");
  const fixedAssets = byYear(cashflow, "pur_fa");
  const intangibles = byYear(cashflow, "pur_ia");
  const dividendsReceived = byYear(cashflow, "div_rec");
  const dividendsPaid = byYear(cashflow, "div_paid");
  let freeCashFlow = 0;
  let paid = 0;
  for (let i = 0; i < 3; i++) {
    const year = years[i].year;
    //the purchase lines are already negative, so they are added
    freeCashFlow =
      freeCashFlow +
      (operating[year] ?? 0) +
      (fixedAssets[year] ?? 0) +
      (intangibles[year] ?? 0) +
      (dividendsReceived[year] ?? 0);
    paid = paid - (dividendsPaid[year] ?? 0);
  }

  if (isBank) {
    if (paid <= 0) {
      return null;
    }
    return { basis: "dividends paid", cash: paid / 3 };
  }
  if (freeCashFlow > 0) {
    return { basis: "free cash flow", cash: freeCashFlow / 3 };
  }

  const profit = byYear(income, "pat");
  const profitYears = fiscalPeriods(income);
  if (profitYears.length < 3) {
    return null;
  }
  let profitSum = 0;
  for (let i = 0; i < 3; i++) {
    profitSum = profitSum + (profit[profitYears[i].year] ?? 0);
  }
  if (profitSum <= 0) {
    return null;
  }
  return { basis: "profit", cash: profitSum / 3 };
};

//what the shares are worth today if the cash grows at `growth` for `years` years, then at `terminalGrowth` for ever
export const dcfValue = (cash, growth, r, terminalGrowth, years) => {
  let total = 0;
  let thisYear = cash;
  for (let year = 1; year <= years; year++) {
    thisYear = thisYear * (1 + growth);
    total = total + thisYear / (1 + r) ** year;
  }
  //everything after the last year, as one lump, brought back to today
  const afterwards = (thisYear * (1 + terminalGrowth)) / (r - terminalGrowth);
  return total + afterwards / (1 + r) ** years;
};

//the growth that makes the dcf value equal the market cap. found by halving the range 200 times, like xirr
export const impliedGrowth = (cash, marketCap, r, terminalGrowth, years) => {
  let low = -0.5;
  let high = 1;
  for (let i = 0; i < 200; i++) {
    const middle = (low + high) / 2;
    if (dcfValue(cash, middle, r, terminalGrowth, years) < marketCap) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
};

//how fast profit grew a year, from the oldest fiscal year in the statement to the latest
export const profitGrowth = (income) => {
  const periods = fiscalPeriods(income);
  if (periods.length < 2) {
    return null;
  }
  const profit = byYear(income, "pat");
  const latest = profit[periods[0].year];
  const oldest = profit[periods[periods.length - 1].year];
  if (!latest || !oldest || latest <= 0 || oldest <= 0) {
    return null;
  }
  const years = periods.length - 1;
  return (latest / oldest) ** (1 / years) - 1;
};

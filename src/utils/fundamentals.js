import { formatDate } from "./dateRange.js";

//the ratios the card shows, in this order. betterWhen says which side of the sector median is good
const ROWS = [
  { key: "pe_ratio", label: "P/E", group: "price", betterWhen: "low" },
  { key: "pb_ratio", label: "Price to book", group: "price", betterWhen: "low" },
  { key: "mp_ps", label: "Price per share", group: "price", betterWhen: "none" },
  { key: "eps", label: "Earnings per share", group: "price", betterWhen: "none" },
  { key: "dps", label: "Dividend per share", group: "dividend", betterWhen: "none" },
  { key: "div_yield", label: "Dividend yield", group: "dividend", betterWhen: "none" },
  { key: "payout", label: "Payout ratio", group: "dividend", betterWhen: "low" },
  { key: "div_cover", label: "Dividend cover", group: "dividend", betterWhen: "high" },
  { key: "roe", label: "Return on equity", group: "quality", betterWhen: "high" },
  { key: "npm", label: "Net profit margin", group: "quality", betterWhen: "high" },
  { key: "gpm", label: "Gross profit margin", group: "quality", betterWhen: "high" },
  { key: "ltde", label: "Debt to equity", group: "safety", betterWhen: "low" },
  { key: "intc", label: "Interest cover", group: "safety", betterWhen: "high" },
  { key: "cur_ratio", label: "Current ratio", group: "safety", betterWhen: "high" },
  { key: "cash_ps", label: "Cash per share", group: "safety", betterWhen: "none" },
];

const round2 = (value) => Math.round(value * 100) / 100;

//a raw number from the provider in the unit the card shows: percent fractions become percents
const scale = (field, raw) => {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (field.unit === "%") {
    return round2(Number(raw) * 100);
  }
  return round2(Number(raw));
};

const unitOf = (field) => {
  if (field.unit === "%") {
    return "%";
  }
  if (field.unit === "Rs.") {
    return "Rs";
  }
  if (field.unit === "Days") {
    return "days";
  }
  return "x";
};

const findField = (payload, key) => {
  for (const field of payload.fields) {
    if (field.key === key) {
      return field;
    }
  }
  return null;
};

const findSector = (payload, key) => {
  for (const stat of payload.sector_stats ?? []) {
    if (stat.key === key) {
      return stat;
    }
  }
  return null;
};

//sector medians mean nothing when the sector is full of tiny or loss making companies
const isSectorReliable = (payload) => {
  const pe = findSector(payload, "pe_ratio");
  const margin = findSector(payload, "npm");
  if (!pe || !margin) {
    return false;
  }
  return pe.median >= 2 && pe.median <= 40 && margin.median > 0;
};

//the whole card from one stored payload. splits are the stock's SPLIT rows, oldest first
export const buildFundamentalsCard = (payload, splits) => {
  const sectorReliable = isSectorReliable(payload);

  const rows = [];
  for (const row of ROWS) {
    const field = findField(payload, row.key);
    if (!field) {
      continue;
    }
    const value = scale(field, field.values ? field.values[0] : null);
    const stat = findSector(payload, row.key);
    let sector = null;
    let vsSector = null;
    if (stat) {
      sector = { min: scale(field, stat.min), median: scale(field, stat.median), max: scale(field, stat.max) };
      if (sectorReliable && value !== null && sector.median) {
        vsSector = Math.round(((value - sector.median) / Math.abs(sector.median)) * 100);
      }
    }
    rows.push({
      key: row.key,
      label: row.label,
      group: row.group,
      value,
      unit: unitOf(field),
      sector,
      vsSector,
      betterWhen: row.betterWhen,
    });
  }

  //what the stock would cost priced like an average company in its sector
  let priceAtSectorPe = null;
  const eps = findField(payload, "eps");
  const peStat = findSector(payload, "pe_ratio");
  const epsNow = eps && eps.values ? Number(eps.values[0]) : 0;
  if (sectorReliable && peStat && epsNow > 0) {
    priceAtSectorPe = round2(epsNow * peStat.median);
  }

  const cover = findField(payload, "div_cover");
  const coverNow = cover && cover.values ? Number(cover.values[0]) : 0;
  const dividendCovered = coverNow >= 1;

  //seven fiscal years, oldest first. per share figures from before a split are in old
  //shares, and the provider does not restate them all, so they are left out
  const history = { years: [], eps: [], dps: [], salesPerShare: [], roe: [] };
  let splitNote = null;
  const periods = payload.periods ?? [];
  for (let i = periods.length - 1; i >= 1; i--) {
    const period = periods[i];
    const periodEnd = new Date(`${period.period_end}T00:00:00Z`);
    let beforeSplit = false;
    for (const split of splits) {
      if (split.exDate > periodEnd) {
        beforeSplit = true;
        splitNote = `per-share figures before ${formatDate(split.exDate)} are in old shares`;
      }
    }
    history.years.push(String(period.year));
    history.eps.push(beforeSplit ? null : scale(eps, eps ? eps.values[i] : null));
    const dps = findField(payload, "dps");
    history.dps.push(beforeSplit ? null : scale(dps, dps ? dps.values[i] : null));
    const sales = findField(payload, "s_ps");
    history.salesPerShare.push(beforeSplit ? null : scale(sales, sales ? sales.values[i] : null));
    const roe = findField(payload, "roe");
    history.roe.push(scale(roe, roe ? roe.values[i] : null));
  }

  return {
    asOf: {
      period: periods[0] ? String(periods[0].year) : null,
      periodEnd: periods[0] ? periods[0].period_end : null,
      providerAt: payload.created ? String(payload.created).slice(0, 10) : null,
    },
    sectorReliable,
    rows,
    priceAtSectorPe,
    dividendCovered,
    history,
    splitNote,
  };
};

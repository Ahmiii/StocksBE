

const MAX_RANGE_DAYS = 5 * 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatDate = (date) => date.toISOString().slice(0, 10);

// "Today" on the PSX calendar, not the server's — UTC lags Karachi by 5 hours.
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });

const defaultRange = () => {
  const to = new Date(`${today()}T00:00:00Z`);
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { from, to };
};

// Strict: "2026-02-31" must not roll over to March.
const parseDate = (value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || formatDate(date) !== value ? null : date;
};

const parseDateRange = (query = {}) => {
  const hasFrom = query.from != null;
  const hasTo = query.to != null;

  if (!hasFrom && !hasTo) return defaultRange();
  if (!hasFrom || !hasTo) return { error: "from and to must be sent together." };

  const from = parseDate(String(query.from));
  const to = parseDate(String(query.to));

  if (!from || !to) return { error: "from and to must be YYYY-MM-DD dates." };
  if (from > to) return { error: "from must not be after to." };
  if ((to - from) / DAY_MS > MAX_RANGE_DAYS) {
    return { error: "Range is too wide: at most 5 years." };
  }

  return { from, to };
};

export { parseDateRange, formatDate, today };

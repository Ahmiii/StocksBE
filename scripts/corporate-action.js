// Records a corporate action by hand — for the ones no feed carries, like a
// merger. Usage:
//   node scripts/corporate-action.js ENGRO MERGER 2025-01-14 2.24407865 ENGROH
//   node scripts/corporate-action.js BAFL  SPLIT  2026-04-20 2
import "dotenv/config";
import { prisma, disconnectDB } from "../src/config/db.js";

const [symbol, type, exDate, ratio, toSymbol] = process.argv.slice(2);
const TYPES = ["SPLIT", "BONUS", "MERGER"];

if (!symbol || !TYPES.includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(exDate ?? "") || !(Number(ratio) > 0)) {
  console.error("usage: node scripts/corporate-action.js SYMBOL SPLIT|BONUS|MERGER YYYY-MM-DD RATIO [TO_SYMBOL]");
  process.exit(1);
}
if (type === "MERGER" && !toSymbol) {
  console.error("MERGER needs the new symbol as the last argument");
  process.exit(1);
}

const security = await prisma.security.findUnique({ where: { symbol } });
const toSecurity = toSymbol ? await prisma.security.findUnique({ where: { symbol: toSymbol } }) : null;
if (!security || (toSymbol && !toSecurity)) {
  console.error(`unknown symbol: ${!security ? symbol : toSymbol}`);
  process.exit(1);
}

const action = await prisma.corporateAction.upsert({
  where: {
    securityId_type_exDate: {
      securityId: security.id,
      type,
      exDate: new Date(`${exDate}T00:00:00Z`),
    },
  },
  create: {
    securityId: security.id,
    type,
    exDate: new Date(`${exDate}T00:00:00Z`),
    ratio: Number(ratio),
    toSecurityId: toSecurity?.id ?? null,
    source: "manual",
  },
  update: { ratio: Number(ratio), toSecurityId: toSecurity?.id ?? null, source: "manual" },
});

// The old symbol no longer trades after a merger.
if (type === "MERGER") {
  await prisma.security.update({ where: { id: security.id }, data: { listingStatus: "delisted" } });
}

console.log(`recorded ${type} for ${symbol} on ${exDate}: ratio ${ratio}${toSymbol ? ` → ${toSymbol}` : ""} (id ${action.id})`);
await disconnectDB();

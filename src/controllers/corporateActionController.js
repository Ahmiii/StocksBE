import { prisma } from "../config/db.js";
import { fetchDashboardApi } from "../services/dashboardApi.js";

const getSecuritiesPayout = async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const account = await prisma.brokerAccount.findFirst({
    where: { userId: req.user.id },
    select: { id: true, clientCode: true },
  });
  if (!account)
    return res.status(404).json({ error: "No broker account linked." });

  const securityPayout = await fetchDashboardApi(
    `/payouts/announcement-break-down/${symbol}`,
    {},
    { brokerAccountId: account.id, clientCode: account.clientCode },
  );
   res.status(200).json({
    message: "success",
    data: { symbol, count: securityPayout.length, securityPayout: securityPayout.slice(0, 20) },
  });
};

export { getSecuritiesPayout };

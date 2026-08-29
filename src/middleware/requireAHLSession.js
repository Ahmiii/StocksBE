import { AHL_SESSION_COOKIE } from "../config/constants.js";

// Reads the broker session off our own cookie and hands it to the route as
// req.brokerCookie, ready to pass straight through as a Cookie header.
const requireAHLSession = (req, res, next) => {
  const brokerCookie = req.cookies?.[AHL_SESSION_COOKIE];

  if (!brokerCookie) {
    return res.status(401).json({
      error: "No broker session. Call POST /broker/account_info first.",
    });
  }

  req.brokerCookie = brokerCookie;
  next();
};

export { requireAHLSession };

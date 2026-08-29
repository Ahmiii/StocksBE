import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "No authentication token found",
    });
  }

  const token = header.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      error: "No authentication token found",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Never select passwordHash — req.user is passed on to every route handler.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, fullName: true },
    });

    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired, please log in again" });
    }
    return res.status(401).json({ error: "Invalid authentication token" });
  }
};

export { authMiddleware };

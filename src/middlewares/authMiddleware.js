import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";

const authMiddleware = async (req, res, next) => {
    console.log(req.headers.authorization)
  let token;
  if (
    req?.headers?.authorization &&
    req?.headers?.authorization?.startsWith("Bearer")
  ) {
    token = req?.headers?.authorization?.split(" ")[1];
    console.log({token})
  } else if (req?.cookie?.jwt) {
    token = req?.cookie?.jwt;
  }
  if (!token) {
    return res?.status(401)?.json({
      error: "No authentication token found",
    });
  }
  try {
    const decode = jwt?.verify(token, process.env.JWT_SECRET);
    const user = await prisma?.user?.findUnique({
      where: {
        id: decode?.id,
      },
    });
    if (!user) {
      res?.status(401)?.json({ error: "User no longer exists" });
    }
    req.user = user;
    next();
  } catch (error) {
    res?.status(401)?.json({
      error: "Not authorize, no token provided",
    });
  }
};
export { authMiddleware };

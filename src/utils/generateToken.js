import jwt from "jsonwebtoken";

const generateWebToken = (userId, res) => {
  const payload = { ...userId };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWR_EXPIRES_IN || "7d",
  });
  res?.cookie("jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV,
    sameSite: true,
    maxAge: 100 * 60 * 60 * 25 * 7,
  });
  return token;
};
export { generateWebToken };

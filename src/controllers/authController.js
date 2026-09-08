import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { generateWebToken } from "../utils/generateToken.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const register = async (req, res) => {
  const { email, password, fullName } = req?.body ?? {};
  if (!email || !password || !fullName) {
    return res.status(400).json({ error: "email, password and fullName are required." });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "email is not valid." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters." });
  }

  const userExists = await prisma?.user?.findUnique({
    where: {
      email: email,
    },
  });
  if (userExists) {
    return res?.status(400)?.json({
      error: "user already exists",
    });
  }

  const salt = await bcrypt?.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const user = await prisma?.user?.create({
    data: {
      email: email,
      passwordHash: hashedPassword,
      fullName: fullName,
    },
  });
  const token = generateWebToken(
    {
      id: user?.id,
      email: user?.email,
    },
    res,
  );
  res?.status(201)?.json({
    message: "success",
    data: {
      user: { id: user?.id, fullName: user?.fullName, email: user?.email },
      token,
    },
  });
};

const login = async (req, res) => {
  const { email, password } = req?.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }

  const user = await prisma?.user?.findUnique({
    where: {
      email: email,
    },
  });

  if (!user) {
    return res?.status(401)?.json({
      error: "Invalid email or password",
    });
  }
  const passwordValid = await bcrypt?.compare(password, user?.passwordHash);
  if (!passwordValid) {
    return res?.status(401)?.json({
      error: "Invalid email or password",
    });
  }

  const token = generateWebToken(
    {
      id: user?.id,
      email: user?.email,
    },
    res,
  );

  res?.status(200)?.json({
    message: "success",
    data: {
      user: {
        id: user?.id,
        fullName: user?.fullName,
        email: email,
      },
      token,
    },
  });
};
export { register, login };

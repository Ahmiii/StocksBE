import { prisma } from "../config/db.js";


const register = async (req, res) => {
  const { email, full_name } = req?.body;
  const userExists = await prisma?.user?.findUnique({
    where: {
      email: email,
    },
  });
  if (userExists) {
    return res?.status(400)?.json({
      message: "user already exists",
    });
  }
  const user = await prisma?.user?.create({
    data: {
      email: email,
      fullName: full_name,
    },
  });
  res?.status(201)?.json({
    data: {
      ...user,
    },
  });
};

const login = async (req, res) => {
  const { email } = req.body;
  const user = await prisma.user.findUnique({
    where: {
      email: email,
    },
  });
  if (!user) {
    return res?.status(401)?.json({
      error: "email does not exists",
    });
  }

};
export { register, login };

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/stock_portfolio',
});
const prisma = new PrismaClient({ adapter });

const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log("DB Connect via Prisma");
  } catch (error) {
    console.error(`DB Connection error: ${error.message}`);
    process.exit(1);
  }
};

const disconnectDB = async () => {
  await prisma.$disconnect();
};

export { connectDB, disconnectDB, prisma };

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/stock_portfolio',
});
const prisma = new PrismaClient({ adapter });

export const connectDB = async () => {
	try {
		await prisma.$connect();
		await prisma.$queryRaw`SELECT 1`;
		console.log('PostgreSQL connected');
	} catch (error) {
        console.error('Error connecting to PostgreSQL:', error);
        throw error;
	}
};

export default prisma;

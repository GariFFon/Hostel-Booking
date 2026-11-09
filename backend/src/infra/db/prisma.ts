import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 10 }) });
}

/** One client per process (survives Next.js dev hot reloads). */
export const prisma: PrismaClient = (globalForPrisma.prisma ??= create());

export type Db = PrismaClient;

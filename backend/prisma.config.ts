import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env automatically.
try {
  process.loadEnvFile('.env');
} catch {
  /* CI/production provide real environment variables */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

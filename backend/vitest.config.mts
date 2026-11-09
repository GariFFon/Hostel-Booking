import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hostel:hostel_dev_pw@127.0.0.1:5433/hostel_test?schema=public';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    env: {
      DATABASE_URL: TEST_DB,
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
      APP_ENV: 'test',
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:4000',
      FRONTEND_URL: 'http://localhost:3000',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
      DEMO_WEBHOOK_SECRET: 'test-demo-webhook-secret',
      MAIL_DRIVER: 'log',
      CLOUDINARY_CLOUD_NAME: 'testcloud',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'test_cloudinary_secret_value',
      TRUST_PROXY: 'true',
      QUEUE_MODE: 'inline',
      LOG_LEVEL: 'silent',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    },
    fileParallelism: false, // DB tests share one database
    testTimeout: 20000,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/generated/**'] },
  },
});

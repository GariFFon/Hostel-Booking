import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = {
  APP_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/db',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  DEMO_WEBHOOK_SECRET: 'y'.repeat(16),
};

describe('parseEnv', () => {
  it('applies defaults and splits comma lists', () => {
    const env = parseEnv({ ...base, CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com' });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
    expect(env.BOOKING_HOLD_MINUTES).toBe(15);
  });

  it('rejects short JWT secrets with a readable message', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});

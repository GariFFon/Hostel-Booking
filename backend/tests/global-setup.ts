import { execSync } from 'node:child_process';
import pg from 'pg';

// Runs once before the suite: migrate the dedicated test database, then clear mutable data so runs are
// independent (lists/queues never grow across runs). audit_logs is left alone: it is append-only and has no FKs.
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://hostel:hostel_dev_pw@127.0.0.1:5433/hostel_test?schema=public';
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });

  const client = new pg.Client({ connectionString: url.replace(/\?schema=.*/, '') });
  await client.connect();
  try {
    await client.query('TRUNCATE users, hostels, amenities, coupons, webhook_events, idempotency_keys CASCADE');
  } finally {
    await client.end();
  }
}

/* eslint-disable no-console */
// One-off production bootstrap (safe to re-run): reference amenities + one ADMIN account. No demo data.
//   ADMIN_EMAIL=you@x.com ADMIN_PASSWORD='...' pnpm exec tsx scripts/bootstrap-prod.ts
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const url = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!url) throw new Error('DATABASE_URL is not set');
if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const AMENITIES: [string, string, string][] = [
  ['WIFI', 'Free Wi-Fi', 'WORK'], ['AC', 'Air conditioning', 'COMFORT'], ['LOCKERS', 'Personal lockers', 'SAFETY'],
  ['LAUNDRY', 'Laundry', 'COMFORT'], ['BREAKFAST', 'Breakfast included', 'FOOD'], ['KITCHEN', 'Shared kitchen', 'FOOD'],
  ['CAFE', 'On-site cafe', 'FOOD'], ['COWORK', 'Co-working space', 'WORK'], ['CCTV', 'CCTV security', 'SAFETY'],
  ['FEMALE_FLOOR', 'Women-only floor', 'SAFETY'], ['HOT_WATER', '24x7 hot water', 'COMFORT'], ['POWER_BACKUP', 'Power backup', 'COMFORT'],
  ['COMMON_ROOM', 'Common room', 'COMFORT'], ['ROOFTOP', 'Rooftop terrace', 'WELLNESS'], ['YOGA', 'Yoga deck', 'WELLNESS'],
  ['AIRPORT_PICKUP', 'Airport pickup', 'TRANSPORT'], ['PARKING', 'Parking', 'TRANSPORT'], ['MESS', 'Mess / meals', 'FOOD'],
];

async function main() {
  await prisma.amenity.createMany({ data: AMENITIES.map(([c, label, category]) => ({ code: c, label, category })), skipDuplicates: true });
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`Amenities ensured. ${email} already exists; nothing else changed.`);
    return;
  }
  const passwordHash = await argon2.hash(password!, { type: argon2.argon2id });
  await prisma.user.create({
    data: {
      email: email!, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(),
      profile: { create: { fullName: 'Platform Admin', phone: '+919000000000', city: 'Bengaluru' } },
      roles: { create: [{ role: 'ADMIN' }] },
      notificationPrefs: { create: {} },
    },
  });
  console.log(`Amenities ensured. Admin created: ${email}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

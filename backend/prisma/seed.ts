/* eslint-disable no-console */
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const DEV_PASSWORD = 'Password@123';
const GST_BPS = 500; // 5% up to Rs 7,500/night (seed default, configurable later)
const COMMISSION_BPS = 1000; // 10%
const INVENTORY_DAYS = 120;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const code = () => `HB-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
const demoImg = (n: number) =>
  ['samples/landscapes/beach-boat', 'samples/landscapes/nature-mountains', 'samples/landscapes/girl-urban-view',
   'samples/food/dessert', 'samples/people/kitchen-bar', 'samples/landscapes/architecture-signs'][n % 6]!;

const AMENITIES: [string, string, string][] = [
  ['WIFI', 'Free Wi-Fi', 'WORK'], ['AC', 'Air conditioning', 'COMFORT'], ['LOCKERS', 'Personal lockers', 'SAFETY'],
  ['LAUNDRY', 'Laundry', 'COMFORT'], ['BREAKFAST', 'Breakfast included', 'FOOD'], ['KITCHEN', 'Shared kitchen', 'FOOD'],
  ['CAFE', 'On-site cafe', 'FOOD'], ['COWORK', 'Co-working space', 'WORK'], ['CCTV', 'CCTV security', 'SAFETY'],
  ['FEMALE_FLOOR', 'Women-only floor', 'SAFETY'], ['HOT_WATER', '24x7 hot water', 'COMFORT'], ['POWER_BACKUP', 'Power backup', 'COMFORT'],
  ['COMMON_ROOM', 'Common room', 'COMFORT'], ['ROOFTOP', 'Rooftop terrace', 'WELLNESS'], ['YOGA', 'Yoga deck', 'WELLNESS'],
  ['AIRPORT_PICKUP', 'Airport pickup', 'TRANSPORT'], ['PARKING', 'Parking', 'TRANSPORT'], ['MESS', 'Mess / meals', 'FOOD'],
];

interface RoomSeed {
  name: string; kind: 'DORM' | 'PRIVATE'; gender?: 'MIXED' | 'MALE' | 'FEMALE'; units: number; price: number; occ?: number; weekend?: boolean;
}
interface HostelSeed {
  name: string; type: 'HOSTEL' | 'PG'; city: string; state: string; locality: string; lat: number; lng: number; postal: string;
  owner: number; status: 'APPROVED' | 'PENDING_REVIEW' | 'DRAFT'; mode?: 'INSTANT' | 'APPROVAL'; policy?: 'FLEXIBLE' | 'MODERATE' | 'STRICT';
  gender?: 'MIXED' | 'MALE_ONLY' | 'FEMALE_ONLY'; amenities: string[]; rooms: RoomSeed[]; blurb: string;
}

const HOSTELS: HostelSeed[] = [
  { name: 'Palolem Beach Nomads', type: 'HOSTEL', city: 'Goa', state: 'Goa', locality: 'Palolem', lat: 15.0100, lng: 74.0232, postal: '403702', owner: 0, status: 'APPROVED', policy: 'FLEXIBLE',
    amenities: ['WIFI', 'AC', 'LOCKERS', 'CAFE', 'ROOFTOP', 'CCTV'], blurb: 'Steps from the sand: social dorms, a rooftop bar and daily sunset yoga.',
    rooms: [{ name: '8-bed mixed dorm', kind: 'DORM', units: 8, price: 80000, weekend: true }, { name: '4-bed female dorm', kind: 'DORM', gender: 'FEMALE', units: 4, price: 95000, weekend: true }, { name: 'Private sea-view room', kind: 'PRIVATE', units: 3, price: 320000, occ: 2, weekend: true }] },
  { name: 'Old Manali Peaks Hostel', type: 'HOSTEL', city: 'Manali', state: 'Himachal Pradesh', locality: 'Old Manali', lat: 32.2530, lng: 77.1770, postal: '175131', owner: 0, status: 'APPROVED', mode: 'APPROVAL', policy: 'MODERATE',
    amenities: ['WIFI', 'HOT_WATER', 'KITCHEN', 'COMMON_ROOM', 'POWER_BACKUP', 'LOCKERS'], blurb: 'Cosy wooden hostel with a fireplace lounge and valley views.',
    rooms: [{ name: '10-bed mixed dorm', kind: 'DORM', units: 10, price: 70000 }, { name: 'Double private room', kind: 'PRIVATE', units: 4, price: 240000, occ: 2, weekend: true }] },
  { name: 'Laxman Jhula Riverside Stay', type: 'HOSTEL', city: 'Rishikesh', state: 'Uttarakhand', locality: 'Tapovan', lat: 30.1290, lng: 78.3200, postal: '249192', owner: 1, status: 'APPROVED', policy: 'FLEXIBLE',
    amenities: ['WIFI', 'YOGA', 'CAFE', 'HOT_WATER', 'ROOFTOP'], blurb: 'Yoga-first hostel above the Ganga with a vegetarian cafe.',
    rooms: [{ name: '6-bed mixed dorm', kind: 'DORM', units: 6, price: 60000 }, { name: 'Single private room', kind: 'PRIVATE', units: 5, price: 150000, occ: 1 }] },
  { name: 'Indiranagar Urban Hostel', type: 'HOSTEL', city: 'Bengaluru', state: 'Karnataka', locality: 'Indiranagar', lat: 12.9784, lng: 77.6408, postal: '560038', owner: 1, status: 'APPROVED', policy: 'MODERATE',
    amenities: ['WIFI', 'AC', 'COWORK', 'LAUNDRY', 'LOCKERS', 'CCTV', 'POWER_BACKUP'], blurb: 'Work-friendly hostel in the heart of the city, minutes from the metro.',
    rooms: [{ name: '12-bed mixed dorm', kind: 'DORM', units: 12, price: 90000, weekend: true }, { name: '6-bed male dorm', kind: 'DORM', gender: 'MALE', units: 6, price: 85000 }, { name: 'Private studio', kind: 'PRIVATE', units: 4, price: 380000, occ: 2, weekend: true }] },
  { name: 'Pink City Backpackers', type: 'HOSTEL', city: 'Jaipur', state: 'Rajasthan', locality: 'C-Scheme', lat: 26.9124, lng: 75.7873, postal: '302001', owner: 2, status: 'APPROVED', policy: 'STRICT',
    amenities: ['WIFI', 'AC', 'BREAKFAST', 'ROOFTOP', 'CCTV'], blurb: 'Heritage haveli turned hostel, with breakfast and walking-tour desk.',
    rooms: [{ name: '8-bed mixed dorm', kind: 'DORM', units: 8, price: 55000 }, { name: 'Haveli private room', kind: 'PRIVATE', units: 3, price: 210000, occ: 2 }] },
  { name: 'Colaba Harbour Hostel', type: 'HOSTEL', city: 'Mumbai', state: 'Maharashtra', locality: 'Colaba', lat: 18.9067, lng: 72.8147, postal: '400005', owner: 2, status: 'APPROVED', policy: 'MODERATE',
    amenities: ['WIFI', 'AC', 'LOCKERS', 'LAUNDRY', 'CCTV'], blurb: 'Budget beds a short walk from the Gateway of India.',
    rooms: [{ name: '10-bed mixed dorm', kind: 'DORM', units: 10, price: 110000, weekend: true }, { name: '6-bed female dorm', kind: 'DORM', gender: 'FEMALE', units: 6, price: 120000, weekend: true }] },
  { name: 'Koregaon Park Students PG', type: 'PG', city: 'Pune', state: 'Maharashtra', locality: 'Koregaon Park', lat: 18.5362, lng: 73.8938, postal: '411001', owner: 2, status: 'APPROVED', mode: 'APPROVAL', gender: 'MALE_ONLY', policy: 'STRICT',
    amenities: ['WIFI', 'MESS', 'LAUNDRY', 'POWER_BACKUP', 'CCTV', 'HOT_WATER'], blurb: 'Furnished PG for working professionals and students, meals included.',
    rooms: [{ name: 'Triple sharing', kind: 'DORM', gender: 'MALE', units: 12, price: 45000 }, { name: 'Single room', kind: 'PRIVATE', units: 6, price: 90000, occ: 1 }] },
  { name: 'Hauz Khas Social Hostel', type: 'HOSTEL', city: 'New Delhi', state: 'Delhi', locality: 'Hauz Khas', lat: 28.5494, lng: 77.2001, postal: '110016', owner: 0, status: 'PENDING_REVIEW', policy: 'MODERATE',
    amenities: ['WIFI', 'AC', 'CAFE', 'COMMON_ROOM'], blurb: 'New listing awaiting admin approval.',
    rooms: [{ name: '8-bed mixed dorm', kind: 'DORM', units: 8, price: 75000 }] },
  { name: 'Varkala Cliff Cottage (draft)', type: 'HOSTEL', city: 'Varkala', state: 'Kerala', locality: 'North Cliff', lat: 8.7379, lng: 76.7163, postal: '695141', owner: 1, status: 'DRAFT', policy: 'FLEXIBLE',
    amenities: ['WIFI'], blurb: 'Draft listing still being edited by the owner.', rooms: [{ name: '4-bed mixed dorm', kind: 'DORM', units: 4, price: 65000 }] },
];

async function main() {
  if (await prisma.user.findUnique({ where: { email: 'admin@hostel.dev' } })) {
    console.log('Seed data already present; run `pnpm db:reset && pnpm db:seed` for a fresh start.');
    return;
  }
  const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });

  await prisma.amenity.createMany({ data: AMENITIES.map(([c, label, category]) => ({ code: c, label, category })) });
  const amenityByCode = new Map((await prisma.amenity.findMany()).map((a) => [a.code, a.id]));

  const mkUser = (email: string, name: string, roles: ('GUEST' | 'OWNER' | 'ADMIN')[], extra?: Partial<Prisma.UserCreateInput>) =>
    prisma.user.create({
      data: {
        email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(),
        profile: { create: { fullName: name, phone: '+91' + (9000000000 + Math.floor(Math.random() * 99999999)), city: 'Bengaluru' } },
        roles: { create: roles.map((role) => ({ role })) },
        notificationPrefs: { create: {} },
        ...extra,
      },
    });

  const admin = await mkUser('admin@hostel.dev', 'Platform Admin', ['ADMIN']);
  const owners = [];
  for (const [i, name] of ['Riya Sharma', 'Arjun Mehta', 'Kavya Nair'].entries()) {
    const o = await mkUser(`owner${i + 1}@hostel.dev`, name, ['OWNER', 'GUEST'], {
      ownerProfile: { create: { businessName: `${name.split(' ')[0]} Stays Pvt Ltd`, gstin: `29ABCDE123${i}F1Z5`, kycStatus: 'APPROVED', kycReviewedById: admin.id, kycReviewedAt: new Date() } },
    });
    owners.push(o);
  }
  const guests = [];
  for (const [i, name] of ['Aarav Singh', 'Isha Kapoor', 'Rohan Das', 'Meera Iyer', 'Sam Wilson'].entries()) guests.push(await mkUser(`guest${i + 1}@hostel.dev`, name, ['GUEST']));

  // ── Hostels, rooms, price rules, inventory ──
  const created: { hostel: Awaited<ReturnType<typeof prisma.hostel.create>>; rooms: Awaited<ReturnType<typeof prisma.roomType.create>>[]; seed: HostelSeed }[] = [];
  for (const h of HOSTELS) {
    const hostel = await prisma.hostel.create({
      data: {
        ownerId: owners[h.owner]!.id, slug: slugify(`${h.name} ${h.city}`), name: h.name, description: h.blurb, propertyType: h.type, status: h.status,
        bookingMode: h.mode ?? 'INSTANT', cancellationPolicy: h.policy ?? 'MODERATE', genderPolicy: h.gender ?? 'MIXED',
        addressLine1: `${10 + created.length} ${h.locality} Main Road`, locality: h.locality, city: h.city, state: h.state, postalCode: h.postal,
        latitude: h.lat, longitude: h.lng, phone: '+919800000000', contactEmail: `stay@${slugify(h.name)}.example`,
        houseRules: 'Quiet hours 11pm-7am. Government ID required at check-in. No outside guests in dorms.', gstin: `29ABCDE123${created.length}F1Z5`,
        approvedAt: h.status === 'APPROVED' ? new Date() : null, approvedById: h.status === 'APPROVED' ? admin.id : null,
        amenities: { create: h.amenities.map((c) => ({ amenityId: amenityByCode.get(c)! })) },
        media: { create: [0, 1, 2].map((n) => ({ publicId: `seed/${slugify(h.name)}/${n}`, url: `https://res.cloudinary.com/demo/image/upload/${demoImg(created.length + n)}.jpg`, isCover: n === 0, sortOrder: n, altText: `${h.name} photo ${n + 1}` })) },
      },
    });
    const rooms = [];
    for (const r of h.rooms) {
      const rt = await prisma.roomType.create({
        data: {
          hostelId: hostel.id, name: r.name, kind: r.kind, gender: r.gender ?? 'MIXED', totalUnits: r.units, basePricePaise: r.price,
          maxOccupancyPerUnit: r.occ ?? 1, description: `${r.name} at ${h.name}`, maxStayNights: h.type === 'PG' ? 180 : 30, minStayNights: h.type === 'PG' ? 7 : 1,
          priceRules: r.weekend ? { create: [{ type: 'WEEKEND', name: 'Fri/Sat uplift', weekdays: [5, 6], adjustmentBps: 2000, priority: 1 }] } : undefined,
        },
      });
      rooms.push(rt);
      if (h.status === 'APPROVED') {
        await prisma.inventoryNight.createMany({
          data: Array.from({ length: INVENTORY_DAYS }, (_, i) => ({ roomTypeId: rt.id, date: day(i), totalUnits: r.units })),
        });
      }
    }
    created.push({ hostel, rooms, seed: h });
  }

  // ── Coupons ──
  await prisma.coupon.createMany({
    data: [
      { code: 'WELCOME10', description: '10% off your first booking', discountType: 'PERCENT', percentBps: 1000, maxDiscountPaise: 50000, minBookingPaise: 100000, createdById: admin.id, validFrom: day(-30), validTo: day(365), usageLimit: 1000, perUserLimit: 1 },
      { code: 'GOA200', description: 'Rs 200 off Goa stays', discountType: 'FLAT', flatPaise: 20000, minBookingPaise: 150000, hostelId: created[0]!.hostel.id, createdById: owners[0]!.id, validFrom: day(-30), validTo: day(180), usageLimit: 200, perUserLimit: 2 },
    ],
  });

  // ── Completed stays with payments, ledger and reviews (give search real ratings) ──
  const comments = ['Great vibe and super clean dorms!', 'Staff were wonderful, location is unbeatable.', 'Good value, a bit noisy on weekends.', 'Loved the rooftop. Would stay again.', 'Comfortable beds and fast Wi-Fi.', 'Felt safe and welcoming as a solo traveller.'];
  let r = 0;
  for (const c of created.filter((x) => x.seed.status === 'APPROVED')) {
    for (let k = 0; k < 3; k++) {
      const room = c.rooms[k % c.rooms.length]!;
      const guest = guests[(r + k) % guests.length]!;
      const nights = 2 + (k % 3);
      const checkIn = day(-(20 + k * 9 + (r % 5)));
      const checkOut = new Date(checkIn.getTime() + nights * 86400000);
      const units = 1;
      const subtotal = room.basePricePaise * units * nights;
      const tax = Math.round((subtotal * GST_BPS) / 10000);
      const total = subtotal + tax;
      const commission = Math.round((subtotal * COMMISSION_BPS) / 10000);
      const booking = await prisma.booking.create({
        data: {
          code: code(), guestId: guest.id, hostelId: c.hostel.id, status: 'COMPLETED', checkIn, checkOut, nights, guestsCount: 1,
          subtotalPaise: subtotal, taxPaise: tax, gstRateBps: GST_BPS, totalPaise: total, commissionBps: COMMISSION_BPS,
          cancellationPolicy: c.hostel.cancellationPolicy, bookingMode: c.hostel.bookingMode, confirmedAt: new Date(checkIn.getTime() - 5 * 86400000), completedAt: checkOut,
          items: { create: [{ roomTypeId: room.id, units, lineTotalPaise: subtotal, roomNameSnapshot: room.name, nightlyBreakdown: Array.from({ length: nights }, (_, n) => ({ date: new Date(checkIn.getTime() + n * 86400000).toISOString().slice(0, 10), unitPricePaise: room.basePricePaise })) }] },
          guests: { create: [{ fullName: 'Primary Guest', isPrimary: true }] },
          history: { create: [
            { fromStatus: null, toStatus: 'HOLD', actorRole: 'GUEST', actorId: guest.id }, { fromStatus: 'HOLD', toStatus: 'PENDING_PAYMENT', actorRole: 'SYSTEM' },
            { fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorRole: 'SYSTEM', reason: 'payment captured' }, { fromStatus: 'CONFIRMED', toStatus: 'CHECKED_IN', actorRole: 'OWNER', actorId: c.hostel.ownerId },
            { fromStatus: 'CHECKED_IN', toStatus: 'COMPLETED', actorRole: 'SYSTEM' }] },
        },
      });
      const payment = await prisma.payment.create({
        data: { bookingId: booking.id, provider: 'demo', providerOrderId: `demo_order_${randomUUID()}`, providerPaymentId: `demo_pay_${randomUUID()}`, amountPaise: total, status: 'CAPTURED', method: 'UPI', capturedAt: booking.confirmedAt,
          attempts: { create: [{ status: 'SUCCEEDED', instrument: 'DEMO_SUCCESS', method: 'UPI' }] } },
      });
      const groupId = randomUUID();
      const L = (debitAccount: Prisma.LedgerEntryCreateManyInput['debitAccount'], creditAccount: Prisma.LedgerEntryCreateManyInput['creditAccount'], amountPaise: number, memo: string) =>
        ({ groupId, bookingId: booking.id, paymentId: payment.id, debitAccount, creditAccount, amountPaise, memo });
      await prisma.ledgerEntry.createMany({
        data: [L('GUEST', 'PLATFORM_ESCROW', total, 'Guest payment captured'), L('PLATFORM_ESCROW', 'OWNER_PAYABLE', subtotal - commission, 'Owner share released on completion'),
          L('PLATFORM_ESCROW', 'PLATFORM_REVENUE', commission, 'Platform commission'), L('PLATFORM_ESCROW', 'TAX_PAYABLE', tax, 'GST collected')],
      });
      const rating = 3 + ((r + k) % 3); // 3..5
      await prisma.review.create({
        data: { bookingId: booking.id, hostelId: c.hostel.id, guestId: guest.id, overall: rating, cleanliness: rating, location: Math.min(5, rating + 1), staff: rating, valueForMoney: rating, title: rating >= 5 ? 'Loved it' : 'Solid stay', comment: comments[(r + k) % comments.length], ownerReply: k === 0 ? 'Thanks for staying with us!' : null, ownerRepliedAt: k === 0 ? new Date() : null },
      });
      r++;
    }
    const agg = await prisma.review.aggregate({ where: { hostelId: c.hostel.id }, _avg: { overall: true }, _count: true });
    const minPrice = Math.min(...c.rooms.map((x) => x.basePricePaise));
    await prisma.hostel.update({ where: { id: c.hostel.id }, data: { avgRating: Math.round((agg._avg.overall ?? 0) * 100) / 100, reviewCount: agg._count, minPricePaise: minPrice } });
  }

  // ── A few upcoming confirmed bookings (consume inventory consistently) ──
  const goa = created[0]!;
  const room = goa.rooms[0]!;
  const ci = day(10), co = day(13);
  const sub = room.basePricePaise * 2 * 3, tx = Math.round((sub * GST_BPS) / 10000);
  const upcoming = await prisma.booking.create({
    data: { code: code(), guestId: guests[0]!.id, hostelId: goa.hostel.id, status: 'CONFIRMED', checkIn: ci, checkOut: co, nights: 3, guestsCount: 2, subtotalPaise: sub, taxPaise: tx, gstRateBps: GST_BPS, totalPaise: sub + tx, commissionBps: COMMISSION_BPS, cancellationPolicy: goa.hostel.cancellationPolicy, bookingMode: 'INSTANT', confirmedAt: new Date(),
      items: { create: [{ roomTypeId: room.id, units: 2, lineTotalPaise: sub, roomNameSnapshot: room.name, nightlyBreakdown: [10, 11, 12].map((o) => ({ date: day(o).toISOString().slice(0, 10), unitPricePaise: room.basePricePaise })) }] },
      history: { create: [{ fromStatus: null, toStatus: 'HOLD', actorRole: 'GUEST' }, { fromStatus: 'HOLD', toStatus: 'CONFIRMED', actorRole: 'SYSTEM', reason: 'payment captured' }] } },
  });
  await prisma.inventoryNight.updateMany({ where: { roomTypeId: room.id, date: { gte: ci, lt: co } }, data: { bookedUnits: 2 } });
  await prisma.wishlist.createMany({ data: [{ userId: guests[0]!.id, hostelId: created[2]!.hostel.id }, { userId: guests[1]!.id, hostelId: created[0]!.hostel.id }] });
  await prisma.notification.create({ data: { userId: guests[0]!.id, type: 'BOOKING_CONFIRMED', title: 'Booking confirmed', body: `Your stay at ${goa.hostel.name} is confirmed.`, data: { bookingId: upcoming.id } } });
  await prisma.auditLog.create({ data: { action: 'seed.run', entityType: 'system', actorRole: 'SYSTEM', after: { hostels: created.length, users: 9 } } });

  console.log(`Seeded ${created.length} hostels. Dev logins (password "${DEV_PASSWORD}"): admin@hostel.dev, owner1..3@hostel.dev, guest1..5@hostel.dev`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

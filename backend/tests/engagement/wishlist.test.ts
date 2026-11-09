import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as listWishlist } from '@/app/api/v1/me/wishlist/route';
import { GET as wishlistIds } from '@/app/api/v1/me/wishlist/ids/route';
import { DELETE as removeWish, PUT as addWish } from '@/app/api/v1/me/wishlist/[hostelId]/route';
import { wishlistService } from '@/modules/wishlist/wishlist.service';
import { wishlistIdsSchema, wishlistItemSchema, wishlistStateSchema } from '@/modules/wishlist/wishlist.schema';
import { call } from '../helpers/http';
import { makeGuest, makeHost } from '../helpers/booking';
import { actorOf, issues } from '../helpers/engagement';

beforeAll(async () => {
  await redis.flushdb();
});

const save = (token: string, hostelId: string) => call(addWish, { method: 'PUT', token, params: { hostelId } });
const unsave = (token: string, hostelId: string) => call(removeWish, { method: 'DELETE', token, params: { hostelId } });
const ids = async (token: string) => (await call(wishlistIds, { method: 'GET', token })).body.data.hostelIds as string[];
const rows = (userId: string) => prisma.wishlist.findMany({ where: { userId } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('wishlist', () => {
  it('saves a property idempotently and returns a card with everything a list needs', async () => {
    const host = await makeHost({ name: 'Rooftop Stay', city: 'Goa', rooms: [{ units: 4, price: 90000 }, { name: 'Private', kind: 'PRIVATE', units: 2, price: 250000 }], rating: 4.5, reviews: 12 });
    const guest = await makeGuest();

    const first = await save(guest.token, host.hostel.id);
    expect(first.status).toBe(200);
    expect(issues(wishlistStateSchema, first.body.data)).toEqual([]);
    expect(first.body.data).toEqual({ hostelId: host.hostel.id, saved: true });
    const savedAt = (await rows(guest.id))[0]!.createdAt;
    await sleep(15);
    expect((await save(guest.token, host.hostel.id)).status).toBe(200); // saving again changes nothing
    expect(await rows(guest.id)).toHaveLength(1);
    expect((await rows(guest.id))[0]!.createdAt).toEqual(savedAt);

    const list = await call(listWishlist, { method: 'GET', token: guest.token });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(issues(wishlistItemSchema, list.body.data[0])).toEqual([]);
    expect(list.body.data[0]).toMatchObject({
      hostel: { id: host.hostel.id, slug: host.hostel.slug, name: 'Rooftop Stay', city: 'Goa', fromPricePaise: 90000, avgRating: 4.5, reviewCount: 12, bookingMode: 'INSTANT', currency: 'INR' },
    });
    expect(list.body.data[0].hostel.coverUrl).toContain('c_fill'); // a card-sized image, not the original
    expect(await ids(guest.token)).toEqual([host.hostel.id]);
  });

  it('removing is idempotent too, and works for something never saved', async () => {
    const host = await makeHost();
    const guest = await makeGuest();
    await save(guest.token, host.hostel.id);
    const res = await unsave(guest.token, host.hostel.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ hostelId: host.hostel.id, saved: false });
    expect(await rows(guest.id)).toHaveLength(0);
    expect((await unsave(guest.token, host.hostel.id)).body.data.saved).toBe(false);
    expect((await unsave(guest.token, '00000000-0000-4000-8000-000000000000')).status).toBe(200);
    expect(await ids(guest.token)).toEqual([]);
  });

  it('lists are private to their owner and need a login', async () => {
    const host = await makeHost();
    const a = await makeGuest();
    const b = await makeGuest();
    await save(a.token, host.hostel.id);
    expect(await ids(b.token)).toEqual([]);
    expect((await call(listWishlist, { method: 'GET', token: b.token })).body.data).toEqual([]);
    await unsave(b.token, host.hostel.id); // b removing "the same" property must not touch a's list
    expect(await ids(a.token)).toEqual([host.hostel.id]);
    expect((await call(listWishlist, { method: 'GET' })).status).toBe(401);
    expect((await call(wishlistIds, { method: 'GET' })).status).toBe(401);
    expect((await call(addWish, { method: 'PUT', params: { hostelId: host.hostel.id } })).status).toBe(401);
    expect((await call(removeWish, { method: 'DELETE', params: { hostelId: host.hostel.id } })).status).toBe(401);
  });

  it('only live listings can be saved; anything else is simply not found', async () => {
    const guest = await makeGuest();
    const draft = await makeHost({ status: 'DRAFT' });
    const pending = await makeHost({ status: 'PENDING_REVIEW' });
    const suspended = await makeHost({ status: 'SUSPENDED' });
    const deleted = await makeHost({ deleted: true });
    for (const h of [draft, pending, suspended, deleted]) expect((await save(guest.token, h.hostel.id)).status).toBe(404);
    expect((await save(guest.token, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await save(guest.token, 'not-a-uuid')).status).toBe(404);
    expect((await save(guest.token, ' ')).status).toBe(404);
    expect(await rows(guest.id)).toHaveLength(0);
  });

  it('a saved listing that goes offline disappears from the list and comes back when reinstated', async () => {
    const host = await makeHost();
    const stays = await makeHost();
    const guest = await makeGuest();
    await save(guest.token, host.hostel.id);
    await save(guest.token, stays.hostel.id);
    expect(await ids(guest.token)).toHaveLength(2);

    await prisma.hostel.update({ where: { id: host.hostel.id }, data: { status: 'SUSPENDED' } });
    expect(await ids(guest.token)).toEqual([stays.hostel.id]);
    expect((await call(listWishlist, { method: 'GET', token: guest.token })).body.data.map((i: { hostel: { id: string } }) => i.hostel.id)).toEqual([stays.hostel.id]);
    expect(await rows(guest.id)).toHaveLength(2); // the row is kept

    await prisma.hostel.update({ where: { id: host.hostel.id }, data: { status: 'APPROVED' } });
    expect(await ids(guest.token)).toHaveLength(2);
  });

  it('pages newest-first without gaps or repeats', async () => {
    const guest = await makeGuest();
    const hosts = [];
    for (let i = 0; i < 5; i++) {
      const h = await makeHost();
      hosts.push(h.hostel.id);
      await save(guest.token, h.hostel.id);
      await sleep(5);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const res = await call(listWishlist, { method: 'GET', token: guest.token, query: `?limit=2${cursor ? `&cursor=${cursor}` : ''}` });
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((i: { hostel: { id: string } }) => i.hostel.id));
      cursor = res.body.meta.nextCursor ?? undefined;
      if (!cursor) { expect(page).toBe(2); break; }
    }
    expect(seen).toEqual([...hosts].reverse());
    expect(await ids(guest.token)).toEqual([...hosts].reverse());
    const garbage = await call(listWishlist, { method: 'GET', token: guest.token, query: '?limit=2&cursor=%25%25%25' });
    expect(garbage.status).toBe(200); // an unusable cursor starts from the top rather than failing
    expect(garbage.body.data).toHaveLength(2);
    expect((await call(listWishlist, { method: 'GET', token: guest.token, query: '?limit=0' })).status).toBe(422);
    expect((await call(listWishlist, { method: 'GET', token: guest.token, query: '?limit=51' })).status).toBe(422);
  });

  it('stops at the cap, but still accepts what is already saved', async () => {
    const guest = await makeGuest();
    const [a, b, c] = [await makeHost(), await makeHost(), await makeHost()];
    const actor = actorOf(guest, 'GUEST');
    await wishlistService.add(actor, a.hostel.id, 2);
    await wishlistService.add(actor, b.hostel.id, 2);
    await expect(wishlistService.add(actor, c.hostel.id, 2)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(wishlistService.add(actor, a.hostel.id, 2)).resolves.toMatchObject({ saved: true }); // already saved: fine at the cap
    expect(await rows(guest.id)).toHaveLength(2);
  });

  it('ten simultaneous saves of the same property leave exactly one row and no errors', async () => {
    const host = await makeHost();
    const guest = await makeGuest();
    const results = await Promise.all(Array.from({ length: 10 }, () => save(guest.token, host.hostel.id)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await rows(guest.id)).toHaveLength(1);
    const [save1, drop] = await Promise.all([save(guest.token, host.hostel.id), unsave(guest.token, host.hostel.id)]); // a save racing a removal ends in one of the two states
    expect([save1.status, drop.status]).toEqual([200, 200]);
    expect((await rows(guest.id)).length).toBeLessThanOrEqual(1);
  });

  it('the ids endpoint returns a valid, bounded list', async () => {
    const guest = await makeGuest();
    const res = await call(wishlistIds, { method: 'GET', token: guest.token });
    expect(issues(wishlistIdsSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toEqual({ hostelIds: [] });
  });
});

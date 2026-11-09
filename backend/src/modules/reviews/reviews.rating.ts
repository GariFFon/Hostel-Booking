import type { Prisma } from '@/generated/prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Locks the hostel row for the rest of the transaction. Every review write takes this lock before it changes a
 * review and recomputes the rating, so two concurrent writes on one hostel cannot both read the old aggregate and
 * overwrite each other's result.
 */
export async function lockHostelForRating(tx: Tx, hostelId: string) {
  await tx.$queryRaw`SELECT id FROM hostels WHERE id = ${hostelId}::uuid FOR UPDATE`;
}

/**
 * Recomputes the denormalised `avg_rating` / `review_count` on the hostel from the published reviews, in the
 * database (one rounding rule everywhere: numeric round to 2 decimals). Self-correcting by construction: it never
 * increments, it always derives from the source rows. Call after `lockHostelForRating`.
 */
export async function recomputeRating(tx: Tx, hostelId: string) {
  const rows = await tx.$queryRaw<{ avg_rating: number; review_count: number }[]>`
    UPDATE hostels h SET avg_rating = s.avg, review_count = s.cnt
    FROM (
      SELECT COALESCE(round(avg(overall)::numeric, 2), 0)::float8 AS avg, count(*)::int AS cnt
      FROM reviews WHERE hostel_id = ${hostelId}::uuid AND status = 'PUBLISHED'
    ) s
    WHERE h.id = ${hostelId}::uuid
    RETURNING h.avg_rating, h.review_count`;
  return { avgRating: rows[0]?.avg_rating ?? 0, reviewCount: rows[0]?.review_count ?? 0 };
}

/** Nightly safety net: fixes any hostel whose stored rating drifted from its reviews. Returns the ids it changed. */
export async function reconcileRatings(db: Pick<Tx, '$queryRaw'>): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE hostels h SET avg_rating = s.avg, review_count = s.cnt
    FROM (
      SELECT h2.id, COALESCE(round(avg(r.overall)::numeric, 2), 0)::float8 AS avg, count(r.id)::int AS cnt
      FROM hostels h2 LEFT JOIN reviews r ON r.hostel_id = h2.id AND r.status = 'PUBLISHED'
      GROUP BY h2.id
    ) s
    WHERE h.id = s.id AND (h.review_count <> s.cnt OR h.avg_rating <> s.avg)
    RETURNING h.id::text AS id`;
  return rows.map((r) => r.id);
}

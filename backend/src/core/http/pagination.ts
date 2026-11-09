import { z } from 'zod';
import { Errors } from '../errors/app-error';

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

const encode = (id: string) => Buffer.from(id).toString('base64url');
const decode = (c: string) => Buffer.from(c, 'base64url').toString();
const UUID = /^[0-9a-f-]{36}$/i;

/** Prisma cursor args for an id-cursor over a deterministic `orderBy` that ends with `id`. */
export function cursorArgs({ limit, cursor }: { limit: number; cursor?: string }) {
  const id = cursor ? decode(cursor) : null;
  // A tampered or truncated cursor is an error, not "start again": a client following nextCursor would otherwise loop on page 1.
  if (cursor && !(id && UUID.test(id))) throw Errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  return { take: limit + 1, ...(id ? { cursor: { id }, skip: 1 } : {}) };
}

export function toPage<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encode(items[items.length - 1]!.id) : null };
}

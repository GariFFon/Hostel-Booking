import { randomBytes } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'hostel';

export async function uniqueHostelSlug(db: Prisma.TransactionClient, source: string): Promise<string> {
  const base = slugify(source);
  let candidate = base;
  for (let i = 0; i < 5; i++) {
    if (!(await db.hostel.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
    candidate = `${base}-${randomBytes(2).toString('hex')}`;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

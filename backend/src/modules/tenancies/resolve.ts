import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public routes accept a UUID or a slug; services want the id. An unknown slug is simply "not found". */
export async function resolveHostelId(idOrSlug: string): Promise<string> {
  if (UUID.test(idOrSlug)) return idOrSlug;
  const h = await prisma.hostel.findFirst({ where: { slug: idOrSlug.toLowerCase(), deletedAt: null }, select: { id: true } });
  if (!h) throw Errors.notFound('Property');
  return h.id;
}

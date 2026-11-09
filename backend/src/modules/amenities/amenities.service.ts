import type { z } from 'zod';
import { createAmenitySchema, updateAmenitySchema } from './amenities.schema';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { invalidateAmenities } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';

const dto = (a: { id: string; code: string; label: string; category: string; icon: string | null }) => ({ id: a.id, code: a.code, label: a.label, category: a.category, icon: a.icon });

export const amenitiesService = {
  async list() {
    return (await prisma.amenity.findMany({ orderBy: [{ category: 'asc' }, { label: 'asc' }] })).map(dto);
  },

  async create(actor: Actor, input: z.infer<typeof createAmenitySchema>) {
    requireRole(actor, 'ADMIN');
    if (await prisma.amenity.findUnique({ where: { code: input.code } })) throw Errors.conflict('An amenity with this code already exists');
    return prisma.$transaction(async (tx) => {
      const a = await tx.amenity.create({ data: input });
      await recordAudit({ action: 'amenity.create', entityType: 'amenity', entityId: a.id, after: dto(a) }, tx);
      return dto(a);
    });
  },

  async update(actor: Actor, id: string, input: z.infer<typeof updateAmenitySchema>) {
    requireRole(actor, 'ADMIN');
    const before = await prisma.amenity.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Amenity');
    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.amenity.update({ where: { id }, data: input });
      await recordAudit({ action: 'amenity.update', entityType: 'amenity', entityId: id, before: dto(before), after: dto(a) }, tx);
      return dto(a);
    });
    await invalidateAmenities();
    return updated;
  },

  async remove(actor: Actor, id: string) {
    requireRole(actor, 'ADMIN');
    const before = await prisma.amenity.findUnique({ where: { id }, include: { _count: { select: { hostels: true } } } });
    if (!before) throw Errors.notFound('Amenity');
    if (before._count.hostels > 0) throw Errors.conflict(`This amenity is used by ${before._count.hostels} listing(s)`);
    await prisma.$transaction(async (tx) => {
      await tx.amenity.delete({ where: { id } });
      await recordAudit({ action: 'amenity.delete', entityType: 'amenity', entityId: id, before: dto(before) }, tx);
    });
    await invalidateAmenities();
  },
};

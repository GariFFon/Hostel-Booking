import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { recordAudit } from '@/modules/audit/audit.service';
import { loadOwnedHostel } from '@/modules/hostels/hostels.policy';
import { stayModeOf } from '@/modules/hostels/property-mode';
import { freeUnits } from './tenancy.rules';
import type { TenancyTermsInput } from './tenancy.schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick = (h: { depositMonths: number; noticeDays: number; rentDueDay: number; rentGraceDays: number; rentGstBps: number; rentLateFeePaise: number }) => ({
  depositMonths: h.depositMonths, noticeDays: h.noticeDays, rentDueDay: h.rentDueDay, rentGraceDays: h.rentGraceDays, rentGstBps: h.rentGstBps, rentLateFeePaise: h.rentLateFeePaise,
});

export const termsService = {
  /** What a student sees before applying: the property's terms and which room types still have a free bed. */
  async publicTerms(idOrSlug: string) {
    const hostel = await prisma.hostel.findFirst({
      where: { status: 'APPROVED', deletedAt: null, ...(UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug.toLowerCase() }) },
      include: { roomTypes: { where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    if (!hostel || stayModeOf(hostel.propertyType) !== 'TENANCY') throw Errors.notFound('Property');
    const rooms = await Promise.all(hostel.roomTypes.map(async (r) => ({ roomTypeId: r.id, name: r.name, kind: r.kind, gender: r.gender, rentPaise: r.basePricePaise, freeUnits: (await freeUnits(prisma, r.id)).length })));
    return { ...pick(hostel), rooms };
  },

  async ownerTerms(actor: Actor, hostelId: string) {
    const hostel = await loadOwnedHostel(prisma, actor, hostelId);
    if (stayModeOf(hostel.propertyType) !== 'TENANCY') throw Errors.conflict('Tenancy terms only apply to hostels and PGs');
    return pick(hostel);
  },

  /** Defaults for future tenancies. Tenancies already created keep the terms they were created with. */
  async updateOwnerTerms(actor: Actor, hostelId: string, input: TenancyTermsInput) {
    return prisma.$transaction(async (tx) => {
      const hostel = await loadOwnedHostel(tx, actor, hostelId);
      if (stayModeOf(hostel.propertyType) !== 'TENANCY') throw Errors.conflict('Tenancy terms only apply to hostels and PGs');
      const after = await tx.hostel.update({ where: { id: hostelId }, data: input });
      await recordAudit({ action: 'hostel.tenancy_terms.update', entityType: 'hostel', entityId: hostelId, before: pick(hostel), after: pick(after), metadata: { hostelId } }, tx);
      return pick(after);
    });
  },
};

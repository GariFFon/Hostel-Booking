import type { PriceRule } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { parseDate, toDateString } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { loadOwnedRoomType } from '@/modules/hostels/hostels.policy';
import { OWNER_EDITABLE } from '@/modules/hostels/hostels.status';
import { validatePriceRule, type CreatePriceRuleInput, type UpdatePriceRuleInput } from './price-rules.schema';

const MAX_RULES_PER_ROOM = 20;

export const toPriceRuleDto = (r: PriceRule) => ({
  id: r.id, roomTypeId: r.roomTypeId, type: r.type, name: r.name, weekdays: r.weekdays,
  startDate: r.startDate ? toDateString(r.startDate) : null, endDate: r.endDate ? toDateString(r.endDate) : null,
  pricePaise: r.pricePaise, adjustmentBps: r.adjustmentBps, priority: r.priority, isActive: r.isActive,
});

async function loadOwnedRule(actor: Actor, ruleId: string) {
  const rule = await prisma.priceRule.findFirst({ where: { id: ruleId, roomType: { deletedAt: null, hostel: { ownerId: actor.id, deletedAt: null } } }, include: { roomType: { include: { hostel: true } } } });
  if (!rule) throw Errors.notFound('Price rule');
  return rule;
}

export const priceRulesService = {
  async list(actor: Actor, roomTypeId: string) {
    const room = await loadOwnedRoomType(prisma, actor, roomTypeId);
    return (await prisma.priceRule.findMany({ where: { roomTypeId: room.id }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] })).map(toPriceRuleDto);
  },

  async create(actor: Actor, roomTypeId: string, input: CreatePriceRuleInput) {
    const { rule: created, hostelId } = await prisma.$transaction(async (tx) => {
      const room = await loadOwnedRoomType(tx, actor, roomTypeId);
      if (!OWNER_EDITABLE.includes(room.hostel.status)) throw Errors.conflict('Withdraw the listing from review before editing it');
      if ((await tx.priceRule.count({ where: { roomTypeId } })) >= MAX_RULES_PER_ROOM) throw Errors.conflict(`At most ${MAX_RULES_PER_ROOM} price rules per room type`);
      const rule = await tx.priceRule.create({
        data: { roomTypeId, type: input.type, name: input.name, weekdays: input.weekdays, startDate: input.startDate ? parseDate(input.startDate) : null, endDate: input.endDate ? parseDate(input.endDate) : null, pricePaise: input.pricePaise ?? null, adjustmentBps: input.adjustmentBps ?? null, priority: input.priority, isActive: input.isActive },
      });
      await recordAudit({ action: 'price_rule.create', entityType: 'room_type', entityId: roomTypeId, after: toPriceRuleDto(rule) }, tx);
      return { rule: toPriceRuleDto(rule), hostelId: room.hostelId };
    });
    await invalidateHostel(hostelId);
    return created;
  },

  async update(actor: Actor, ruleId: string, input: UpdatePriceRuleInput) {
    const existing = await loadOwnedRule(actor, ruleId);
    if (!OWNER_EDITABLE.includes(existing.roomType.hostel.status)) throw Errors.conflict('Withdraw the listing from review before editing it');
    const merged = {
      type: existing.type, weekdays: input.weekdays ?? existing.weekdays,
      startDate: input.startDate === undefined ? (existing.startDate ? toDateString(existing.startDate) : null) : input.startDate,
      endDate: input.endDate === undefined ? (existing.endDate ? toDateString(existing.endDate) : null) : input.endDate,
      pricePaise: input.pricePaise === undefined ? existing.pricePaise : input.pricePaise,
      adjustmentBps: input.adjustmentBps === undefined ? existing.adjustmentBps : input.adjustmentBps,
    };
    const issues = validatePriceRule(merged);
    if (issues.length) throw Errors.validation(issues);
    const updated = await prisma.$transaction(async (tx) => {
      const rule = await tx.priceRule.update({
        where: { id: ruleId },
        data: { name: input.name, weekdays: input.weekdays, startDate: input.startDate === undefined ? undefined : input.startDate ? parseDate(input.startDate) : null, endDate: input.endDate === undefined ? undefined : input.endDate ? parseDate(input.endDate) : null, pricePaise: input.pricePaise, adjustmentBps: input.adjustmentBps, priority: input.priority, isActive: input.isActive },
      });
      await recordAudit({ action: 'price_rule.update', entityType: 'room_type', entityId: existing.roomTypeId, before: toPriceRuleDto(existing), after: toPriceRuleDto(rule) }, tx);
      return toPriceRuleDto(rule);
    });
    await invalidateHostel(existing.roomType.hostelId);
    return updated;
  },

  async remove(actor: Actor, ruleId: string) {
    const existing = await loadOwnedRule(actor, ruleId);
    if (!OWNER_EDITABLE.includes(existing.roomType.hostel.status)) throw Errors.conflict('Withdraw the listing from review before editing it');
    await prisma.$transaction(async (tx) => {
      await tx.priceRule.delete({ where: { id: ruleId } });
      await recordAudit({ action: 'price_rule.delete', entityType: 'room_type', entityId: existing.roomTypeId, before: toPriceRuleDto(existing) }, tx);
    });
    await invalidateHostel(existing.roomType.hostelId);
  },
};

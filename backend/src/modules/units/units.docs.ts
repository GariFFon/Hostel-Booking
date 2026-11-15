import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { createUnitsSchema, unitDtoSchema, updateUnitSchema } from './units.schema';

const O = ['Owner · Units'];
const done = z.strictObject({ deleted: z.boolean() });

documentRoute({ method: 'get', path: '/owner/room-types/{id}/units', summary: 'Physical beds/rooms of a long-term room type', tags: O, auth: true, response: z.array(unitDtoSchema), errors: [404] });
documentRoute({ method: 'get', path: '/owner/room-types/{id}/free-units', summary: 'Beds of a long-term room type that nobody holds (active and without a live tenancy)', tags: O, auth: true, response: z.array(unitDtoSchema), errors: [404] });
documentRoute({ method: 'post', path: '/owner/room-types/{id}/units', summary: 'Add units (capacity cannot exceed the room type total)', tags: O, auth: true, body: createUnitsSchema, response: z.array(unitDtoSchema), status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'patch', path: '/owner/units/{id}', summary: 'Rename a unit, set its floor, or mark it maintenance/retired', tags: O, auth: true, body: updateUnitSchema, response: unitDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'delete', path: '/owner/units/{id}', summary: 'Remove a unit (its label becomes reusable)', tags: O, auth: true, response: done, errors: [404] });

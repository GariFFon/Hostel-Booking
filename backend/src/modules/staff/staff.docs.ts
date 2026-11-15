import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { acceptStaffInviteSchema, adminInviteSchema, adminStaffDtoSchema, ownerInviteSchema, ownerStaffDtoSchema, setHostelsSchema, setStatusSchema, staffInviteDtoSchema, staffMeDtoSchema, vendorDtoSchema } from './staff.schema';

const O = ['Owner · Staff'];
const A = ['Admin'];
const cancelled = z.strictObject({ cancelled: z.boolean() });

documentRoute({ method: 'get', path: '/staff/me', summary: 'My staff profile: trade, employer and the properties I work at', tags: ['Staff'], auth: true, response: staffMeDtoSchema, errors: [403, 404] });
documentRoute({ method: 'post', path: '/staff-invites/accept', summary: 'Accept an invitation to become staff (grants the STAFF role; sign in again to refresh your session)', tags: ['Staff'], auth: true, body: acceptStaffInviteSchema, response: staffMeDtoSchema, errors: [404, 409] });

documentRoute({ method: 'get', path: '/owner/staff', summary: 'My staff, engaged vendors and pending invitations', tags: O, auth: true, response: ownerStaffDtoSchema });
documentRoute({ method: 'get', path: '/owner/staff/vendors', summary: 'Platform vendors I can engage', tags: O, auth: true, response: z.array(vendorDtoSchema) });
documentRoute({ method: 'post', path: '/owner/staff/invites', summary: 'Invite someone by email to be my staff at some of my hostels or PGs', tags: O, auth: true, body: ownerInviteSchema, response: staffInviteDtoSchema, status: 201, errors: [409, 422] });
documentRoute({ method: 'delete', path: '/owner/staff/invites/{id}', summary: 'Cancel a pending invitation', tags: O, auth: true, response: cancelled, errors: [404] });
documentRoute({ method: 'put', path: '/owner/staff/{id}/hostels', summary: 'Set exactly which of my properties a staff member or vendor works at (removing one hands back their open jobs there)', tags: O, auth: true, body: setHostelsSchema, response: ownerStaffDtoSchema, errors: [404, 422] });
documentRoute({ method: 'post', path: '/owner/staff/{id}/status', summary: 'Deactivate or reactivate my own staff member (deactivating hands back all their open jobs)', tags: O, auth: true, body: setStatusSchema, response: ownerStaffDtoSchema, errors: [404, 409] });

documentRoute({ method: 'get', path: '/admin/staff', summary: 'All staff and vendors', tags: A, auth: true, response: z.array(adminStaffDtoSchema) });
documentRoute({ method: 'post', path: '/admin/staff/invites', summary: 'Invite a platform vendor that owners can engage', tags: A, auth: true, body: adminInviteSchema, response: staffInviteDtoSchema, status: 201, errors: [409, 422] });
documentRoute({ method: 'delete', path: '/admin/staff/invites/{id}', summary: 'Cancel a pending invitation', tags: A, auth: true, response: cancelled, errors: [404] });
documentRoute({ method: 'post', path: '/admin/staff/{id}/status', summary: 'Deactivate or reactivate any staff member or vendor', tags: A, auth: true, body: setStatusSchema, response: z.array(adminStaffDtoSchema), errors: [404, 409] });

import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { paginationSchema } from '@/core/http/pagination';
import { createHostelSchema, hostelStatusSchema, reasonSchema, updateHostelSchema } from '@/modules/hostels/hostels.schema';
import { addKycDocumentSchema, kycListQuerySchema, kycRejectSchema, updateOwnerProfileSchema } from '@/modules/kyc/kyc.schema';
import { addMediaSchema, reorderMediaSchema, updateMediaSchema } from '@/modules/media/media.schema';
import { createPriceRuleSchema, updatePriceRuleSchema } from '@/modules/pricing/price-rules.schema';
import { blockSchema, calendarQuerySchema, createRoomTypeSchema, updateRoomTypeSchema } from '@/modules/rooms/rooms.schema';
import { createAmenitySchema, updateAmenitySchema } from '@/modules/amenities/amenities.schema';
import { signatureRequestSchema, signatureResponseSchema } from '@/modules/uploads/uploads.schema';
import {
  adminHostelDetailSchema, adminHostelListItemSchema, adminHostelSchema, adminKycListItemSchema, adminKycSchema, amenityDtoSchema, calendarNightSchema,
  hostelDtoSchema, hostelSummarySchema, mediaDtoSchema, ownerKycSchema, priceRuleDtoSchema, roomTypeDtoSchema,
} from './listings.dto';
import { userDtoSchema } from './auth/auth.schema';

const done = z.object({ deleted: z.boolean() });
const O = ['Owner']; const A = ['Admin']; const P = ['Public'];

documentRoute({ method: 'post', path: '/uploads/signature', summary: 'Get a signed Cloudinary upload (upload the file directly to uploadUrl with these fields, then attach the publicId)', tags: ['Uploads'], auth: true, body: signatureRequestSchema, response: signatureResponseSchema, errors: [403, 404, 409] });
documentRoute({ method: 'put', path: '/me/avatar', summary: 'Set the avatar from a signed AVATAR upload', tags: ['Me'], auth: true, body: z.object({ publicId: z.string() }), response: userDtoSchema });

documentRoute({ method: 'get', path: '/amenities', summary: 'All amenities', tags: P, response: z.array(amenityDtoSchema) });

documentRoute({ method: 'get', path: '/owner/profile', summary: 'Owner business details and KYC status', tags: O, auth: true, response: ownerKycSchema, errors: [403] });
documentRoute({ method: 'patch', path: '/owner/profile', summary: 'Update business details (not while under review)', tags: O, auth: true, body: updateOwnerProfileSchema, response: ownerKycSchema, errors: [403, 409] });
documentRoute({ method: 'post', path: '/owner/kyc/documents', summary: 'Attach an uploaded (KYC_DOCUMENT) file', tags: O, auth: true, body: addKycDocumentSchema, response: ownerKycSchema, status: 201, errors: [403, 409] });
documentRoute({ method: 'delete', path: '/owner/kyc/documents/{id}', summary: 'Remove a KYC document', tags: O, auth: true, response: ownerKycSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/kyc/submit', summary: 'Submit KYC for admin review', tags: O, auth: true, response: ownerKycSchema, errors: [403, 409] });

documentRoute({ method: 'get', path: '/owner/hostels', summary: 'My listings (cursor-paginated)', tags: O, auth: true, query: paginationSchema.extend({ status: hostelStatusSchema.optional() }), response: z.array(hostelSummarySchema), errors: [403] });
documentRoute({ method: 'post', path: '/owner/hostels', summary: 'Create a listing (DRAFT)', tags: O, auth: true, body: createHostelSchema, response: hostelDtoSchema, status: 201, errors: [403, 409] });
documentRoute({ method: 'get', path: '/owner/hostels/{id}', summary: 'One of my listings', tags: O, auth: true, response: hostelDtoSchema, errors: [404] });
documentRoute({ method: 'patch', path: '/owner/hostels/{id}', summary: 'Edit a listing (partial; optional expectedVersion for optimistic locking)', tags: O, auth: true, body: updateHostelSchema, response: hostelDtoSchema, errors: [404, 409] });
documentRoute({ method: 'delete', path: '/owner/hostels/{id}', summary: 'Delete a listing (blocked by live bookings)', tags: O, auth: true, response: done, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/hostels/{id}/submit', summary: 'Submit for admin review (422 lists what is missing)', tags: O, auth: true, response: hostelDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/hostels/{id}/withdraw', summary: 'Withdraw from review / take offline', tags: O, auth: true, response: hostelDtoSchema, errors: [404, 409] });

documentRoute({ method: 'get', path: '/owner/hostels/{id}/room-types', summary: 'Room types of a listing', tags: O, auth: true, response: z.array(roomTypeDtoSchema), errors: [404] });
documentRoute({ method: 'post', path: '/owner/hostels/{id}/room-types', summary: 'Add a dorm or private room type', tags: O, auth: true, body: createRoomTypeSchema, response: roomTypeDtoSchema, status: 201, errors: [404, 409] });
documentRoute({ method: 'get', path: '/owner/room-types/{id}', summary: 'One room type', tags: O, auth: true, response: roomTypeDtoSchema, errors: [404] });
documentRoute({ method: 'patch', path: '/owner/room-types/{id}', summary: 'Edit a room type (capacity cannot drop below committed units)', tags: O, auth: true, body: updateRoomTypeSchema, response: roomTypeDtoSchema, errors: [404, 409] });
documentRoute({ method: 'delete', path: '/owner/room-types/{id}', summary: 'Delete a room type', tags: O, auth: true, response: done, errors: [404, 409] });
documentRoute({ method: 'get', path: '/owner/room-types/{id}/calendar', summary: 'Nightly availability counters', tags: O, auth: true, query: calendarQuerySchema, response: z.array(calendarNightSchema), errors: [404] });
documentRoute({ method: 'put', path: '/owner/room-types/{id}/blocks', summary: 'Block units for a date range (units 0 clears)', tags: O, auth: true, body: blockSchema, response: z.object({ nights: z.number().int() }), errors: [404, 409] });
documentRoute({ method: 'get', path: '/owner/room-types/{id}/price-rules', summary: 'Price rules', tags: O, auth: true, response: z.array(priceRuleDtoSchema), errors: [404] });
documentRoute({ method: 'post', path: '/owner/room-types/{id}/price-rules', summary: 'Add a weekend or date-range price rule', tags: O, auth: true, body: createPriceRuleSchema, response: priceRuleDtoSchema, status: 201, errors: [404, 409] });
documentRoute({ method: 'patch', path: '/owner/price-rules/{id}', summary: 'Edit a price rule', tags: O, auth: true, body: updatePriceRuleSchema, response: priceRuleDtoSchema, errors: [404, 409] });
documentRoute({ method: 'delete', path: '/owner/price-rules/{id}', summary: 'Delete a price rule', tags: O, auth: true, response: done, errors: [404, 409] });

documentRoute({ method: 'get', path: '/owner/hostels/{id}/media', summary: 'Photos', tags: O, auth: true, response: z.array(mediaDtoSchema), errors: [404] });
documentRoute({ method: 'post', path: '/owner/hostels/{id}/media', summary: 'Attach an uploaded photo (verified with the storage provider)', tags: O, auth: true, body: addMediaSchema, response: mediaDtoSchema, status: 201, errors: [404, 409] });
documentRoute({ method: 'put', path: '/owner/hostels/{id}/media/order', summary: 'Reorder photos (send every id)', tags: O, auth: true, body: reorderMediaSchema, response: z.array(mediaDtoSchema), errors: [404, 409] });
documentRoute({ method: 'patch', path: '/owner/media/{id}', summary: 'Edit alt text or make the cover', tags: O, auth: true, body: updateMediaSchema, response: mediaDtoSchema, errors: [404, 409] });
documentRoute({ method: 'delete', path: '/owner/media/{id}', summary: 'Delete a photo', tags: O, auth: true, response: done, errors: [404, 409] });

documentRoute({ method: 'post', path: '/admin/amenities', summary: 'Create an amenity', tags: A, auth: true, body: createAmenitySchema, response: amenityDtoSchema, status: 201, errors: [403, 409] });
documentRoute({ method: 'patch', path: '/admin/amenities/{id}', summary: 'Edit an amenity', tags: A, auth: true, body: updateAmenitySchema, response: amenityDtoSchema, errors: [403, 404] });
documentRoute({ method: 'delete', path: '/admin/amenities/{id}', summary: 'Delete an unused amenity', tags: A, auth: true, response: done, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/admin/hostels', summary: 'Moderation queue (default PENDING_REVIEW, oldest first)', tags: A, auth: true, query: paginationSchema.extend({ status: hostelStatusSchema.optional() }), response: z.array(adminHostelListItemSchema), errors: [403] });
documentRoute({ method: 'get', path: '/admin/hostels/{id}', summary: 'Listing with owner info and recent history', tags: A, auth: true, response: adminHostelDetailSchema, errors: [403, 404] });
documentRoute({ method: 'post', path: '/admin/hostels/{id}/approve', summary: 'Approve (owner KYC must be approved)', tags: A, auth: true, response: adminHostelSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/admin/hostels/{id}/reject', summary: 'Reject with a reason', tags: A, auth: true, body: reasonSchema, response: adminHostelSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/admin/hostels/{id}/suspend', summary: 'Suspend a published listing', tags: A, auth: true, body: reasonSchema, response: adminHostelSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/admin/hostels/{id}/reinstate', summary: 'Reinstate a suspended listing', tags: A, auth: true, response: adminHostelSchema, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/admin/kyc', summary: 'KYC queue (default PENDING)', tags: A, auth: true, query: paginationSchema.extend(kycListQuerySchema.shape), response: z.array(adminKycListItemSchema), errors: [403] });
documentRoute({ method: 'get', path: '/admin/kyc/{ownerId}', summary: 'Owner KYC with 10-minute private document links (access is audited)', tags: A, auth: true, response: adminKycSchema, errors: [403, 404] });
documentRoute({ method: 'post', path: '/admin/kyc/{ownerId}/approve', summary: 'Approve KYC', tags: A, auth: true, response: z.object({ ownerId: z.uuid(), kycStatus: z.string() }), errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/admin/kyc/{ownerId}/reject', summary: 'Reject KYC with a reason', tags: A, auth: true, body: kycRejectSchema, response: z.object({ ownerId: z.uuid(), kycStatus: z.string() }), errors: [403, 404, 409] });

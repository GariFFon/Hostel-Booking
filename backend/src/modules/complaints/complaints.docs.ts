import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import {
  attachMediaSchema, commentSchema, complaintDetailSchema, complaintSummarySchema, createComplaintSchema, listComplaintsQuerySchema, ownerActionSchema, ownerListComplaintsQuerySchema,
  staffActionSchema, staffListComplaintsQuerySchema, tenantActionSchema,
} from './complaints.schema';

const T = ['Complaints'];
const O = ['Owner · Complaints'];
const S = ['Staff'];

documentRoute({ method: 'post', path: '/me/complaints', summary: 'File a complaint (needs a running stay). It is auto-assigned to matching staff when there are any', tags: T, auth: true, body: createComplaintSchema, response: complaintDetailSchema, status: 201, errors: [409, 422] });
documentRoute({ method: 'get', path: '/me/complaints', summary: 'My complaints', tags: T, auth: true, query: listComplaintsQuerySchema, response: z.array(complaintSummarySchema) });
documentRoute({ method: 'post', path: '/me/complaints/{id}/actions', summary: 'Tenant actions: close (confirm fixed or withdraw), reopen within 7 days, rate', tags: T, auth: true, body: tenantActionSchema, response: complaintDetailSchema, errors: [404, 409, 422] });
documentRoute({ method: 'get', path: '/complaints/{id}', summary: 'One complaint, shaped for who is asking (tenant, owner, assigned staff, admin). Internal notes are hidden from the tenant', tags: T, auth: true, response: complaintDetailSchema, errors: [404] });
documentRoute({ method: 'post', path: '/complaints/{id}/comments', summary: 'Add a message (owners and staff may mark it internal)', tags: T, auth: true, body: commentSchema, response: complaintDetailSchema, status: 201, errors: [403, 404, 409, 422] });
documentRoute({ method: 'post', path: '/complaints/{id}/media', summary: 'Attach a photo uploaded with a COMPLAINT_IMAGE signature', tags: T, auth: true, body: attachMediaSchema, response: complaintDetailSchema, status: 201, errors: [403, 404, 409, 422] });

documentRoute({ method: 'get', path: '/owner/complaints', summary: 'Complaints at my properties (filter by status, priority, staff, unassigned, overdue)', tags: O, auth: true, query: ownerListComplaintsQuerySchema, response: z.array(complaintSummarySchema) });
documentRoute({ method: 'post', path: '/owner/complaints/{id}/actions', summary: 'Owner actions: acknowledge, assign, unassign, reject, resolve, change priority', tags: O, auth: true, body: ownerActionSchema, response: complaintDetailSchema, errors: [404, 409, 422] });

documentRoute({ method: 'get', path: '/staff/complaints', summary: 'Jobs assigned to me', tags: S, auth: true, query: staffListComplaintsQuerySchema, response: z.array(complaintSummarySchema) });
documentRoute({ method: 'post', path: '/staff/complaints/{id}/actions', summary: 'Staff actions: start, put on hold (with a reason), resolve (with a note)', tags: S, auth: true, body: staffActionSchema, response: complaintDetailSchema, errors: [404, 409, 422] });

documentRoute({ method: 'get', path: '/admin/complaints', summary: 'All complaints (oversight, read-only)', tags: ['Admin'], auth: true, query: ownerListComplaintsQuerySchema, response: z.array(complaintSummarySchema) });

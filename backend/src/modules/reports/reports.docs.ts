import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { ownerAuditEntrySchema, ownerAuditQuerySchema } from '@/modules/audit/audit.schema';
import { duesReportSchema, occupancyReportSchema, reportQuerySchema } from './reports.schema';

const O = ['Owner · Reports'];

documentRoute({ method: 'get', path: '/owner/audit-logs', summary: 'The audit trail of my own properties (newest first, filterable, keyset pagination). No network addresses or device details.', tags: O, auth: true, query: ownerAuditQuerySchema, response: z.array(ownerAuditEntrySchema), errors: [403, 404] });
documentRoute({ method: 'get', path: '/owner/reports/occupancy', summary: 'Beds by state (lived in, on notice, reserved, out of service, free) per property and room type, and who is leaving soon', tags: O, auth: true, query: reportQuerySchema, response: occupancyReportSchema, errors: [403, 404] });
documentRoute({ method: 'get', path: '/owner/reports/dues', summary: 'Rent still owed by how overdue it is, and who owes it', tags: O, auth: true, query: reportQuerySchema, response: duesReportSchema, errors: [403, 404] });

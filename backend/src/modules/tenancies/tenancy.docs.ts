import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import {
  acceptInviteSchema, applicationDtoSchema, approveApplicationSchema, cancelTenancySchema, createApplicationSchema, createTenancySchema, listApplicationsQuerySchema,
  listTenanciesQuerySchema, ownerListApplicationsQuerySchema, ownerListTenanciesQuerySchema, publicTenancyTermsSchema, recordDepositSchema, rejectApplicationSchema,
  giveNoticeSchema, moveOutSchema, tenancyDtoSchema, tenancyTermsSchema, updateTenancyTermsDefaultsSchema, updateTenancyTermsSchema,
} from './tenancy.schema';
import { attachProofSchema, disputeSettlementSchema, recordPayoutSchema, resolveSettlementSchema, saveSettlementSchema, settlementDtoSchema } from './deposits.schema';
import { rentOrderDtoSchema } from '@/modules/rent/rent.schema';

const T = ['Tenancy'];
const O = ['Owner · Tenants'];
const A = ['Admin'];

// ── tenant ──
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}/tenancy-terms', summary: 'Terms of a long-term property and the free beds per room type', tags: T, response: publicTenancyTermsSchema, errors: [404] });
documentRoute({ method: 'post', path: '/hostels/{idOrSlug}/tenancy-applications', summary: 'Ask for a bed at a hostel or PG (verified email required)', tags: T, auth: true, body: createApplicationSchema, response: applicationDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'get', path: '/me/tenancy-applications', summary: 'My requests for a bed', tags: T, auth: true, query: listApplicationsQuerySchema, response: z.array(applicationDtoSchema) });
documentRoute({ method: 'post', path: '/me/tenancy-applications/{id}/withdraw', summary: 'Withdraw an open request', tags: T, auth: true, response: applicationDtoSchema, errors: [404, 409] });
documentRoute({ method: 'get', path: '/me/tenancies', summary: 'My stays', tags: T, auth: true, query: listTenanciesQuerySchema, response: z.array(tenancyDtoSchema) });
documentRoute({ method: 'get', path: '/me/tenancies/{id}', summary: 'One of my stays', tags: T, auth: true, response: tenancyDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/accept', summary: 'Accept an invitation from an owner', tags: T, auth: true, response: tenancyDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/decline', summary: 'Decline a stay that has not started', tags: T, auth: true, response: tenancyDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/me/tenancy-invites/accept', summary: 'Accept an invitation sent to an email address using the emailed token', tags: T, auth: true, body: acceptInviteSchema, response: tenancyDtoSchema, errors: [404, 409] });

// ── owner ──
documentRoute({ method: 'get', path: '/owner/tenancy-applications', summary: 'Requests for beds at my properties', tags: O, auth: true, query: ownerListApplicationsQuerySchema, response: z.array(applicationDtoSchema) });
documentRoute({ method: 'get', path: '/owner/tenancy-applications/{id}', summary: 'One request', tags: O, auth: true, response: applicationDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/owner/tenancy-applications/{id}/approve', summary: 'Approve: reserves a free bed and creates the stay', tags: O, auth: true, body: approveApplicationSchema, response: applicationDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/tenancy-applications/{id}/reject', summary: 'Decline a request with a reason', tags: O, auth: true, body: rejectApplicationSchema, response: applicationDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'get', path: '/owner/tenancies', summary: 'Stays at my properties', tags: O, auth: true, query: ownerListTenanciesQuerySchema, response: z.array(tenancyDtoSchema) });
documentRoute({ method: 'post', path: '/owner/tenancies', summary: 'Add or invite a tenant by email', tags: O, auth: true, body: createTenancySchema, response: tenancyDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'get', path: '/owner/tenancies/{id}', summary: 'One stay', tags: O, auth: true, response: tenancyDtoSchema, errors: [404] });
documentRoute({ method: 'patch', path: '/owner/tenancies/{id}', summary: 'Change terms before move-in', tags: O, auth: true, body: updateTenancyTermsSchema, response: tenancyDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/deposit', summary: 'Record that the deposit was received (cash, UPI or bank)', tags: O, auth: true, body: recordDepositSchema, response: tenancyDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/activate', summary: 'Record move-in (needs the deposit)', tags: O, auth: true, response: tenancyDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/cancel', summary: 'Cancel a stay before move-in', tags: O, auth: true, body: cancelTenancySchema, response: tenancyDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'get', path: '/owner/hostels/{id}/tenancy-terms', summary: 'Default deposit, notice and rent-due terms of a long-term property', tags: O, auth: true, response: tenancyTermsSchema, errors: [404, 409] });
documentRoute({ method: 'patch', path: '/owner/hostels/{id}/tenancy-terms', summary: 'Change the defaults for future stays (existing stays keep theirs)', tags: O, auth: true, body: updateTenancyTermsDefaultsSchema, response: tenancyTermsSchema, errors: [404, 409, 422] });

// ── admin ──
documentRoute({ method: 'get', path: '/admin/tenancies', summary: 'All stays (oversight)', tags: A, auth: true, query: ownerListTenanciesQuerySchema, response: z.array(tenancyDtoSchema) });
documentRoute({ method: 'get', path: '/admin/tenancies/{id}', summary: 'One stay', tags: A, auth: true, response: tenancyDtoSchema, errors: [404] });

// ── move-out and the security deposit (phase 14) ──
documentRoute({ method: 'post', path: '/me/tenancies/{id}/notice', summary: 'Give notice: choose the day I will have moved out (at least the stay\'s notice period away)', tags: T, auth: true, body: giveNoticeSchema, response: tenancyDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/notice/withdraw', summary: 'Withdraw the notice I gave', tags: T, auth: true, response: tenancyDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/deposit/payments', summary: 'Start (or resume) an online payment of the security deposit. Complete it through the rent-order endpoints.', tags: T, auth: true, response: rentOrderDtoSchema, status: 201, errors: [404, 409] });
documentRoute({ method: 'get', path: '/me/tenancies/{id}/settlement', summary: 'The deposit settlement the owner sent me', tags: T, auth: true, response: settlementDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/settlement/accept', summary: 'Accept the deposit settlement (silence for 7 days counts as acceptance)', tags: T, auth: true, response: settlementDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/settlement/dispute', summary: 'Dispute the deposit settlement, saying what is wrong', tags: T, auth: true, body: disputeSettlementSchema, response: settlementDtoSchema, errors: [404, 409, 422] });

documentRoute({ method: 'post', path: '/owner/tenancies/{id}/notice', summary: 'Serve notice on a running stay', tags: O, auth: true, body: giveNoticeSchema, response: tenancyDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/notice/withdraw', summary: 'Withdraw notice I served', tags: O, auth: true, response: tenancyDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/move-out', summary: 'Record that the tenant has left: ends the stay, frees the bed and starts the deposit settlement', tags: O, auth: true, body: moveOutSchema, response: tenancyDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'get', path: '/owner/tenancies/{id}/settlement', summary: 'The deposit settlement of an ended stay (a draft is made on first look, with unpaid rent pre-filled)', tags: O, auth: true, response: settlementDtoSchema, errors: [404] });
documentRoute({ method: 'put', path: '/owner/tenancies/{id}/settlement', summary: 'Save the itemised deductions (replaces the list)', tags: O, auth: true, body: saveSettlementSchema, response: settlementDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/settlement/proofs', summary: 'Attach a photo uploaded with a DEPOSIT_PROOF signature', tags: O, auth: true, body: attachProofSchema, response: settlementDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'delete', path: '/owner/tenancies/{id}/settlement/proofs/{proofId}', summary: 'Remove a proof photo', tags: O, auth: true, response: settlementDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/settlement/propose', summary: 'Send the settlement to the tenant (7 days to respond)', tags: O, auth: true, response: settlementDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/settlement/retract', summary: 'Take a proposal back to a draft', tags: O, auth: true, response: settlementDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/settlement/payout', summary: 'Record how a cash/UPI/bank deposit refund was paid', tags: O, auth: true, body: recordPayoutSchema, response: settlementDtoSchema, errors: [404, 409] });

documentRoute({ method: 'get', path: '/admin/tenancies/{id}/settlement', summary: 'A deposit settlement (oversight)', tags: A, auth: true, response: settlementDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/admin/tenancies/{id}/settlement/resolve', summary: 'Settle a disputed deposit settlement: the admin\'s itemisation is final', tags: A, auth: true, body: resolveSettlementSchema, response: settlementDtoSchema, errors: [404, 409, 422] });

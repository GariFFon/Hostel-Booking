import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import {
  addLineSchema, demoCheckoutRentSchema, invoiceDtoSchema, listInvoicesQuerySchema, ownerListInvoicesQuerySchema, recordPaymentSchema, rentOrderDtoSchema, rentRollDtoSchema, rentRollQuerySchema,
  receiptLinkDtoSchema, refundPaymentSchema, reversePaymentSchema, voidInvoiceSchema,
} from './rent.schema';

const T = ['Rent'];
const O = ['Owner · Rent'];

// ── tenant ──
documentRoute({ method: 'get', path: '/me/rent-invoices', summary: 'My rent invoices', tags: T, auth: true, query: listInvoicesQuerySchema, response: z.array(invoiceDtoSchema) });
documentRoute({ method: 'get', path: '/me/rent-invoices/{id}', summary: 'One of my invoices, with its payments and receipts', tags: T, auth: true, response: invoiceDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/me/rent-invoices/{id}/payments', summary: 'Start (or resume) an online payment of the invoice balance', tags: T, auth: true, response: rentOrderDtoSchema, status: 201, errors: [404, 409] });
documentRoute({ method: 'get', path: '/me/rent-orders/{id}', summary: 'Status of an online rent payment', tags: T, auth: true, response: rentOrderDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/me/rent-orders/{id}/demo-checkout', summary: 'Demo gateway: complete the payment with a test instrument', tags: T, auth: true, body: demoCheckoutRentSchema, response: rentOrderDtoSchema, errors: [404, 409] });

documentRoute({ method: 'post', path: '/me/rent-payments/{id}/receipt-link', summary: 'A five-minute link to the PDF receipt of one of my payments', tags: T, auth: true, response: receiptLinkDtoSchema, errors: [404, 409] });

// ── owner ──
documentRoute({ method: 'get', path: '/owner/rent-invoices', summary: 'Rent invoices of my properties (filter by status, month, overdue)', tags: O, auth: true, query: ownerListInvoicesQuerySchema, response: z.array(invoiceDtoSchema) });
documentRoute({ method: 'get', path: '/owner/rent-invoices/{id}', summary: 'One invoice', tags: O, auth: true, response: invoiceDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/owner/rent-invoices/{id}/payments', summary: 'Record rent received outside the app (cash, UPI, bank)', tags: O, auth: true, body: recordPaymentSchema, response: invoiceDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/rent-invoices/{id}/lines', summary: 'Add a charge (electricity, maintenance, adjustment) or a credit to an open invoice', tags: O, auth: true, body: addLineSchema, response: invoiceDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/rent-invoices/{id}/void', summary: 'Cancel an unpaid invoice', tags: O, auth: true, body: voidInvoiceSchema, response: invoiceDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/rent-payments/{id}/reverse', summary: 'Undo a payment recorded by mistake (not for online payments)', tags: O, auth: true, body: reversePaymentSchema, response: invoiceDtoSchema, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/rent-payments/{id}/refund', summary: 'Refund part or all of an online rent payment to the tenant', tags: O, auth: true, body: refundPaymentSchema, response: invoiceDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/owner/rent-payments/{id}/receipt-link', summary: 'A five-minute link to the PDF receipt of a payment', tags: O, auth: true, response: receiptLinkDtoSchema, errors: [404, 409] });
documentRoute({ method: 'get', path: '/owner/rent-roll', summary: 'Billed, collected and outstanding rent for a month, per property', tags: O, auth: true, query: rentRollQuerySchema, response: rentRollDtoSchema });

// ── admin ──
documentRoute({ method: 'get', path: '/admin/rent-invoices', summary: 'All rent invoices (oversight)', tags: ['Admin'], auth: true, query: ownerListInvoicesQuerySchema, response: z.array(invoiceDtoSchema) });
documentRoute({ method: 'get', path: '/admin/rent-invoices/{id}', summary: 'One rent invoice, with its payments and refunds', tags: ['Admin'], auth: true, response: invoiceDtoSchema, errors: [404] });
documentRoute({ method: 'get', path: '/admin/rent-roll', summary: 'Billed, collected and outstanding rent across the platform for a month, per property', tags: ['Admin'], auth: true, query: rentRollQuerySchema, response: rentRollDtoSchema });
documentRoute({ method: 'post', path: '/admin/rent-payments/{id}/refund', summary: 'Refund part or all of an online rent payment to the tenant', tags: ['Admin'], auth: true, body: refundPaymentSchema, response: invoiceDtoSchema, status: 201, errors: [404, 409, 422] });
documentRoute({ method: 'post', path: '/admin/rent-payments/{id}/receipt-link', summary: 'A five-minute link to the PDF receipt of a payment', tags: ['Admin'], auth: true, response: receiptLinkDtoSchema, errors: [404, 409] });
documentRoute({ method: 'get', path: '/receipts/{token}', summary: 'The PDF receipt behind a signed link (application/pdf; the signed token in the path is the credential)', tags: T, auth: false, response: z.string(), errors: [404] });

// ── PDF invoices and deposit receipts ──
documentRoute({ method: 'post', path: '/me/rent-invoices/{id}/pdf-link', summary: 'A five-minute link to one of my invoices as a PDF', tags: T, auth: true, response: receiptLinkDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/owner/rent-invoices/{id}/pdf-link', summary: 'A five-minute link to an invoice of mine as a PDF', tags: O, auth: true, response: receiptLinkDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/admin/rent-invoices/{id}/pdf-link', summary: 'A five-minute link to an invoice as a PDF', tags: ['Admin'], auth: true, response: receiptLinkDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/me/tenancies/{id}/deposit-receipt-link', summary: 'A five-minute link to my security-deposit receipt as a PDF (once the deposit was received)', tags: T, auth: true, response: receiptLinkDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/owner/tenancies/{id}/deposit-receipt-link', summary: 'A five-minute link to the security-deposit receipt of a stay as a PDF', tags: O, auth: true, response: receiptLinkDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/admin/tenancies/{id}/deposit-receipt-link', summary: 'A five-minute link to the security-deposit receipt of a stay as a PDF', tags: ['Admin'], auth: true, response: receiptLinkDtoSchema, errors: [404, 409] });

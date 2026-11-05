// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { getCompanyCurrency } from '@evtivity/database';
import type { InvoiceSellerSnapshot } from '@evtivity/database';
import { taxBreakdownWithGross, taxOnNet } from '@evtivity/lib';
import type { InvoiceDetail } from './invoice.service.js';
import type { InvoiceLanguage } from './invoice-labels.js';
import type { PdfLetterhead } from './invoice-letterhead.js';
import { generateInvoicePdf } from './invoice-pdf.service.js';

/** Enough sessions for a second page, so the preview shows its header too. */
const PREVIEW_SESSIONS = 30;
const PREVIEW_TAX_RATE = 0.19;

/**
 * A sample member invoice for the letterhead preview: a recipient with a
 * postal address and a month of charging sessions. Nothing is stored.
 */
export function letterheadPreviewDetail(
  language: InvoiceLanguage,
  currency: string,
  now = new Date(),
  seller: InvoiceSellerSnapshot | null = null,
): InvoiceDetail {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = (d: number): string => new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10);
  const lineItems: InvoiceDetail['lineItems'] = [];
  for (let i = 0; i < PREVIEW_SESSIONS; i++) {
    const energyWh = 8000 + ((i * 3517) % 30000);
    const netCents = Math.round((energyWh / 1000) * 25);
    lineItems.push({
      id: i + 1,
      invoiceId: 'inv_preview',
      sessionId: null,
      paymentRecordId: null,
      description: 'Charging session',
      quantity: '1',
      unitPriceCents: netCents,
      totalCents: netCents,
      taxCents: taxOnNet(netCents, PREVIEW_TAX_RATE),
      taxRate: String(PREVIEW_TAX_RATE),
      metadata: { kind: 'session', sessionDate: day((i % 28) + 1), energyWh },
      createdAt: now,
    });
  }
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.totalCents, 0);
  const taxCents = lineItems.reduce((sum, item) => sum + item.taxCents, 0);
  return {
    invoice: {
      id: 'inv_preview',
      invoiceNumber: `${String(year).slice(2)}00001`,
      driverId: null,
      fleetId: null,
      periodStart: day(1),
      periodEnd: day(28),
      billTo: {
        name: 'Alex Example',
        street: '1 Sample Street',
        zip: '12345',
        city: 'Sample City',
        country: null,
        taxId: null,
      },
      language,
      sentAt: null,
      overdueNoticeSentAt: null,
      memberBilled: false,
      status: 'issued',
      kind: 'invoice',
      creditedInvoiceId: null,
      creditReason: null,
      issuedAt: now,
      dueAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      currency,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      paidAt: null,
      paymentReference: null,
      metadata: null,
      letterheadId: null,
      seller,
      issuerId: null,
      settlementNote: null,
      createdAt: now,
      updatedAt: now,
    },
    lineItems,
    driver: null,
    fleet: null,
    taxBreakdown: taxBreakdownWithGross([
      { taxRate: PREVIEW_TAX_RATE, netCents: subtotalCents, taxCents },
    ]),
    creditedInvoice: null,
    creditNote: null,
  };
}

/**
 * A sample invoice PDF on the given letterhead (stored or not), in the
 * company currency, with the seller, payment details and fonts a real
 * invoice in that language gets. A seller (an invoice issuer's) replaces
 * the company as seller.
 */
export async function generatePdfLetterheadPreview(
  letterhead: PdfLetterhead,
  language: InvoiceLanguage,
  seller: InvoiceSellerSnapshot | null = null,
): Promise<Buffer> {
  const currency = await getCompanyCurrency();
  return generateInvoicePdf(letterheadPreviewDetail(language, currency, new Date(), seller), {
    letterhead,
  });
}

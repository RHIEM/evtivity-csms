// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { inArray } from 'drizzle-orm';
import {
  COMPANY_INVOICE_EMAIL_KEY,
  COMPANY_INVOICE_PHONE_KEY,
  COMPANY_REGISTRATION_NUMBER_KEY,
  COMPANY_TAX_ID_KEY,
  COMPANY_TAX_ID_LABEL_KEY,
} from '@evtivity/lib';
import type { db } from '../config.js';
import { settings } from '../schema/settings.js';

/**
 * The seller of an invoice or credit note as it was at issue
 * (`invoices.seller`), never updated: the company name and address and the
 * invoice seller settings. The PDF prints it, so a later change of the
 * company settings does not change an issued document. Empty values are null.
 */
export interface InvoiceSellerSnapshot {
  name: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  taxId: string | null;
  taxIdLabel: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
}

/** The setting each field of the snapshot is read from. */
const SNAPSHOT_SETTING_KEYS: Record<keyof InvoiceSellerSnapshot, string> = {
  name: 'company.name',
  street: 'company.street',
  zip: 'company.zip',
  city: 'company.city',
  state: 'company.state',
  country: 'company.country',
  taxId: COMPANY_TAX_ID_KEY,
  taxIdLabel: COMPANY_TAX_ID_LABEL_KEY,
  registrationNumber: COMPANY_REGISTRATION_NUMBER_KEY,
  email: COMPANY_INVOICE_EMAIL_KEY,
  phone: COMPANY_INVOICE_PHONE_KEY,
};

/** The settings read for the snapshot. */
export const INVOICE_SELLER_SNAPSHOT_SETTING_KEYS = Object.values(SNAPSHOT_SETTING_KEYS);

function trimmedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The snapshot from the settings rows (key to value). */
export function invoiceSellerSnapshotFromSettings(
  values: Record<string, unknown>,
): InvoiceSellerSnapshot {
  const snapshot = {} as InvoiceSellerSnapshot;
  for (const [field, key] of Object.entries(SNAPSHOT_SETTING_KEYS)) {
    snapshot[field as keyof InvoiceSellerSnapshot] = trimmedOrNull(values[key]);
  }
  return snapshot;
}

/** What reads the seller settings: the invoice transaction. */
export type InvoiceSellerExecutor = Pick<typeof db, 'select'>;

/**
 * The seller snapshot of a new invoice, read inside the caller's transaction
 * from the current company settings.
 */
export async function loadInvoiceSellerSnapshot(
  tx: InvoiceSellerExecutor,
): Promise<InvoiceSellerSnapshot> {
  const rows = await tx
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, INVOICE_SELLER_SNAPSHOT_SETTING_KEYS));
  const values: Record<string, unknown> = {};
  for (const row of rows) values[row.key] = row.value;
  return invoiceSellerSnapshotFromSettings(values);
}

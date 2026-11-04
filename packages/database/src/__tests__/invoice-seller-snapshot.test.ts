// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ inArray: { column, values } })),
}));
vi.mock('../schema/settings.js', () => ({ settings: { key: 'key', value: 'value' } }));

import {
  INVOICE_SELLER_SNAPSHOT_SETTING_KEYS,
  invoiceSellerSnapshotFromSettings,
  loadInvoiceSellerSnapshot,
} from '../lib/invoice-seller-snapshot.js';
import type { InvoiceSellerExecutor } from '../lib/invoice-seller-snapshot.js';

const FULL_SETTINGS: Record<string, unknown> = {
  'company.name': 'Acme Charging',
  'company.street': 'Hauptstrasse 1',
  'company.zip': '10115',
  'company.city': 'Berlin',
  'company.state': '',
  'company.country': 'DE',
  'company.taxId': 'DE123456789',
  'company.taxIdLabel': 'USt-IdNr.',
  'company.registrationNumber': 'HRB 12345',
  'company.invoiceEmail': 'billing@acme.example',
  'company.invoicePhone': '+49 30 1234567',
};

describe('invoiceSellerSnapshotFromSettings', () => {
  it('keeps the company name, address and every invoice seller setting', () => {
    expect(invoiceSellerSnapshotFromSettings(FULL_SETTINGS)).toEqual({
      name: 'Acme Charging',
      street: 'Hauptstrasse 1',
      zip: '10115',
      city: 'Berlin',
      state: null,
      country: 'DE',
      taxId: 'DE123456789',
      taxIdLabel: 'USt-IdNr.',
      registrationNumber: 'HRB 12345',
      email: 'billing@acme.example',
      phone: '+49 30 1234567',
    });
  });

  it('trims values and keeps empty, missing and non-string values as null', () => {
    const snapshot = invoiceSellerSnapshotFromSettings({
      'company.name': '  Acme  ',
      'company.taxId': '   ',
      'company.zip': 10115,
    });
    expect(snapshot.name).toBe('Acme');
    expect(snapshot.taxId).toBeNull();
    expect(snapshot.zip).toBeNull();
    expect(snapshot.city).toBeNull();
  });
});

describe('loadInvoiceSellerSnapshot', () => {
  it('reads the seller settings in the given transaction', async () => {
    const where = vi.fn(() =>
      Promise.resolve(Object.entries(FULL_SETTINGS).map(([key, value]) => ({ key, value }))),
    );
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const tx = { select } as unknown as InvoiceSellerExecutor;

    const snapshot = await loadInvoiceSellerSnapshot(tx);

    expect(select).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledWith({
      inArray: { column: 'key', values: INVOICE_SELLER_SNAPSHOT_SETTING_KEYS },
    });
    expect(snapshot.name).toBe('Acme Charging');
    expect(snapshot.registrationNumber).toBe('HRB 12345');
  });
});

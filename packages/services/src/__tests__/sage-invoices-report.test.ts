// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { selectResults } = vi.hoisted(() => ({ selectResults: [] as unknown[][] }));

/** A select chain that resolves to the next queued result whatever it is joined or filtered by. */
function chain(): unknown {
  const result = Promise.resolve(selectResults.shift() ?? []);
  const proxy: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    proxy[method] = () => proxy;
  }
  proxy['then'] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    result.then(resolve, reject);
  return proxy;
}

vi.mock('@evtivity/database', () => ({
  db: { select: vi.fn(() => chain()) },
  drivers: {
    id: 'drivers.id',
    debtorNumber: 'drivers.debtor_number',
    employeeNumber: 'drivers.employee_number',
  },
  invoices: {
    id: 'invoices.id',
    invoiceNumber: 'invoices.invoice_number',
    issuedAt: 'invoices.issued_at',
    periodStart: 'invoices.period_start',
    periodEnd: 'invoices.period_end',
    currency: 'invoices.currency',
    kind: 'invoices.kind',
    status: 'invoices.status',
    fleetId: 'invoices.fleet_id',
    driverId: 'invoices.driver_id',
  },
  invoiceLineItems: {
    invoiceId: 'invoice_line_items.invoice_id',
    taxRate: 'invoice_line_items.tax_rate',
    totalCents: 'invoice_line_items.total_cents',
    taxCents: 'invoice_line_items.tax_cents',
  },
  settings: { key: 'settings.key', value: 'settings.value' },
  getSystemTimezone: vi.fn(() => Promise.resolve('UTC')),
}));

const { generateSageInvoicesReport, sageInvoicesFiltersError } =
  await import('../report-generators/sage-invoices-report.js');

const SETTINGS = [
  { key: 'sage.mandant', value: '2' },
  { key: 'sage.revenueAccount', value: '8400' },
  { key: 'sage.taxCodes', value: '19=3' },
  { key: 'sage.paymentTerms', value: 'BEZDebitor' },
];

const FILTERS = { dateFrom: '2026-12-01', dateTo: '2026-12-31' };

const INVOICE = {
  id: 'inv_1',
  invoiceNumber: 'INV-202611-0001',
  issuedDate: '2026-12-01',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  currency: 'EUR',
  debtorNumber: '10001',
  employeeNumber: '5678',
};

const CREDIT_NOTE = {
  id: 'inv_2',
  invoiceNumber: 'CN-202611-0001',
  issuedDate: '2026-12-02',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  currency: 'EUR',
  debtorNumber: '10001',
};

function run(
  filters: Record<string, unknown> = FILTERS,
  language: 'de' | 'en' = 'en',
  siteIds: string[] | null = null,
): Promise<{ data: Buffer; fileName: string }> {
  return generateSageInvoicesReport(filters, 'csv', language, siteIds);
}

beforeEach(() => {
  selectResults.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-12-02T06:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sageInvoicesFiltersError', () => {
  it('needs a date range from the first to the last day', () => {
    expect(sageInvoicesFiltersError(FILTERS)).toBeNull();
    expect(sageInvoicesFiltersError({})).not.toBeNull();
    expect(sageInvoicesFiltersError({ dateFrom: '2026-12-01' })).not.toBeNull();
    expect(
      sageInvoicesFiltersError({ dateFrom: '2026-12-31', dateTo: '2026-12-01' }),
    ).not.toBeNull();
    expect(
      sageInvoicesFiltersError({ dateFrom: '01.12.2026', dateTo: '31.12.2026' }),
    ).not.toBeNull();
  });
});

describe('generateSageInvoicesReport', () => {
  it('writes an invoice and a credit note in the layout of the RAB import', async () => {
    selectResults.push(
      SETTINGS,
      [INVOICE, CREDIT_NOTE],
      [
        { invoiceId: 'inv_1', taxRate: '0.19', netCents: 3950, taxCents: 750 },
        { invoiceId: 'inv_2', taxRate: '0.19', netCents: -988, taxCents: -187 },
      ],
    );

    const { data, fileName } = await run();

    expect(fileName).toBe('RAB-2-20261202060000.txt');
    const text = data.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.slice(1).split('\r\n')).toEqual([
      'Buchungsdatum;Belegdatum;Belegnummer;OPNr;Buchungstext;Konto_Soll;Konto_Haben;Umsatz;Umsatz_Eigenwaehrung;Waehrung;Steuerart;Steuercode;Steuerbetrag;Zahlungskondition',
      '01.12.2026;01.12.2026;INV-202611-0001;;E-Laden 11/2026;D10001;S8400;47,00;47,00;EUR;UH;3;7,50;BEZDebitor',
      '02.12.2026;02.12.2026;CN-202611-0001;;E-Laden 11/2026;D10001;S8400;-11,75;-11,75;EUR;UH;3;-1,87;BEZDebitor',
      '',
    ]);
  });

  it('takes the booking date, the OP number and the texts from the settings', async () => {
    selectResults.push(
      [
        ...SETTINGS,
        { key: 'sage.bookingDate', value: 'periodEnd' },
        { key: 'sage.opNumber', value: 'invoiceNumber' },
        { key: 'sage.postingText', value: 'Ladestrom {month}/{year} {invoiceNumber}' },
        { key: 'sage.fileName', value: 'RAB-{mandant}.txt' },
        { key: 'sage.debtorPrefix', value: 'K' },
      ],
      [INVOICE],
      [{ invoiceId: 'inv_1', taxRate: '0.19', netCents: 3950, taxCents: 750 }],
    );

    const { data, fileName } = await run();

    expect(fileName).toBe('RAB-2.txt');
    expect(data.toString('utf8')).toContain(
      '30.11.2026;01.12.2026;INV-202611-0001;INV-202611-0001;Ladestrom 11/2026 INV-202611-0001;K10001;',
    );
  });

  it('puts the employee number in the posting text and the billed month in the file name', async () => {
    selectResults.push(
      [
        ...SETTINGS,
        { key: 'sage.postingText', value: 'E-Laden {month}/{year} - PERSNR. {employeeNumber}' },
        { key: 'sage.fileName', value: 'Abrechnung_E-Laden_{year}-{month}.csv' },
      ],
      [INVOICE],
      [{ invoiceId: 'inv_1', taxRate: '0.19', netCents: 3950, taxCents: 750 }],
    );

    const { data, fileName } = await run();

    expect(fileName).toBe('Abrechnung_E-Laden_2026-11.csv');
    expect(data.toString('utf8')).toContain(';E-Laden 11/2026 - PERSNR. 5678;');
  });

  it('stops with the invoices without an employee number when the posting text needs it', async () => {
    selectResults.push(
      [...SETTINGS, { key: 'sage.postingText', value: 'E-Laden - PERSNR. {employeeNumber}' }],
      [INVOICE, { ...CREDIT_NOTE, employeeNumber: null }],
      [
        { invoiceId: 'inv_1', taxRate: '0.19', netCents: 3950, taxCents: 750 },
        { invoiceId: 'inv_2', taxRate: '0.19', netCents: -988, taxCents: -187 },
      ],
    );

    await expect(run(FILTERS, 'de')).rejects.toThrow(
      'Ohne Personalnummer des Fahrers (der Buchungstext verlangt sie): CN-202611-0001.',
    );
  });

  it('writes one line per tax rate of an invoice', async () => {
    selectResults.push(
      [...SETTINGS.slice(0, 2), { key: 'sage.taxCodes', value: '19=3, 7=2' }, SETTINGS[3]],
      [INVOICE],
      [
        { invoiceId: 'inv_1', taxRate: '0.19', netCents: 1000, taxCents: 190 },
        { invoiceId: 'inv_1', taxRate: '0.07', netCents: 1000, taxCents: 70 },
        { invoiceId: 'inv_1', taxRate: '0.19', netCents: 1000, taxCents: 190 },
      ],
    );

    const lines = (await run()).data.toString('utf8').trim().split('\r\n').slice(1);

    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes(';23,80;23,80;EUR;UH;3;3,80;'))).toBe(true);
    expect(lines.some((l) => l.includes(';10,70;10,70;EUR;UH;2;0,70;'))).toBe(true);
  });

  it('writes the header alone when no invoice falls in the period', async () => {
    selectResults.push(SETTINGS, []);

    const text = (await run()).data.toString('utf8');

    expect(text.slice(1).split('\r\n')).toHaveLength(2);
    expect(text).toContain('Buchungsdatum;Belegdatum');
  });

  it('stops with the list of invoices without a debtor number', async () => {
    selectResults.push(
      SETTINGS,
      [
        INVOICE,
        { ...CREDIT_NOTE, debtorNumber: null },
        { ...INVOICE, id: 'inv_3', invoiceNumber: 'INV-3', debtorNumber: ' ' },
      ],
      [
        { invoiceId: 'inv_1', taxRate: '0.19', netCents: 3950, taxCents: 750 },
        { invoiceId: 'inv_2', taxRate: '0.19', netCents: -988, taxCents: -187 },
        { invoiceId: 'inv_3', taxRate: '0.19', netCents: 100, taxCents: 19 },
      ],
    );

    await expect(run(FILTERS, 'de')).rejects.toThrow(
      'Ohne Debitorennummer des Fahrers: CN-202611-0001, INV-3. Der Sage-Export wurde nicht erzeugt',
    );
  });

  it('stops with the tax rates that have no tax code', async () => {
    selectResults.push(
      SETTINGS,
      [INVOICE],
      [{ invoiceId: 'inv_1', taxRate: '0.07', netCents: 1000, taxCents: 70 }],
    );

    await expect(run()).rejects.toThrow('tax rate 7 %');
  });

  it('stops with the invoices that have no lines', async () => {
    selectResults.push(SETTINGS, [INVOICE], []);

    await expect(run()).rejects.toThrow('Without invoice lines: INV-202611-0001.');
  });

  it('cuts a long list of invoice numbers', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...INVOICE,
      id: `inv_${String(i)}`,
      invoiceNumber: `INV-${String(i).padStart(2, '0')}`,
      debtorNumber: null,
    }));
    selectResults.push(
      SETTINGS,
      many,
      many.map((m) => ({ invoiceId: m.id, taxRate: '0.19', netCents: 100, taxCents: 19 })),
    );

    await expect(run()).rejects.toThrow('INV-14 … (+5)');
  });

  it('stops when a required setting is missing', async () => {
    selectResults.push([{ key: 'sage.mandant', value: '2' }]);

    await expect(run()).rejects.toThrow(
      'Missing settings: sage.revenueAccount, sage.taxCodes, sage.paymentTerms',
    );
  });

  it('stops in German for a German operator', async () => {
    selectResults.push([]);

    await expect(run(FILTERS, 'de')).rejects.toThrow('Der Sage-Export ist nicht eingerichtet');
  });

  it('refuses a site-restricted reader', async () => {
    await expect(run(FILTERS, 'en', ['sit_1'])).rejects.toThrow('access to all sites');
  });

  it('refuses filters without a date range', async () => {
    await expect(run({})).rejects.toThrow('needs a date range');
  });
});

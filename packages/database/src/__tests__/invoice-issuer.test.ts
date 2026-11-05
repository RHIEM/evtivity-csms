// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from 'vitest';

const timeZone = vi.hoisted(() => ({ value: 'Europe/Berlin' }));

vi.mock('../lib/system-settings.js', () => ({
  getSystemTimezone: vi.fn(() => Promise.resolve(timeZone.value)),
}));

import {
  allocateIssuerInvoiceNumber,
  invoiceSellerSnapshotFromIssuer,
  issuerNumberFormat,
  loadInvoiceIssuerForIssue,
  yearIn,
} from '../lib/invoice-issuer.js';
import type { InvoiceIssuer, InvoiceIssuerExecutor } from '../lib/invoice-issuer.js';

function issuer(overrides: Partial<InvoiceIssuer> = {}): InvoiceIssuer {
  return {
    id: 'iis_rs',
    name: 'RHIEM Services GmbH',
    street: 'Musterweg 1',
    zip: '12345',
    city: 'Musterstadt',
    state: null,
    country: 'DE',
    taxId: 'DE111111111',
    taxIdLabel: 'USt-IdNr.',
    registrationNumber: 'HRB 1',
    email: '',
    phone: null,
    invoicePrefix: '',
    invoiceWithYear: false,
    invoiceStart: 10000,
    invoiceDigits: 0,
    creditNotePrefix: 'GS-',
    creditNoteWithYear: true,
    creditNoteStart: 1,
    creditNoteDigits: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Statement text of a drizzle sql`` call (its string chunks joined). */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  return chunks
    .map((chunk) =>
      typeof chunk === 'object' && chunk != null && 'value' in chunk
        ? (chunk as { value: string[] }).value.join('')
        : '?',
    )
    .join('');
}

/** Bound values of a drizzle sql`` call, in order. */
function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  return chunks.filter(
    (chunk) => !(typeof chunk === 'object' && chunk != null && 'value' in chunk),
  );
}

describe('issuerNumberFormat', () => {
  it('reads the invoice and the credit note range of the issuer', () => {
    expect(issuerNumberFormat(issuer(), 'invoice')).toEqual({
      prefix: '',
      withYear: false,
      start: 10000,
      digits: 0,
    });
    expect(issuerNumberFormat(issuer(), 'credit_note')).toEqual({
      prefix: 'GS-',
      withYear: true,
      start: 1,
      digits: 4,
    });
  });
});

describe('invoiceSellerSnapshotFromIssuer', () => {
  it('keeps the issuer as seller, empty values as null', () => {
    expect(invoiceSellerSnapshotFromIssuer(issuer())).toEqual({
      name: 'RHIEM Services GmbH',
      street: 'Musterweg 1',
      zip: '12345',
      city: 'Musterstadt',
      state: null,
      country: 'DE',
      taxId: 'DE111111111',
      taxIdLabel: 'USt-IdNr.',
      registrationNumber: 'HRB 1',
      email: null,
      phone: null,
    });
  });
});

describe('yearIn', () => {
  it('takes the year in the system timezone', () => {
    // 31 Dec 2026 23:30 UTC is already 2027 in Berlin.
    const at = new Date('2026-12-31T23:30:00Z');
    expect(yearIn(at, 'Europe/Berlin')).toBe(2027);
    expect(yearIn(at, 'UTC')).toBe(2026);
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(yearIn(new Date('2026-12-31T23:30:00Z'), 'Mars/Olympus')).toBe(2026);
  });
});

describe('loadInvoiceIssuerForIssue', () => {
  it('reads the issuer with a share lock', async () => {
    const forLock = vi.fn(() => Promise.resolve([issuer()]));
    const where = vi.fn(() => ({ for: forLock }));
    const tx = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    } as unknown as InvoiceIssuerExecutor;

    await expect(loadInvoiceIssuerForIssue(tx, 'iis_rs')).resolves.toMatchObject({ id: 'iis_rs' });
    expect(forLock).toHaveBeenCalledWith('share');
  });

  it('is null when the issuer does not exist', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ for: vi.fn(() => Promise.resolve([])) })) })),
      })),
    } as unknown as InvoiceIssuerExecutor;
    await expect(loadInvoiceIssuerForIssue(tx, 'iis_x')).resolves.toBeNull();
  });
});

describe('allocateIssuerInvoiceNumber', () => {
  let execute: ReturnType<typeof vi.fn>;
  let tx: InvoiceIssuerExecutor;

  /** Numbers some document already has. */
  let taken: Set<string>;
  /** Values the counter statement returns, one per call. */
  let counterValues: (string | number)[];

  beforeEach(() => {
    timeZone.value = 'Europe/Berlin';
    taken = new Set();
    counterValues = ['10000'];
    execute = vi.fn((query: unknown) => {
      const text = sqlText(query);
      if (text.includes('invoice_issuer_number_counters')) {
        const value = counterValues.shift();
        return Promise.resolve(value == null ? [] : [{ value }]);
      }
      if (text.includes('FROM invoices')) {
        return Promise.resolve(taken.has(String(sqlParams(query)[0])) ? [{ '?column?': 1 }] : []);
      }
      return Promise.resolve([]);
    });
    tx = { execute } as unknown as InvoiceIssuerExecutor;
  });

  it('inserts the counter at the start value or increments it, in the transaction', async () => {
    const number = await allocateIssuerInvoiceNumber(
      tx,
      issuer(),
      'invoice',
      new Date('2026-11-30T12:00:00Z'),
    );

    expect(number).toBe('10000');
    const query = execute.mock.calls[0]?.[0];
    expect(sqlText(query)).toContain('ON CONFLICT (issuer_id, kind, year)');
    expect(sqlText(query)).toContain('value = invoice_issuer_number_counters.value + 1');
    // A range without year counts in year 0 and starts at its start value.
    expect(sqlParams(query)).toEqual(['iis_rs', 'invoice', 0, 10000]);
  });

  it('locks the number for the transaction before it checks whether a document has it', async () => {
    await allocateIssuerInvoiceNumber(tx, issuer(), 'invoice', new Date('2026-11-30T12:00:00Z'));

    const lock = execute.mock.calls[1]?.[0];
    expect(sqlText(lock)).toContain('pg_advisory_xact_lock(hashtext(');
    expect(sqlParams(lock)).toEqual(['invoice_number:10000']);
    const check = execute.mock.calls[2]?.[0];
    expect(sqlText(check)).toContain('SELECT 1 FROM invoices WHERE invoice_number = ');
    expect(sqlParams(check)).toEqual(['10000']);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('counts a range with year per year of the document date in the system timezone', async () => {
    counterValues = [3];

    const number = await allocateIssuerInvoiceNumber(
      tx,
      issuer(),
      'credit_note',
      new Date('2026-12-31T23:30:00Z'),
    );

    // No separator after the year.
    expect(number).toBe('GS-270003');
    expect(sqlParams(execute.mock.calls[0]?.[0])).toEqual(['iis_rs', 'credit_note', 2027, 1]);
  });

  it('skips numbers a document already has and takes the next free one', async () => {
    // An overlapping range of another issuer took 10000 and 10001.
    taken = new Set(['10000', '10001']);
    counterValues = ['10000', '10001', '10002'];

    const number = await allocateIssuerInvoiceNumber(
      tx,
      issuer(),
      'invoice',
      new Date('2026-11-30T12:00:00Z'),
    );

    expect(number).toBe('10002');
    const counterCalls = execute.mock.calls.filter(([query]) =>
      sqlText(query).includes('invoice_issuer_number_counters'),
    );
    expect(counterCalls).toHaveLength(3);
  });

  it('fails when the counter statement returns no row', async () => {
    counterValues = [];
    await expect(
      allocateIssuerInvoiceNumber(tx, issuer(), 'invoice', new Date('2026-11-30T12:00:00Z')),
    ).rejects.toThrow("Invoice issuer counter 'iis_rs/invoice' is missing");
  });
});

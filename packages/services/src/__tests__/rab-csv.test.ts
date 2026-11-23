// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import {
  RAB_HEADER,
  buildRabCsv,
  formatRabAmount,
  formatRabDate,
  rabField,
  type RabRow,
} from '../report-generators/rab-csv.js';

const ROW: RabRow = {
  postingDate: '2026-12-01',
  documentDate: '2026-12-01',
  documentNumber: 'INV-202611-0001',
  opNumber: '',
  postingText: 'E-Laden 11/2026',
  debitAccount: 'D10001',
  creditAccount: 'S80001',
  grossCents: 4700,
  currency: 'EUR',
  taxKind: 'UH',
  taxCode: '3',
  taxCents: 750,
  paymentTerms: 'BEZDebitor',
};

describe('formatRabAmount', () => {
  it('writes two decimals with a comma and no thousands separator', () => {
    expect(formatRabAmount(4700)).toBe('47,00');
    expect(formatRabAmount(5)).toBe('0,05');
    expect(formatRabAmount(0)).toBe('0,00');
    expect(formatRabAmount(123456789)).toBe('1234567,89');
  });

  it('keeps the sign of a credit note', () => {
    expect(formatRabAmount(-1175)).toBe('-11,75');
    expect(formatRabAmount(-5)).toBe('-0,05');
  });
});

describe('formatRabDate', () => {
  it('writes DD.MM.YYYY', () => {
    expect(formatRabDate('2026-12-01')).toBe('01.12.2026');
    expect(formatRabDate('2026-02-28T10:00:00Z')).toBe('28.02.2026');
  });

  it('refuses a value that is not an ISO date', () => {
    expect(() => formatRabDate('01.12.2026')).toThrow('Not an ISO date');
  });
});

describe('rabField', () => {
  it('quotes a field only where the syntax needs it', () => {
    expect(rabField('E-Laden 11/2026')).toBe('E-Laden 11/2026');
    expect(rabField('Text; mit Trennzeichen')).toBe('"Text; mit Trennzeichen"');
    expect(rabField('say "hi"')).toBe('"say ""hi"""');
    expect(rabField('two\nlines')).toBe('"two\nlines"');
    expect(rabField('')).toBe('');
  });
});

describe('buildRabCsv', () => {
  it('starts with the byte order mark and the header of the RAB import', () => {
    const csv = buildRabCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe(`\uFEFF${RAB_HEADER.join(';')}\r\n`);
    expect(RAB_HEADER).toHaveLength(14);
  });

  it('writes one CRLF-terminated line per row in the column order of the import', () => {
    const csv = buildRabCsv([ROW]);
    expect(csv).toBe(
      `\uFEFF${RAB_HEADER.join(';')}\r\n` +
        '01.12.2026;01.12.2026;INV-202611-0001;;E-Laden 11/2026;D10001;S80001;47,00;47,00;EUR;UH;3;7,50;BEZDebitor\r\n',
    );
  });

  it('writes a credit note with negative amounts', () => {
    const csv = buildRabCsv([{ ...ROW, grossCents: -1175, taxCents: -187 }]);
    expect(csv).toContain(';-11,75;-11,75;EUR;UH;3;-1,87;');
  });

  it('quotes a posting text that holds a semicolon', () => {
    const csv = buildRabCsv([{ ...ROW, postingText: 'a;b' }]);
    expect(csv).toContain(';"a;b";D10001;');
  });
});

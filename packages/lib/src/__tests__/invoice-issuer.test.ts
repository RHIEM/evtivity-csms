// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber, isValidInvoiceNumberPrefix } from '../invoice-issuer.js';

describe('formatInvoiceNumber', () => {
  it('prints a bare number without prefix and year', () => {
    expect(
      formatInvoiceNumber({ prefix: '', withYear: false, start: 10000, digits: 0 }, 10000, 2026),
    ).toBe('10000');
  });

  it('prints prefix, two-digit year and the padded number', () => {
    expect(
      formatInvoiceNumber({ prefix: 'RPP-', withYear: true, start: 1, digits: 4 }, 7, 2026),
    ).toBe('RPP-26-0007');
  });

  it('prints the year without a prefix and pads a year of the new century', () => {
    expect(formatInvoiceNumber({ prefix: '', withYear: true, start: 1, digits: 3 }, 12, 2105)).toBe(
      '05-012',
    );
  });

  it('never cuts a number longer than the minimum length', () => {
    expect(
      formatInvoiceNumber({ prefix: 'G', withYear: false, start: 1, digits: 2 }, 12345, 2026),
    ).toBe('G12345');
  });
});

describe('isValidInvoiceNumberPrefix', () => {
  it('accepts letters, digits and the separators - . _ and an empty prefix', () => {
    expect(isValidInvoiceNumberPrefix('')).toBe(true);
    expect(isValidInvoiceNumberPrefix('RS-')).toBe(true);
    expect(isValidInvoiceNumberPrefix('RE.2026_A-')).toBe(true);
  });

  it('refuses spaces, slashes, other characters and a prefix over 20 characters', () => {
    expect(isValidInvoiceNumberPrefix('R S')).toBe(false);
    expect(isValidInvoiceNumberPrefix('RS#')).toBe(false);
    expect(isValidInvoiceNumberPrefix('RE/26')).toBe(false);
    expect(isValidInvoiceNumberPrefix('Ä-')).toBe(false);
    expect(isValidInvoiceNumberPrefix('A'.repeat(21))).toBe(false);
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import {
  SAGE_BOOKING_DATE_KEY,
  SAGE_EXPORT_MAX_LENGTHS,
  SAGE_EXPORT_SETTING_KEYS,
  SAGE_FILE_NAME_KEY,
  SAGE_MANDANT_KEY,
  SAGE_OP_NUMBER_KEY,
  SAGE_PAYMENT_TERMS_KEY,
  SAGE_POSTING_TEXT_KEY,
  SAGE_REVENUE_ACCOUNT_KEY,
  SAGE_TAX_CODES_KEY,
  isSageExportSettingKey,
  normalizeSageExportSetting,
  parseSageTaxCodes,
  sageExportConfig,
} from '../sage-export.js';

describe('isSageExportSettingKey', () => {
  it('knows exactly the sage keys', () => {
    expect(SAGE_EXPORT_SETTING_KEYS).toHaveLength(11);
    for (const key of SAGE_EXPORT_SETTING_KEYS) expect(isSageExportSettingKey(key)).toBe(true);
    expect(isSageExportSettingKey('sage.other')).toBe(false);
    expect(isSageExportSettingKey('company.name')).toBe(false);
  });
});

describe('parseSageTaxCodes', () => {
  it('reads rate=code pairs separated by comma, semicolon or line break', () => {
    const codes = parseSageTaxCodes('19=3, 7=2;0=1\n9.5=4');
    expect(codes).toEqual(
      new Map([
        [19, '3'],
        [7, '2'],
        [0, '1'],
        [9.5, '4'],
      ]),
    );
  });

  it('treats an empty string as an empty map', () => {
    expect(parseSageTaxCodes('')).toEqual(new Map());
    expect(parseSageTaxCodes(' , ')).toEqual(new Map());
  });

  it('refuses a malformed entry, a rate out of range and a repeated rate', () => {
    expect(parseSageTaxCodes('19')).toBeNull();
    expect(parseSageTaxCodes('19=')).toBeNull();
    expect(parseSageTaxCodes('abc=3')).toBeNull();
    expect(parseSageTaxCodes('101=3')).toBeNull();
    expect(parseSageTaxCodes('19=3,19=4')).toBeNull();
    expect(parseSageTaxCodes('19=3=4')).toBeNull();
  });
});

describe('normalizeSageExportSetting', () => {
  it('trims a value and keeps an empty one', () => {
    expect(normalizeSageExportSetting(SAGE_MANDANT_KEY, ' 2 ')).toBe('2');
    expect(normalizeSageExportSetting(SAGE_MANDANT_KEY, '  ')).toBe('');
  });

  it('refuses a value that is not a string, holds a control character or is too long', () => {
    expect(normalizeSageExportSetting(SAGE_MANDANT_KEY, 2)).toBeNull();
    expect(normalizeSageExportSetting(SAGE_MANDANT_KEY, 'a\nb')).toBeNull();
    expect(
      normalizeSageExportSetting(
        SAGE_MANDANT_KEY,
        'x'.repeat(SAGE_EXPORT_MAX_LENGTHS[SAGE_MANDANT_KEY] + 1),
      ),
    ).toBeNull();
  });

  it('refuses a semicolon in a plain field, the separator of the file', () => {
    expect(normalizeSageExportSetting(SAGE_REVENUE_ACCOUNT_KEY, '84;00')).toBeNull();
    expect(normalizeSageExportSetting(SAGE_PAYMENT_TERMS_KEY, 'BEZDebitor')).toBe('BEZDebitor');
  });

  it('accepts only the placeholders a template knows', () => {
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, 'RAB-{mandant}-{timestamp}.txt')).toBe(
      'RAB-{mandant}-{timestamp}.txt',
    );
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, 'RAB-{year}-{month}.txt')).toBe(
      'RAB-{year}-{month}.txt',
    );
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, 'RAB-{name}.txt')).toBeNull();
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, 'RAB-{mandant.txt')).toBeNull();
    expect(
      normalizeSageExportSetting(SAGE_POSTING_TEXT_KEY, 'E-Laden {month}/{year} {invoiceNumber}'),
    ).toBe('E-Laden {month}/{year} {invoiceNumber}');
    expect(
      normalizeSageExportSetting(
        SAGE_POSTING_TEXT_KEY,
        'E-Laden {month}/{year} - PERSNR. {employeeNumber}',
      ),
    ).toBe('E-Laden {month}/{year} - PERSNR. {employeeNumber}');
    expect(normalizeSageExportSetting(SAGE_POSTING_TEXT_KEY, 'E-Laden {name}')).toBeNull();
  });

  it('refuses a file name a path could use', () => {
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, '../RAB.txt')).toBeNull();
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, 'a/b.txt')).toBeNull();
    expect(normalizeSageExportSetting(SAGE_FILE_NAME_KEY, 'RAB 1.txt')).toBeNull();
  });

  it('accepts only the modes that exist', () => {
    expect(normalizeSageExportSetting(SAGE_BOOKING_DATE_KEY, 'periodEnd')).toBe('periodEnd');
    expect(normalizeSageExportSetting(SAGE_BOOKING_DATE_KEY, 'today')).toBeNull();
    expect(normalizeSageExportSetting(SAGE_OP_NUMBER_KEY, 'invoiceNumber')).toBe('invoiceNumber');
    expect(normalizeSageExportSetting(SAGE_OP_NUMBER_KEY, 'both')).toBeNull();
  });

  it('checks the tax codes', () => {
    expect(normalizeSageExportSetting(SAGE_TAX_CODES_KEY, '19=3')).toBe('19=3');
    expect(normalizeSageExportSetting(SAGE_TAX_CODES_KEY, '19')).toBeNull();
  });
});

describe('sageExportConfig', () => {
  const stored = {
    [SAGE_MANDANT_KEY]: '2',
    [SAGE_REVENUE_ACCOUNT_KEY]: '8400',
    [SAGE_TAX_CODES_KEY]: '19=3',
    [SAGE_PAYMENT_TERMS_KEY]: 'BEZDebitor',
  };

  it('takes the defaults for what is unset', () => {
    const { config, missing } = sageExportConfig(stored);
    expect(missing).toEqual([]);
    expect(config).toEqual({
      mandant: '2',
      fileName: 'RAB-{mandant}-{timestamp}.txt',
      debtorPrefix: 'D',
      revenueAccountPrefix: 'S',
      revenueAccount: '8400',
      taxKind: 'UH',
      taxCodes: new Map([[19, '3']]),
      paymentTerms: 'BEZDebitor',
      postingText: 'E-Laden {month}/{year}',
      bookingDate: 'invoiceDate',
      opNumber: 'empty',
    });
  });

  // The settings table returns a text such as "1" or "84030" as a number.
  it('takes the Mandant and the account that came back as numbers', () => {
    const { config, missing } = sageExportConfig({
      ...stored,
      [SAGE_MANDANT_KEY]: 1,
      [SAGE_REVENUE_ACCOUNT_KEY]: 84030,
    });
    expect(missing).toEqual([]);
    expect(config.mandant).toBe('1');
    expect(config.revenueAccount).toBe('84030');
  });

  it('lists the required settings that are empty, invalid or unset', () => {
    expect(sageExportConfig({}).missing).toEqual([
      SAGE_MANDANT_KEY,
      SAGE_REVENUE_ACCOUNT_KEY,
      SAGE_TAX_CODES_KEY,
      SAGE_PAYMENT_TERMS_KEY,
    ]);
    expect(sageExportConfig({ ...stored, [SAGE_PAYMENT_TERMS_KEY]: '  ' }).missing).toEqual([
      SAGE_PAYMENT_TERMS_KEY,
    ]);
    expect(sageExportConfig({ ...stored, [SAGE_TAX_CODES_KEY]: '19' }).missing).toEqual([
      SAGE_TAX_CODES_KEY,
    ]);
  });

  it('takes the chosen modes and overrides the defaults', () => {
    const { config } = sageExportConfig({
      ...stored,
      [SAGE_BOOKING_DATE_KEY]: 'periodEnd',
      [SAGE_OP_NUMBER_KEY]: 'invoiceNumber',
      [SAGE_POSTING_TEXT_KEY]: 'Ladestrom {month}/{year}',
    });
    expect(config.bookingDate).toBe('periodEnd');
    expect(config.opNumber).toBe('invoiceNumber');
    expect(config.postingText).toBe('Ladestrom {month}/{year}');
  });
});

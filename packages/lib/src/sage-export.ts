// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * RHIEM: settings of the Sage export (report type `sageInvoices`), the file in
 * the layout of the RAB (Rechnungsausgangsbuch) import of Sage/OfficeLine: the
 * accounts, the tax codes, the payment terms and the texts the file carries.
 * Everything the finance department decides is a setting, not code. Browser-safe,
 * so the CSMS imports it via `@evtivity/lib/sage-export`.
 */

export const SAGE_MANDANT_KEY = 'sage.mandant';
export const SAGE_FILE_NAME_KEY = 'sage.fileName';
export const SAGE_DEBTOR_PREFIX_KEY = 'sage.debtorPrefix';
export const SAGE_REVENUE_ACCOUNT_PREFIX_KEY = 'sage.revenueAccountPrefix';
export const SAGE_REVENUE_ACCOUNT_KEY = 'sage.revenueAccount';
export const SAGE_TAX_KIND_KEY = 'sage.taxKind';
export const SAGE_TAX_CODES_KEY = 'sage.taxCodes';
export const SAGE_PAYMENT_TERMS_KEY = 'sage.paymentTerms';
export const SAGE_POSTING_TEXT_KEY = 'sage.postingText';
export const SAGE_BOOKING_DATE_KEY = 'sage.bookingDate';
export const SAGE_OP_NUMBER_KEY = 'sage.opNumber';

/** Longest value accepted for each Sage export setting, in characters. */
export const SAGE_EXPORT_MAX_LENGTHS = {
  [SAGE_MANDANT_KEY]: 10,
  [SAGE_FILE_NAME_KEY]: 100,
  [SAGE_DEBTOR_PREFIX_KEY]: 5,
  [SAGE_REVENUE_ACCOUNT_PREFIX_KEY]: 5,
  [SAGE_REVENUE_ACCOUNT_KEY]: 20,
  [SAGE_TAX_KIND_KEY]: 10,
  [SAGE_TAX_CODES_KEY]: 100,
  [SAGE_PAYMENT_TERMS_KEY]: 30,
  [SAGE_POSTING_TEXT_KEY]: 100,
  [SAGE_BOOKING_DATE_KEY]: 20,
  [SAGE_OP_NUMBER_KEY]: 20,
} as const;

export type SageExportSettingKey = keyof typeof SAGE_EXPORT_MAX_LENGTHS;

export const SAGE_EXPORT_SETTING_KEYS = Object.keys(
  SAGE_EXPORT_MAX_LENGTHS,
) as SageExportSettingKey[];

export function isSageExportSettingKey(key: string): key is SageExportSettingKey {
  return Object.hasOwn(SAGE_EXPORT_MAX_LENGTHS, key);
}

/** Booking date of a line: the invoice date, or the last day of the billed month. */
export const SAGE_BOOKING_DATE_MODES = ['invoiceDate', 'periodEnd'] as const;
export type SageBookingDateMode = (typeof SAGE_BOOKING_DATE_MODES)[number];

/** OP number (open item) of a line: left empty, or the invoice number. */
export const SAGE_OP_NUMBER_MODES = ['empty', 'invoiceNumber'] as const;
export type SageOpNumberMode = (typeof SAGE_OP_NUMBER_MODES)[number];

/** What an unset setting takes. The settings without an entry are required. */
export const SAGE_EXPORT_DEFAULTS: Partial<Record<SageExportSettingKey, string>> = {
  [SAGE_FILE_NAME_KEY]: 'RAB-{mandant}-{timestamp}.txt',
  [SAGE_DEBTOR_PREFIX_KEY]: 'D',
  [SAGE_REVENUE_ACCOUNT_PREFIX_KEY]: 'S',
  [SAGE_TAX_KIND_KEY]: 'UH',
  [SAGE_POSTING_TEXT_KEY]: 'E-Laden {month}/{year}',
  [SAGE_BOOKING_DATE_KEY]: 'invoiceDate',
  [SAGE_OP_NUMBER_KEY]: 'empty',
};

/** Settings without a default: the export refuses to run while one is empty. */
export const SAGE_EXPORT_REQUIRED_KEYS: readonly SageExportSettingKey[] = [
  SAGE_MANDANT_KEY,
  SAGE_REVENUE_ACCOUNT_KEY,
  SAGE_TAX_CODES_KEY,
  SAGE_PAYMENT_TERMS_KEY,
];

const FILE_NAME_PLACEHOLDERS = ['mandant', 'timestamp'];
const POSTING_TEXT_PLACEHOLDERS = ['month', 'year', 'invoiceNumber'];
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const FILE_NAME_CHARACTERS = /^[A-Za-z0-9._{}-]+$/;

function placeholdersAllowed(value: string, allowed: readonly string[]): boolean {
  const names = [...value.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? '');
  if (names.some((name) => !allowed.includes(name))) return false;
  // Braces that are not part of a placeholder.
  return !/[{}]/.test(value.replace(/\{[^{}]*\}/g, ''));
}

/**
 * The tax codes as a map from the tax rate in percent to the Sage tax code:
 * `19=3, 7=2` (separated by comma, semicolon or line break; a decimal point in
 * the rate, as in `9.5=4`). Null when an entry
 * is not `rate=code`, a rate is not a number from 0 to 100, a code is empty or a
 * rate repeats. An empty string is an empty map.
 */
export function parseSageTaxCodes(value: string): Map<number, string> | null {
  const codes = new Map<number, string>();
  for (const entry of value.split(/[,;\n]/)) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const [rateText, code, ...rest] = trimmed.split('=').map((part) => part.trim());
    if (rest.length > 0 || rateText == null || code == null || code === '') return null;
    if (!/^\d+(\.\d+)?$/.test(rateText)) return null;
    const rate = Number(rateText);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100 || codes.has(rate)) return null;
    codes.set(rate, code);
  }
  return codes;
}

/**
 * The value as stored: trimmed, one line. Returns null when it is not a string,
 * holds a control character, is longer than the key's limit, or breaks the
 * rule of its key (a mode that does not exist, a placeholder that does not
 * exist, a file name with characters a path could use, malformed tax codes).
 */
export function normalizeSageExportSetting(
  key: SageExportSettingKey,
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (CONTROL_CHARACTERS.test(trimmed)) return null;
  if (trimmed.length > SAGE_EXPORT_MAX_LENGTHS[key]) return null;
  if (trimmed === '') return trimmed;
  switch (key) {
    case SAGE_FILE_NAME_KEY:
      if (!FILE_NAME_CHARACTERS.test(trimmed)) return null;
      return placeholdersAllowed(trimmed, FILE_NAME_PLACEHOLDERS) ? trimmed : null;
    case SAGE_POSTING_TEXT_KEY:
      return placeholdersAllowed(trimmed, POSTING_TEXT_PLACEHOLDERS) ? trimmed : null;
    case SAGE_TAX_CODES_KEY:
      return parseSageTaxCodes(trimmed) != null ? trimmed : null;
    case SAGE_BOOKING_DATE_KEY:
      return (SAGE_BOOKING_DATE_MODES as readonly string[]).includes(trimmed) ? trimmed : null;
    case SAGE_OP_NUMBER_KEY:
      return (SAGE_OP_NUMBER_MODES as readonly string[]).includes(trimmed) ? trimmed : null;
    default:
      // The fields of a RAB line are separated by semicolons.
      return trimmed.includes(';') ? null : trimmed;
  }
}

export interface SageExportConfig {
  mandant: string;
  fileName: string;
  debtorPrefix: string;
  revenueAccountPrefix: string;
  revenueAccount: string;
  taxKind: string;
  taxCodes: Map<number, string>;
  paymentTerms: string;
  postingText: string;
  bookingDate: SageBookingDateMode;
  opNumber: SageOpNumberMode;
}

/**
 * The export configuration from the stored settings: an unset value takes its
 * default. `missing` lists the required settings that are still empty or
 * invalid; the config is only usable when it is empty.
 */
export function sageExportConfig(stored: Record<string, unknown>): {
  config: SageExportConfig;
  missing: SageExportSettingKey[];
} {
  const value = (key: SageExportSettingKey): string => {
    const normalized = normalizeSageExportSetting(key, stored[key]);
    if (normalized != null && normalized !== '') return normalized;
    return SAGE_EXPORT_DEFAULTS[key] ?? '';
  };
  const missing = SAGE_EXPORT_REQUIRED_KEYS.filter((key) => value(key) === '');
  const taxCodes = parseSageTaxCodes(value(SAGE_TAX_CODES_KEY)) ?? new Map<number, string>();
  if (taxCodes.size === 0 && !missing.includes(SAGE_TAX_CODES_KEY)) {
    missing.push(SAGE_TAX_CODES_KEY);
  }
  const bookingDate = value(SAGE_BOOKING_DATE_KEY);
  const opNumber = value(SAGE_OP_NUMBER_KEY);
  return {
    config: {
      mandant: value(SAGE_MANDANT_KEY),
      fileName: value(SAGE_FILE_NAME_KEY),
      debtorPrefix: value(SAGE_DEBTOR_PREFIX_KEY),
      revenueAccountPrefix: value(SAGE_REVENUE_ACCOUNT_PREFIX_KEY),
      revenueAccount: value(SAGE_REVENUE_ACCOUNT_KEY),
      taxKind: value(SAGE_TAX_KIND_KEY),
      taxCodes,
      paymentTerms: value(SAGE_PAYMENT_TERMS_KEY),
      postingText: value(SAGE_POSTING_TEXT_KEY),
      bookingDate: bookingDate === 'periodEnd' ? 'periodEnd' : 'invoiceDate',
      opNumber: opNumber === 'invoiceNumber' ? 'invoiceNumber' : 'empty',
    },
    missing,
  };
}

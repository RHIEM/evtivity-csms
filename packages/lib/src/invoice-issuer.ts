// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Invoice issuers: a seller other than the company that a fleet's invoices
 * (fleet and member invoices and their credit notes) are issued under, with
 * its own number range per document kind. Browser-safe, so the CSMS imports
 * it via `@evtivity/lib/invoice-issuer` for the number preview.
 */

/** The number format of one document kind (invoice or credit note) of an issuer. */
export interface InvoiceNumberFormat {
  /** Printed first, as entered (it carries its own separator, e.g. "RS-"); may be empty. */
  prefix: string;
  /** The two-digit year of the document date follows the prefix, then "-"; the counter restarts each year. */
  withYear: boolean;
  /** The first number of the range (of each year when withYear). */
  start: number;
  /** Minimum length of the number, padded with leading zeros; 0 pads nothing. */
  digits: number;
}

/** Longest prefix accepted, in characters. */
export const MAX_INVOICE_NUMBER_PREFIX_LENGTH = 20;
/** Largest start value accepted. */
export const MAX_INVOICE_NUMBER_START = 999_999_999;
/** Largest minimum length accepted. */
export const MAX_INVOICE_NUMBER_DIGITS = 10;

/** Letters, digits and the separators - . _ only: the number names the PDF file. */
export const INVOICE_NUMBER_PREFIX_PATTERN = /^[A-Za-z0-9\-._]*$/;

/** True when the prefix holds only letters, digits and - . _ and is not too long. */
export function isValidInvoiceNumberPrefix(prefix: string): boolean {
  return (
    prefix.length <= MAX_INVOICE_NUMBER_PREFIX_LENGTH && INVOICE_NUMBER_PREFIX_PATTERN.test(prefix)
  );
}

/**
 * The number of a document: prefix, the two-digit year and "-" (withYear),
 * then the counter value padded to the minimum length. Examples: prefix "",
 * no year, start 10000 gives "10000"; prefix "RPP-", year, 4 digits gives
 * "RPP-26-0001".
 */
export function formatInvoiceNumber(
  format: InvoiceNumberFormat,
  value: number,
  year: number,
): string {
  const yearPart = format.withYear ? `${String(year % 100).padStart(2, '0')}-` : '';
  return `${format.prefix}${yearPart}${String(value).padStart(format.digits, '0')}`;
}

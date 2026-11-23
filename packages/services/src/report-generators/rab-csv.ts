// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * RHIEM: writer of the RAB (Rechnungsausgangsbuch) file the Sage/OfficeLine
 * import reads, in the layout the ERPHelper writes (erp-helper
 * `internal/entity/rab.go`): semicolons, a header row, UTF-8 with a byte order
 * mark, CRLF after every line, dates as DD.MM.YYYY, a comma as the decimal
 * separator. The shared `buildCsv` writes commas and decimal points, so this is
 * a writer of its own.
 */

/** The header row, in the column order of the import. */
export const RAB_HEADER = [
  'Buchungsdatum',
  'Belegdatum',
  'Belegnummer',
  'OPNr',
  'Buchungstext',
  'Konto_Soll',
  'Konto_Haben',
  'Umsatz',
  'Umsatz_Eigenwaehrung',
  'Waehrung',
  'Steuerart',
  'Steuercode',
  'Steuerbetrag',
  'Zahlungskondition',
] as const;

export interface RabRow {
  /** ISO date (YYYY-MM-DD). */
  postingDate: string;
  /** ISO date (YYYY-MM-DD). */
  documentDate: string;
  documentNumber: string;
  opNumber: string;
  postingText: string;
  debitAccount: string;
  creditAccount: string;
  /** Gross amount in cents, negative for a credit note. */
  grossCents: number;
  currency: string;
  taxKind: string;
  taxCode: string;
  /** Tax amount in cents, negative for a credit note. */
  taxCents: number;
  paymentTerms: string;
}

const UTF8_BOM = '﻿';

/** An amount in cents as `-11,75`: always two decimals, a comma as separator. */
export function formatRabAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${String(whole)},${fraction}`;
}

/** An ISO date (YYYY-MM-DD) as DD.MM.YYYY. */
export function formatRabDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match == null) throw new Error(`Not an ISO date: ${isoDate}`);
  return `${match[3] ?? ''}.${match[2] ?? ''}.${match[1] ?? ''}`;
}

/** A field in quotes only where the syntax needs it: a semicolon, a quote or a line break. */
export function rabField(value: string): string {
  if (!/[;"\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function rabLine(fields: readonly string[]): string {
  return `${fields.map(rabField).join(';')}\r\n`;
}

function rabFields(row: RabRow): string[] {
  return [
    formatRabDate(row.postingDate),
    formatRabDate(row.documentDate),
    row.documentNumber,
    row.opNumber,
    row.postingText,
    row.debitAccount,
    row.creditAccount,
    formatRabAmount(row.grossCents),
    formatRabAmount(row.grossCents),
    row.currency,
    row.taxKind,
    row.taxCode,
    formatRabAmount(row.taxCents),
    row.paymentTerms,
  ];
}

/** The whole file: the byte order mark, the header and one line per row. */
export function buildRabCsv(rows: readonly RabRow[]): string {
  return UTF8_BOM + rabLine(RAB_HEADER) + rows.map((row) => rabLine(rabFields(row))).join('');
}

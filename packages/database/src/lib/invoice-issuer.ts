// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { eq, sql } from 'drizzle-orm';
import { createLogger, formatInvoiceNumber, isValidTimezone } from '@evtivity/lib';
import type { InvoiceNumberFormat } from '@evtivity/lib';
import type { db } from '../config.js';
import { invoiceIssuers } from '../schema/invoice-issuers.js';
import type { InvoiceKind } from '../schema/invoices.js';
import type { InvoiceSellerSnapshot } from './invoice-seller-snapshot.js';
import { currentPdfLetterheadId } from './pdf-letterhead.js';
import { getSystemTimezone } from './system-settings.js';

const logger = createLogger('invoice-issuer');

export type InvoiceIssuer = typeof invoiceIssuers.$inferSelect;

/** What reads an issuer and allocates its numbers: the invoice transaction. */
export type InvoiceIssuerExecutor = Pick<typeof db, 'select' | 'execute'>;

/** The number format of one document kind of an issuer. */
export function issuerNumberFormat(issuer: InvoiceIssuer, kind: InvoiceKind): InvoiceNumberFormat {
  return kind === 'invoice'
    ? {
        prefix: issuer.invoicePrefix,
        withYear: issuer.invoiceWithYear,
        start: issuer.invoiceStart,
        digits: issuer.invoiceDigits,
      }
    : {
        prefix: issuer.creditNotePrefix,
        withYear: issuer.creditNoteWithYear,
        start: issuer.creditNoteStart,
        digits: issuer.creditNoteDigits,
      };
}

/** The seller an issuer's documents keep at issue (invoices.seller). */
export function invoiceSellerSnapshotFromIssuer(issuer: InvoiceIssuer): InvoiceSellerSnapshot {
  const text = (value: string | null): string | null =>
    value != null && value.trim() !== '' ? value.trim() : null;
  return {
    name: text(issuer.name),
    street: text(issuer.street),
    zip: text(issuer.zip),
    city: text(issuer.city),
    state: text(issuer.state),
    country: text(issuer.country),
    taxId: text(issuer.taxId),
    taxIdLabel: text(issuer.taxIdLabel),
    registrationNumber: text(issuer.registrationNumber),
    email: text(issuer.email),
    phone: text(issuer.phone),
  };
}

/**
 * The issuer, read with a share lock inside the invoice transaction: an
 * update of its number format waits for the invoice to commit, so a number
 * is never formatted with a format the issuer no longer has. Null when it
 * does not exist.
 */
export async function loadInvoiceIssuerForIssue(
  tx: InvoiceIssuerExecutor,
  issuerId: string,
): Promise<InvoiceIssuer | null> {
  const [issuer] = await tx
    .select()
    .from(invoiceIssuers)
    .where(eq(invoiceIssuers.id, issuerId))
    .for('share');
  return issuer ?? null;
}

/**
 * The letterhead version a new invoice or credit note keeps
 * (invoices.letterhead_id): the issuer's own current version, else the
 * company's (pdf.letterhead); null for none. Read inside the invoice
 * transaction, like the issuer.
 */
export async function letterheadIdForIssue(
  tx: InvoiceIssuerExecutor,
  issuer: Pick<InvoiceIssuer, 'letterheadId'> | null,
): Promise<string | null> {
  return issuer?.letterheadId ?? currentPdfLetterheadId(tx);
}

/** The calendar year of `at` in the time zone; an invalid zone falls back to UTC. */
export function yearIn(at: Date, timeZone: string): number {
  let zone = timeZone;
  if (!isValidTimezone(zone)) {
    logger.warn({ timeZone }, 'Invalid system timezone, numbering the invoice in UTC');
    zone = 'UTC';
  }
  const year = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' })
    .formatToParts(at)
    .find((part) => part.type === 'year')?.value;
  return year != null ? Number(year) : at.getUTCFullYear();
}

/**
 * Allocates the next number of an issuer's document kind inside the caller's
 * transaction (allocateInvoiceNumber for issuers). The counter row of the
 * issuer, kind and year (year 0 when the format has none) is inserted with
 * the start value or incremented; it stays locked until the commit, so
 * concurrent documents are numbered one after the other and a rollback gives
 * the number back. The year is that of issuedAt in the system timezone.
 *
 * The ranges of two issuers should not overlap. When they do, they share
 * their numbers: a number some document already has (of another issuer, or
 * entered by any other means) is skipped and the counter moves on to the next
 * free one. The transaction lock on the number makes a concurrent document of
 * another issuer that drew the same number wait for this commit, so it sees
 * the number taken and moves on too.
 */
export async function allocateIssuerInvoiceNumber(
  tx: InvoiceIssuerExecutor,
  issuer: InvoiceIssuer,
  kind: InvoiceKind,
  issuedAt: Date,
): Promise<string> {
  const format = issuerNumberFormat(issuer, kind);
  const year = yearIn(issuedAt, await getSystemTimezone());
  const counterYear = format.withYear ? year : 0;
  for (;;) {
    const [row] = await tx.execute(
      sql`INSERT INTO invoice_issuer_number_counters (issuer_id, kind, year, value)
          VALUES (${issuer.id}, ${kind}, ${counterYear}, ${format.start})
          ON CONFLICT (issuer_id, kind, year)
          DO UPDATE SET value = invoice_issuer_number_counters.value + 1
          RETURNING value`,
    );
    if (row == null) throw new Error(`Invoice issuer counter '${issuer.id}/${kind}' is missing`);
    const value = Number((row as { value: string | number }).value);
    const number = formatInvoiceNumber(format, value, year);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice_number:${number}`}))`);
    const taken = await tx.execute(
      sql`SELECT 1 FROM invoices WHERE invoice_number = ${number} LIMIT 1`,
    );
    if (taken.length === 0) return number;
    logger.warn(
      { issuerId: issuer.id, kind, invoiceNumber: number },
      'Invoice number already taken, the issuer ranges overlap; skipping it',
    );
  }
}

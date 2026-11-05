// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createId } from '../lib/id.js';

/**
 * An invoice issuer: a seller other than the company (`company.*` settings)
 * that a fleet's invoices are issued under (fleets.invoice_issuer_id). Its
 * fleet and member invoices and their credit notes print its name, address
 * and seller details and take their numbers from its own ranges, one per
 * document kind (InvoiceNumberFormat in @evtivity/lib/invoice-issuer). A
 * fleet without an issuer bills as the company with INV-YYYYMM-NNNN numbers.
 */
export const invoiceIssuers = pgTable(
  'invoice_issuers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId('invoiceIssuer')),
    // Printed as the seller name; also the name the CSMS lists it under.
    name: varchar('name', { length: 255 }).notNull(),
    street: varchar('street', { length: 255 }),
    zip: varchar('zip', { length: 20 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    taxId: varchar('tax_id', { length: 64 }),
    taxIdLabel: varchar('tax_id_label', { length: 40 }),
    registrationNumber: varchar('registration_number', { length: 100 }),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 40 }),
    // Number range of invoices.
    invoicePrefix: varchar('invoice_prefix', { length: 20 }).notNull().default(''),
    invoiceWithYear: boolean('invoice_with_year').notNull().default(false),
    invoiceStart: integer('invoice_start').notNull().default(1),
    invoiceDigits: smallint('invoice_digits').notNull().default(0),
    // Number range of credit notes.
    creditNotePrefix: varchar('credit_note_prefix', { length: 20 }).notNull().default(''),
    creditNoteWithYear: boolean('credit_note_with_year').notNull().default(false),
    creditNoteStart: integer('credit_note_start').notNull().default(1),
    creditNoteDigits: smallint('credit_note_digits').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'invoice_issuers_number_check',
      sql`${table.invoiceStart} BETWEEN 0 AND 999999999 AND ${table.creditNoteStart} BETWEEN 0 AND 999999999 AND ${table.invoiceDigits} BETWEEN 0 AND 10 AND ${table.creditNoteDigits} BETWEEN 0 AND 10`,
    ),
  ],
);

/**
 * The last number issued per issuer, document kind ('invoice',
 * 'credit_note') and year (0 for a range without year). The invoice
 * transaction inserts or increments its row (allocateIssuerInvoiceNumber),
 * so the row stays locked until the commit and a rollback gives the number
 * back: the numbers have no gaps (GoBD), like invoice_number_counters. When
 * the ranges of two issuers overlap, a number already taken is skipped.
 */
export const invoiceIssuerNumberCounters = pgTable(
  'invoice_issuer_number_counters',
  {
    issuerId: text('issuer_id')
      .notNull()
      .references(() => invoiceIssuers.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    year: smallint('year').notNull(),
    value: bigint('value', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.issuerId, table.kind, table.year] })],
);

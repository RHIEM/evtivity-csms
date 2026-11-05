// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { char, check, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createId } from '../lib/id.js';
import { users } from './identity.js';

/**
 * A version of the PDF letterhead (stationery): an A4 image drawn as the
 * background of the first page of an invoice or credit note, and the free
 * areas the text goes into, in millimetres from the top left corner. A row
 * never changes after it is created: a new image or layout is a new version,
 * and the `pdf.letterhead` setting names the current one. An invoice keeps
 * the version it was issued under (invoices.letterhead_id), so a re-rendered
 * PDF shows the letterhead it was issued with. See @evtivity/lib/pdf-letterhead.
 */
export const pdfLetterheads = pgTable(
  'pdf_letterheads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId('pdfLetterhead')),
    // The name the CSMS lists the version under, e.g. "Letterhead 2026".
    name: varchar('name', { length: 100 }).notNull(),
    // A PNG or (sanitized) SVG data URI of the whole A4 page.
    image: text('image').notNull(),
    // SHA-256 (hex) of the image bytes: the render cache key.
    imageSha256: char('image_sha256', { length: 64 }).notNull(),
    // Where the recipient address starts (the envelope window).
    addressLeftMm: numeric('address_left_mm', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(25),
    addressTopMm: numeric('address_top_mm', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(62.7),
    // Where the text of the first page starts, and the text of every page ends.
    contentTopMm: numeric('content_top_mm', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(105),
    contentBottomMm: numeric('content_bottom_mm', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(250),
    // Side margins of the text.
    marginLeftMm: numeric('margin_left_mm', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(25),
    marginRightMm: numeric('margin_right_mm', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(20),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'pdf_letterheads_layout_check',
      sql`${table.contentTopMm} < ${table.contentBottomMm} AND ${table.contentBottomMm} <= 297 AND ${table.addressLeftMm} >= 0 AND ${table.addressTopMm} >= 0 AND ${table.marginLeftMm} >= 0 AND ${table.marginRightMm} >= 0`,
    ),
  ],
);

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { sql } from 'drizzle-orm';
import { PDF_LETTERHEAD_KEY } from '@evtivity/lib';
import type { db } from '../config.js';

export type PdfLetterheadExecutor = Pick<typeof db, 'execute'>;

/**
 * The id of the current PDF letterhead version (the pdf.letterhead setting),
 * or null when none is set or the setting names no version. The invoice and
 * credit note transactions read it at issue and keep it on the document
 * (invoices.letterhead_id).
 */
export async function currentPdfLetterheadId(
  executor: PdfLetterheadExecutor,
): Promise<string | null> {
  const [row] = await executor.execute(
    sql`SELECT l.id FROM settings s
        JOIN pdf_letterheads l ON l.id = s.value #>> '{}'
        WHERE s.key = ${PDF_LETTERHEAD_KEY} AND jsonb_typeof(s.value) = 'string'
          AND l.issuer_id IS NULL`,
  );
  const id = (row as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' ? id : null;
}

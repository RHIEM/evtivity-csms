// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { currentPdfLetterheadId } from '../lib/pdf-letterhead.js';

const dialect = new PgDialect();

function executor(rows: unknown[]): {
  tx: { execute: (q: SQL) => Promise<unknown[]> };
  statements: string[];
  params: unknown[][];
} {
  const statements: string[] = [];
  const params: unknown[][] = [];
  return {
    statements,
    params,
    tx: {
      execute: (q: SQL) => {
        const query = dialect.sqlToQuery(q);
        statements.push(query.sql.replace(/\s+/g, ' '));
        params.push(query.params);
        return Promise.resolve(rows);
      },
    },
  };
}

describe('currentPdfLetterheadId', () => {
  it('returns the version the pdf.letterhead setting names, if it exists', async () => {
    const { tx, statements, params } = executor([{ id: 'lhd_ri' }]);
    await expect(currentPdfLetterheadId(tx as never)).resolves.toBe('lhd_ri');
    expect(statements[0]).toContain('JOIN pdf_letterheads l ON l.id = s.value #>>');
    expect(params[0]).toEqual(['pdf.letterhead']);
  });

  it('returns null without a setting or for an unknown version', async () => {
    await expect(currentPdfLetterheadId(executor([]).tx as never)).resolves.toBeNull();
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from '../api';
import {
  attachmentFileName,
  downloadFleetSessionReportCsv,
  downloadSessionReportPdf,
} from '../session-report';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubDownload(response: Response): {
  click: ReturnType<typeof vi.fn>;
  link: HTMLAnchorElement;
} {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
  const link = document.createElement('a');
  const click = vi.fn();
  link.click = click;
  vi.spyOn(document, 'createElement').mockReturnValue(link);
  return { click, link };
}

describe('attachmentFileName', () => {
  it('reads the file name of an attachment header, else the fallback', () => {
    expect(attachmentFileName('attachment; filename="a-2026-11.pdf"', 'x.pdf')).toBe(
      'a-2026-11.pdf',
    );
    expect(attachmentFileName(null, 'x.pdf')).toBe('x.pdf');
    expect(attachmentFileName('inline', 'x.pdf')).toBe('x.pdf');
  });
});

describe('session report downloads', () => {
  it('downloads the CSV of a period under the name the API sends', async () => {
    const { click, link } = stubDownload(
      new Response('period;driver_id', {
        headers: {
          'Content-Disposition': 'attachment; filename="session-report-flt_1-2026-10.csv"',
        },
      }),
    );
    await downloadFleetSessionReportCsv('flt_1', '2026-10');
    expect(fetch).toHaveBeenCalledWith('/v1/fleets/flt_1/session-report.csv?period=2026-10', {
      credentials: 'include',
    });
    expect(link.download).toBe('session-report-flt_1-2026-10.csv');
    expect(click).toHaveBeenCalled();
  });

  it('throws an ApiError when the report cannot be downloaded', async () => {
    stubDownload(new Response(JSON.stringify({ code: 'INVOICE_IS_CREDIT_NOTE' }), { status: 409 }));
    await expect(downloadSessionReportPdf('inv_1')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledWith('/v1/invoices/inv_1/session-report', {
      credentials: 'include',
    });
  });
});

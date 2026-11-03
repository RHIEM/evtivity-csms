// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { API_BASE_URL } from '@/lib/config';
import { ApiError } from '@/lib/api';

/** The file name of a Content-Disposition attachment header, else the fallback. */
export function attachmentFileName(header: string | null, fallback: string): string {
  const match = header != null ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? fallback;
}

async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = attachmentFileName(res.headers.get('Content-Disposition'), fallbackName);
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Downloads the session report PDF of a member invoice (GET /v1/invoices/:id/session-report). */
export function downloadSessionReportPdf(invoiceId: string): Promise<void> {
  return downloadFile(
    `/v1/invoices/${invoiceId}/session-report`,
    `session-report-${invoiceId}.pdf`,
  );
}

/**
 * Downloads the session report CSV of a fleet's member invoices of a month
 * (GET /v1/fleets/:id/session-report.csv), for invoicing outside EVtivity.
 */
export function downloadFleetSessionReportCsv(fleetId: string, period: string): Promise<void> {
  return downloadFile(
    `/v1/fleets/${fleetId}/session-report.csv?period=${encodeURIComponent(period)}`,
    `session-report-${fleetId}-${period}.csv`,
  );
}

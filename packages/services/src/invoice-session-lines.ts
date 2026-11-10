// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { client } from '@evtivity/database';
import { grossUnitPrice, resolveTaxBasis } from '@evtivity/lib';
import type { InvoiceDetail } from './invoice.service.js';

/**
 * The session table of an invoice that bills only charging sessions: one row
 * per session with its start, the energy, the tariff's energy price and the
 * amount, both tax included, and a small line with the place and the times.
 * The tax summary below the table lists the net amounts and the tax.
 */

type LineItem = InvoiceDetail['lineItems'][number];

/** A session as the session table shows it, read from charging_sessions. */
export interface InvoiceSessionDetail {
  startedAt: Date | null;
  endedAt: Date | null;
  /** The station's OCPP identity. */
  stationName: string;
  siteName: string | null;
  /**
   * The tariff's energy price per kWh, tax included, when the tariff bills
   * energy alone; null when it also bills time, a fee per session or an idle
   * fee (the amount is then no multiple of the energy).
   */
  grossPricePerKwh: number | null;
}

export interface InvoiceSessionDetails {
  sessions: Map<string, InvoiceSessionDetail>;
  /** The system timezone (system.timezone) the times are shown in. */
  timeZone: string;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
  if (date == null) return null;
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** The energy price tax included, or null when the tariff bills more than energy. */
export function grossEnergyPrice(row: {
  pricePerKwh: number;
  pricePerMinute: number;
  pricePerSession: number;
  idleFeePricePerMinute: number;
  taxRate: number;
  basis: 'net' | 'gross';
}): number | null {
  if (row.pricePerKwh <= 0) return null;
  if (row.pricePerMinute !== 0 || row.pricePerSession !== 0 || row.idleFeePricePerMinute !== 0) {
    return null;
  }
  return grossUnitPrice(row.pricePerKwh, row.taxRate, row.basis);
}

/** The sessions of the invoice lines with their station, site and tariff snapshot. */
export async function loadInvoiceSessionDetails(
  sessionIds: string[],
): Promise<InvoiceSessionDetails> {
  const sessions = new Map<string, InvoiceSessionDetail>();
  let timeZone = 'UTC';
  if (sessionIds.length === 0) return { sessions, timeZone };
  const rows = await client`
    SELECT cs.id, cs.started_at, cs.ended_at, cs.tax_basis,
           cs.tariff_price_per_kwh, cs.tariff_price_per_minute, cs.tariff_price_per_session,
           cs.tariff_idle_fee_price_per_minute, cs.tariff_tax_rate,
           st.station_id AS station_name, si.name AS site_name,
           (SELECT value #>> '{}' FROM settings WHERE key = 'system.timezone') AS time_zone
    FROM charging_sessions cs
    LEFT JOIN charging_stations st ON st.id = cs.station_id
    LEFT JOIN sites si ON si.id = st.site_id
    WHERE cs.id = ANY(${sessionIds}::text[])
  `;
  for (const row of rows as Array<Record<string, unknown>>) {
    if (typeof row['id'] !== 'string') continue;
    if (typeof row['time_zone'] === 'string' && row['time_zone'] !== '') {
      timeZone = row['time_zone'];
    }
    sessions.set(row['id'], {
      startedAt: toDate(row['started_at']),
      endedAt: toDate(row['ended_at']),
      stationName: typeof row['station_name'] === 'string' ? row['station_name'] : '',
      siteName:
        typeof row['site_name'] === 'string' && row['site_name'] !== '' ? row['site_name'] : null,
      grossPricePerKwh: grossEnergyPrice({
        pricePerKwh: toNumber(row['tariff_price_per_kwh']),
        pricePerMinute: toNumber(row['tariff_price_per_minute']),
        pricePerSession: toNumber(row['tariff_price_per_session']),
        idleFeePricePerMinute: toNumber(row['tariff_idle_fee_price_per_minute']),
        taxRate: toNumber(row['tariff_tax_rate']),
        basis: resolveTaxBasis(row['tax_basis']),
      }),
    });
  }
  return { sessions, timeZone };
}

function lineKind(item: LineItem): unknown {
  const meta = item.metadata;
  return meta != null && typeof meta === 'object'
    ? (meta as Record<string, unknown>)['kind']
    : undefined;
}

/** True when every line bills a charging session as a whole (or its idle fee). */
export function billsSessionsOnly(lineItems: LineItem[]): boolean {
  return (
    lineItems.length > 0 &&
    lineItems.every((item) => {
      const kind = lineKind(item);
      return item.sessionId != null && (kind === 'session' || kind === 'idleFee');
    }) &&
    lineItems.some((item) => lineKind(item) === 'session')
  );
}

/** One row of the session table. */
export interface SessionTableRow {
  sessionId: string;
  /** Null on an idle fee row. */
  energyWh: number | null;
  grossPricePerKwh: number | null;
  grossCents: number;
  /** The stored line of an idle fee row, described by describeLineItem. */
  idleFee: LineItem | null;
  /** For sorting and the date column: the start, else the end of the session. */
  at: Date | null;
  /** The session date of the line (YYYY-MM-DD), when the session is not found. */
  sessionDate: string | null;
  detail: InvoiceSessionDetail | null;
  /** The driver of a fleet invoice line. */
  driverId: string | null;
  driverName: string;
  employeeNumber: string | null;
  /** The place stored on a fleet invoice line, shown when the session is not found. */
  storedPlace: string | null;
}

function metaString(item: LineItem, key: string): string | null {
  const meta = item.metadata;
  if (meta == null || typeof meta !== 'object') return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The session table rows of the lines: the 'session' lines of a session (one
 * per tax rate) make one row with their gross sum; an idle fee line makes its
 * own row below its session. Rows are ordered by the session start; a fleet
 * invoice keeps them grouped by driver (groupLinesByDriver).
 */
export function sessionTableRows(
  lineItems: LineItem[],
  sessions: Map<string, InvoiceSessionDetail>,
): SessionTableRow[] {
  const rows: SessionTableRow[] = [];
  const bySession = new Map<string, SessionTableRow>();
  for (const item of lineItems) {
    const sessionId = item.sessionId ?? '';
    const detail = sessions.get(sessionId) ?? null;
    const sessionDate = metaString(item, 'sessionDate');
    const fallbackAt = sessionDate != null ? toDate(`${sessionDate}T00:00:00Z`) : null;
    const base = {
      sessionId,
      at: detail?.startedAt ?? detail?.endedAt ?? fallbackAt,
      sessionDate,
      detail,
      driverId: metaString(item, 'driverId'),
      driverName: metaString(item, 'driverName') ?? '',
      employeeNumber: metaString(item, 'employeeNumber'),
      storedPlace: metaString(item, 'stationName'),
    };
    const grossCents = item.totalCents + item.taxCents;
    if (lineKind(item) === 'idleFee') {
      rows.push({ ...base, energyWh: null, grossPricePerKwh: null, grossCents, idleFee: item });
      continue;
    }
    const existing = bySession.get(sessionId);
    if (existing != null) {
      existing.grossCents += grossCents;
      continue;
    }
    const meta = item.metadata as Record<string, unknown>;
    const row: SessionTableRow = {
      ...base,
      energyWh: typeof meta['energyWh'] === 'number' ? meta['energyWh'] : 0,
      grossPricePerKwh: detail?.grossPricePerKwh ?? null,
      grossCents,
      idleFee: null,
    };
    bySession.set(sessionId, row);
    rows.push(row);
  }
  // Stable sort: by start, the idle fee row after its session row.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byAt = (a.row.at?.getTime() ?? 0) - (b.row.at?.getTime() ?? 0);
      return byAt !== 0 ? byAt : a.index - b.index;
    })
    .map(({ row }) => row);
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(date);
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    // fail-open: an unknown timezone shows UTC
    return 'UTC';
  }
}

/** The narrow no-break space before AM/PM is not in the PDF fonts. */
function clean(text: string): string {
  return text.replace(/[\u202f\u00a0]/g, ' ');
}

/** The date column: the start date and time, or the session date of the line. */
export function sessionStartText(row: SessionTableRow, locale: string, timeZone: string): string {
  const zone = safeTimeZone(timeZone);
  const start = row.detail?.startedAt ?? null;
  if (start != null) {
    return clean(
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(start),
    );
  }
  if (row.at == null) return row.sessionDate ?? '';
  return clean(
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' }).format(row.at),
  );
}

/**
 * The small line below a session row: site, station and the times from start
 * to end (the end with its date when it falls on another day).
 */
export function sessionPlaceText(row: SessionTableRow, locale: string, timeZone: string): string {
  const detail = row.detail;
  if (detail == null) return row.storedPlace ?? '';
  const zone = safeTimeZone(timeZone);
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, timeStyle: 'short' });
  const parts: string[] = [];
  if (detail.siteName != null) parts.push(detail.siteName);
  if (detail.stationName !== '') parts.push(detail.stationName);
  if (detail.startedAt != null && detail.endedAt != null) {
    const sameDay = dayKey(detail.startedAt, zone) === dayKey(detail.endedAt, zone);
    const end = sameDay
      ? time.format(detail.endedAt)
      : new Intl.DateTimeFormat(locale, {
          timeZone: zone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(detail.endedAt);
    parts.push(`${time.format(detail.startedAt)} – ${end}`);
  }
  return clean(parts.join(' · '));
}

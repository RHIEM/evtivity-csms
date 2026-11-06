// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi } from 'vitest';

const { sessionRows } = vi.hoisted(() => ({ sessionRows: { rows: [] as unknown[] } }));

vi.mock('@evtivity/database', () => ({
  client: vi.fn(() => Promise.resolve(sessionRows.rows)),
}));

import {
  billsSessionsOnly,
  grossEnergyPrice,
  loadInvoiceSessionDetails,
  sessionPlaceText,
  sessionStartText,
  sessionTableRows,
} from '../invoice-session-lines.js';
import type { InvoiceSessionDetail } from '../invoice-session-lines.js';
import type { InvoiceDetail } from '../invoice.service.js';

type LineItem = InvoiceDetail['lineItems'][number];

function line(
  id: number,
  sessionId: string,
  metadata: Record<string, unknown>,
  totalCents = 1000,
  taxCents = 190,
): LineItem {
  return {
    id,
    invoiceId: 'inv_1',
    sessionId,
    paymentRecordId: null,
    description: 'Charging session',
    quantity: '1',
    unitPriceCents: totalCents,
    totalCents,
    taxCents,
    taxRate: '0.19',
    metadata,
    createdAt: new Date('2026-11-01T00:00:00Z'),
  };
}

function detail(start: string, end: string): InvoiceSessionDetail {
  return {
    startedAt: new Date(start),
    endedAt: new Date(end),
    stationName: '28980051',
    siteName: 'Werk Bremen',
    grossPricePerKwh: 0.2561,
  };
}

const prices = {
  pricePerKwh: 0.2561,
  pricePerMinute: 0,
  pricePerSession: 0,
  idleFeePricePerMinute: 0,
  taxRate: 0.19,
};

describe('grossEnergyPrice', () => {
  it('keeps a gross price and adds the tax to a net one', () => {
    expect(grossEnergyPrice({ ...prices, basis: 'gross' })).toBe(0.2561);
    expect(grossEnergyPrice({ ...prices, pricePerKwh: 0.2, basis: 'net' })).toBeCloseTo(0.238);
  });

  it('has no price per kWh when the tariff bills more than energy', () => {
    expect(grossEnergyPrice({ ...prices, pricePerSession: 1, basis: 'gross' })).toBeNull();
    expect(grossEnergyPrice({ ...prices, pricePerMinute: 0.1, basis: 'gross' })).toBeNull();
    expect(grossEnergyPrice({ ...prices, idleFeePricePerMinute: 0.1, basis: 'gross' })).toBeNull();
    expect(grossEnergyPrice({ ...prices, pricePerKwh: 0, basis: 'gross' })).toBeNull();
  });
});

describe('billsSessionsOnly', () => {
  it('is true for session lines with their idle fees', () => {
    expect(
      billsSessionsOnly([
        line(1, 'ses_1', { kind: 'session' }),
        line(2, 'ses_1', { kind: 'idleFee' }),
      ]),
    ).toBe(true);
  });

  it('is false for component lines, idle fees alone and no lines', () => {
    expect(billsSessionsOnly([line(1, 'ses_1', { kind: 'energy', segment: 1 })])).toBe(false);
    expect(billsSessionsOnly([line(1, 'ses_1', { kind: 'idleFee' })])).toBe(false);
    expect(billsSessionsOnly([])).toBe(false);
  });
});

describe('sessionTableRows', () => {
  it('sums the tax rate lines of a session gross and orders the sessions by start', () => {
    const sessions = new Map([
      ['ses_1', detail('2026-10-12T06:00:00Z', '2026-10-12T08:00:00Z')],
      ['ses_2', detail('2026-10-10T06:00:00Z', '2026-10-10T08:00:00Z')],
    ]);
    const rows = sessionTableRows(
      [
        line(1, 'ses_1', { kind: 'session', energyWh: 12000 }, 1000, 190),
        line(2, 'ses_1', { kind: 'session', energyWh: 12000 }, 500, 35),
        line(3, 'ses_1', { kind: 'idleFee' }, 200, 38),
        line(4, 'ses_2', { kind: 'session', energyWh: 8000 }, 600, 114),
      ],
      sessions,
    );
    expect(rows.map((row) => [row.sessionId, row.energyWh, row.grossCents])).toEqual([
      ['ses_2', 8000, 714],
      ['ses_1', 12000, 1725],
      ['ses_1', null, 238],
    ]);
    expect(rows[0]?.grossPricePerKwh).toBe(0.2561);
    expect(rows[2]?.idleFee?.id).toBe(3);
  });

  it('falls back to the session date and the stored place without the session', () => {
    const [row] = sessionTableRows(
      [
        line(1, 'ses_x', {
          kind: 'session',
          sessionDate: '2026-10-10',
          stationName: 'Depot CS-01',
        }),
      ],
      new Map(),
    );
    expect(row?.grossPricePerKwh).toBeNull();
    expect(sessionStartText(row!, 'de-DE', 'Europe/Berlin')).toBe('10.10.2026');
    expect(sessionPlaceText(row!, 'de-DE', 'Europe/Berlin')).toBe('Depot CS-01');
  });
});

describe('session texts', () => {
  const rowOf = (d: InvoiceSessionDetail) =>
    sessionTableRows(
      [line(1, 'ses_1', { kind: 'session', energyWh: 1 })],
      new Map([['ses_1', d]]),
    )[0]!;

  it('shows the start in the system timezone and the place with the times', () => {
    const row = rowOf(detail('2026-10-10T06:12:00Z', '2026-10-10T08:47:00Z'));
    expect(sessionStartText(row, 'de-DE', 'Europe/Berlin')).toBe('10.10.2026, 08:12');
    expect(sessionPlaceText(row, 'de-DE', 'Europe/Berlin')).toBe(
      'Werk Bremen · 28980051 · 08:12 – 10:47',
    );
  });

  it('dates the end when it falls on another day', () => {
    const row = rowOf(detail('2026-10-10T20:00:00Z', '2026-10-11T04:30:00Z'));
    expect(sessionPlaceText(row, 'de-DE', 'Europe/Berlin')).toBe(
      'Werk Bremen · 28980051 · 22:00 – 11.10.2026, 06:30',
    );
  });

  it('shows UTC for an unknown timezone', () => {
    const row = rowOf(detail('2026-10-10T06:12:00Z', '2026-10-10T08:47:00Z'));
    expect(sessionStartText(row, 'de-DE', 'Nowhere/Unknown')).toBe('10.10.2026, 06:12');
  });
});

describe('loadInvoiceSessionDetails', () => {
  it('reads the sessions with the gross energy price and the system timezone', async () => {
    sessionRows.rows = [
      {
        id: 'ses_1',
        started_at: '2026-10-10T06:12:00Z',
        ended_at: '2026-10-10T08:47:00Z',
        tax_basis: 'net',
        tariff_price_per_kwh: '0.20',
        tariff_price_per_minute: null,
        tariff_price_per_session: '0',
        tariff_idle_fee_price_per_minute: null,
        tariff_tax_rate: '0.19',
        station_name: '28980051',
        site_name: '',
        time_zone: 'Europe/Berlin',
      },
    ];
    const { sessions, timeZone } = await loadInvoiceSessionDetails(['ses_1']);
    expect(timeZone).toBe('Europe/Berlin');
    const session = sessions.get('ses_1');
    expect(session?.siteName).toBeNull();
    expect(session?.stationName).toBe('28980051');
    expect(session?.grossPricePerKwh).toBeCloseTo(0.238);
    expect(session?.startedAt?.toISOString()).toBe('2026-10-10T06:12:00.000Z');
  });

  it('queries nothing without sessions', async () => {
    const result = await loadInvoiceSessionDetails([]);
    expect(result.sessions.size).toBe(0);
    expect(result.timeZone).toBe('UTC');
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { inflateSync } from 'node:zlib';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  settingsRows: [] as Array<{ key: string; value: unknown }>,
  sessionRows: [] as Array<Record<string, unknown>>,
  replacedRows: [] as Array<Record<string, unknown>>,
  evidenceRows: [] as Array<Record<string, unknown>>,
  invoiceIds: [] as Array<{ id: string }>,
  statements: [] as Array<{ text: string; values: unknown[] }>,
  details: new Map<string, unknown>(),
}));

vi.mock('@evtivity/database', () => ({
  client: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    h.statements.push({ text, values });
    if (text.includes('FROM charging_sessions cs')) return Promise.resolve(h.sessionRows);
    if (text.includes("status = 'credited'")) return Promise.resolve(h.replacedRows);
    if (text.includes('signed_meter_values')) return Promise.resolve(h.evidenceRows);
    if (text.includes('SELECT id FROM invoices')) return Promise.resolve(h.invoiceIds);
    return Promise.resolve(h.settingsRows);
  }),
  getSystemTimezone: vi.fn(() => Promise.resolve('Europe/Berlin')),
  getCompanyCurrency: vi.fn(() => Promise.resolve('EUR')),
}));

vi.mock('../invoice.service.js', () => ({
  getInvoice: vi.fn((id: string) => Promise.resolve(h.details.get(id) ?? null)),
}));

import {
  SESSION_REPORT_CSV_HEADER,
  buildFleetSessionReportCsv,
  buildSemicolonCsv,
  generateSessionReportPdf,
  isSessionReportInvoice,
  sessionReportCsvRows,
  sessionReportFileName,
  sessionReportRows,
  sessionReportToken,
  zonedIsoString,
} from '../session-report.service.js';
import type { SessionFacts } from '../session-report.service.js';
import { SESSION_REPORT_LABELS } from '../session-report-labels.js';
import { INVOICE_LANGUAGES } from '../invoice-labels.js';
import type { InvoiceDetail } from '../invoice.service.js';

/** Text drawn on the pages of a pdfkit PDF with the standard fonts (WinAnsi, latin1). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const data = Buffer.from(m[1] ?? '', 'latin1');
    let content: string;
    try {
      content = inflateSync(data).toString('latin1');
    } catch {
      content = data.toString('latin1');
    }
    if (!content.includes(' Tf')) continue;
    for (const token of content.matchAll(/<([0-9a-fA-F]*)>/g)) {
      parts.push(Buffer.from(token[1] ?? '', 'hex').toString('latin1'));
    }
  }
  return parts.join('');
}

const now = new Date('2026-11-30T11:00:00Z');

function line(id: number, sessionId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    invoiceId: 'inv_1',
    sessionId,
    paymentRecordId: null,
    description: 'Charging session',
    quantity: '1',
    unitPriceCents: 1000,
    totalCents: 1000,
    taxCents: 190,
    taxRate: '0.19',
    metadata: { kind: 'session', energyWh: 12000, stationName: 'Hof Ladepunkt 1' },
    createdAt: now,
    ...overrides,
  };
}

function detail(overrides: Partial<InvoiceDetail['invoice']> = {}): InvoiceDetail {
  return {
    invoice: {
      id: 'inv_1',
      invoiceNumber: 'INV-202611-0042',
      driverId: 'drv_1',
      status: 'paid',
      kind: 'invoice',
      memberBilled: true,
      creditedInvoiceId: null,
      creditReason: null,
      paidAt: now,
      paymentReference: 'Invoiced outside EVtivity',
      fleetId: 'flt_1',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      billTo: { name: 'Erika Muster', email: 'erika@example.com' },
      seller: null,
      language: 'de',
      sentAt: null,
      overdueNoticeSentAt: null,
      issuedAt: now,
      dueAt: new Date('2026-12-14T11:00:00Z'),
      currency: 'EUR',
      subtotalCents: 1500,
      taxCents: 285,
      totalCents: 1785,
      metadata: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    lineItems: [
      line(1, 'ses_1'),
      // A second line of the same session (a segment): summed into its row.
      line(2, 'ses_1', {
        totalCents: 200,
        taxCents: 38,
        metadata: { kind: 'idleFee' },
      }),
      line(3, 'ses_2', {
        totalCents: 300,
        taxCents: 57,
        metadata: { kind: 'session', energyWh: 4578.5, stationName: 'Tor 2' },
      }),
    ],
    driver: {
      id: 'drv_1',
      firstName: 'Erika',
      lastName: 'Muster',
      email: 'erika@example.com',
      language: 'de',
    },
    fleet: { id: 'flt_1', name: 'Acme GmbH' },
    taxBreakdown: [{ taxRate: 0.19, netCents: 1500, taxCents: 285, grossCents: 1785 }],
    creditedInvoice: null,
    creditNote: null,
  };
}

const facts = new Map<string, SessionFacts>([
  [
    'ses_1',
    {
      startedAt: new Date('2026-11-03T08:09:00Z'),
      endedAt: new Date('2026-11-03T09:41:00Z'),
      energyWh: 11990,
      idToken: '04A1B2C3',
      tokenLabel: 'Firmenkarte',
    },
  ],
  [
    'ses_2',
    {
      startedAt: new Date('2026-11-10T16:00:00Z'),
      endedAt: null,
      energyWh: null,
      idToken: 'DEADBEEF',
      tokenLabel: null,
    },
  ],
]);

beforeEach(() => {
  vi.clearAllMocks();
  h.settingsRows = [
    { key: 'company.name', value: 'Acme Charging' },
    { key: 'company.taxId', value: 'DE123456789' },
    { key: 'company.iban', value: 'DE02120300000000202051' },
  ];
  h.sessionRows = [];
  h.replacedRows = [];
  h.evidenceRows = [];
  h.invoiceIds = [];
  h.statements = [];
  h.details = new Map();
});

describe('isSessionReportInvoice', () => {
  it('is true for member invoices only', () => {
    expect(isSessionReportInvoice({ fleetId: 'flt_1', memberBilled: true, kind: 'invoice' })).toBe(
      true,
    );
    expect(
      isSessionReportInvoice({ fleetId: 'flt_1', memberBilled: true, kind: 'credit_note' }),
    ).toBe(false);
    expect(isSessionReportInvoice({ fleetId: 'flt_1', memberBilled: false, kind: 'invoice' })).toBe(
      false,
    );
    expect(isSessionReportInvoice({ fleetId: null, memberBilled: false, kind: 'invoice' })).toBe(
      false,
    );
  });
});

describe('sessionReportRows', () => {
  it('sums the lines of a session into one row with net, tax and gross', () => {
    const rows = sessionReportRows(detail(), facts, 'de');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sessionId: 'ses_1',
      place: 'Hof Ladepunkt 1',
      idToken: '04A1B2C3',
      tokenLabel: 'Firmenkarte',
      // The billed energy of the session line wins over the session row.
      energyWh: 12000,
      netCents: 1200,
      taxCents: 228,
      grossCents: 1428,
      taxRates: ['0.19'],
    });
    expect(rows[1]).toMatchObject({ sessionId: 'ses_2', place: 'Tor 2', grossCents: 357 });
    const total = rows.reduce((sum, row) => sum + row.grossCents, 0);
    expect(total).toBe(detail().invoice.totalCents);
  });

  it('keeps a line without a session as its own row, named by its description', () => {
    const base = detail();
    base.lineItems = [
      line(9, null, {
        description: 'No-show fee',
        metadata: { kind: 'noShowFee', chargeDate: '2026-11-05' },
      }),
    ];
    const [row] = sessionReportRows(base, new Map(), 'en');
    expect(row?.sessionId).toBeNull();
    expect(row?.place).not.toBe('');
    expect(row?.startedAt).toBeNull();
  });

  it('collects distinct tax rates of a session', () => {
    const base = detail();
    base.lineItems = [line(1, 'ses_1'), line(2, 'ses_1', { taxRate: '0.07', taxCents: 70 })];
    expect(sessionReportRows(base, facts, 'de')[0]?.taxRates).toEqual(['0.19', '0.07']);
  });
});

describe('sessionReportToken and sessionReportFileName', () => {
  it('names the card by its label and UID, else the UID', () => {
    expect(sessionReportToken({ idToken: 'AB12', tokenLabel: 'Privat' })).toBe('Privat (AB12)');
    expect(sessionReportToken({ idToken: 'AB12', tokenLabel: null })).toBe('AB12');
    expect(sessionReportToken({ idToken: null, tokenLabel: null })).toBe('');
  });

  it('names the PDF by the report language and month, ASCII only', () => {
    expect(sessionReportFileName(detail())).toBe('Ladesitzungsbericht-2026-11.pdf');
    expect(sessionReportFileName(detail({ language: 'en' }))).toBe('session-report-2026-11.pdf');
    for (const language of INVOICE_LANGUAGES) {
      expect(SESSION_REPORT_LABELS[language].fileStem).toMatch(/^[A-Za-z-]+$/);
    }
  });
});

describe('zonedIsoString', () => {
  it('writes the time in the zone with its offset', () => {
    expect(zonedIsoString(new Date('2026-11-03T08:09:16Z'), 'Europe/Berlin')).toBe(
      '2026-11-03T09:09:16+01:00',
    );
    expect(zonedIsoString(new Date('2026-07-03T08:09:16Z'), 'Europe/Berlin')).toBe(
      '2026-07-03T10:09:16+02:00',
    );
    expect(zonedIsoString(new Date('2026-11-03T23:30:00Z'), 'UTC')).toBe(
      '2026-11-03T23:30:00+00:00',
    );
  });
});

describe('session report CSV', () => {
  it('writes one row per session with decimal commas and ISO times', () => {
    const rows = sessionReportCsvRows([detail()], facts, 'Europe/Berlin');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      '2026-11',
      'drv_1',
      'Erika Muster',
      'erika@example.com',
      'ses_1',
      '2026-11-03T09:09:00+01:00',
      '2026-11-03T10:41:00+01:00',
      'Hof Ladepunkt 1',
      '04A1B2C3',
      'Firmenkarte',
      '12,000',
      '12,00',
      '19',
      '2,28',
      '14,28',
      'EUR',
      'INV-202611-0042',
    ]);
    expect(rows[1]?.slice(5, 7)).toEqual(['2026-11-10T17:00:00+01:00', '']);
    expect(rows[1]?.[10]).toBe('4,579');
    expect(rows[0]).toHaveLength(SESSION_REPORT_CSV_HEADER.length);
  });

  it('separates with semicolons, quotes what needs it and starts with a BOM', () => {
    const csv = buildSemicolonCsv(
      ['a', 'b'],
      [
        ['12,00', 'x;y'],
        ['=SUM(1)', 'plain'],
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['a;b', '"12,00";"x;y"', "'=SUM(1);plain"]);
  });

  it("reads the fleet's live member invoices of the month", async () => {
    h.invoiceIds = [{ id: 'inv_1' }, { id: 'inv_gone' }];
    h.details.set('inv_1', detail());
    h.sessionRows = [
      {
        id: 'ses_1',
        started_at: '2026-11-03T08:09:00Z',
        ended_at: '2026-11-03T09:41:00Z',
        energy_delivered_wh: '11990',
        id_token: '04A1B2C3',
        token_label: '',
      },
    ];
    const result = await buildFleetSessionReportCsv('flt_1', '2026-11');
    expect(result.fileName).toBe('session-report-flt_1-2026-11.csv');
    expect(result.invoiceCount).toBe(1);
    const select = h.statements.find((s) => s.text.includes('SELECT id FROM invoices'));
    expect(select?.text).toContain("member_billed AND kind = 'invoice'");
    expect(select?.text).toContain("status IN ('issued', 'paid')");
    expect(select?.values).toEqual(['flt_1', '2026-11-01']);
    const lines = result.csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(SESSION_REPORT_CSV_HEADER.join(';'));
    expect(lines).toHaveLength(3);
    // An empty card label is no label.
    expect(lines[1]).toContain(';04A1B2C3;;');
  });

  it('refuses a malformed period', async () => {
    await expect(buildFleetSessionReportCsv('flt_1', '2026-13')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('generateSessionReportPdf', () => {
  beforeEach(() => {
    h.sessionRows = [
      {
        id: 'ses_1',
        started_at: new Date('2026-11-03T08:09:00Z'),
        ended_at: new Date('2026-11-03T09:41:00Z'),
        energy_delivered_wh: '11990',
        id_token: '04A1B2C3',
        token_label: 'Firmenkarte',
      },
    ];
  });

  it('prints the report with net and gross totals and none of the marks of an invoice', async () => {
    const text = pdfText(await generateSessionReportPdf(detail()));
    expect(text).toContain('Ladesitzungsbericht');
    expect(text).toContain('Dieser Bericht ist keine Rechnung.');
    expect(text).toContain('Erika Muster');
    expect(text).toContain('Flotte: Acme GmbH');
    expect(text).toContain('Acme Charging');
    expect(text).toContain('Firmenkarte (04A1B2C3)');
    expect(text).toContain('03.11.2026, 09:09');
    expect(text).toContain('Summe netto');
    expect(text).toContain('15,00');
    expect(text).toContain('Summe brutto');
    expect(text).toContain('17,85');
    expect(text).toContain('Sitzung ses_1');
    expect(text).toContain('Zeiten in Europe/Berlin.');
    // No invoice number, due date, payment details, tax ID or tax line.
    expect(text).not.toContain('INV-202611-0042');
    expect(text).not.toMatch(/Fällig|Rechnungsnummer|Zahlungsinformationen|USt/);
    expect(text).not.toContain('DE02');
    expect(text).not.toContain('DE123456789');
  });

  it('names the report it replaces', async () => {
    h.replacedRows = [{ issued_at: new Date('2026-11-30T11:00:00Z') }];
    const text = pdfText(await generateSessionReportPdf(detail()));
    expect(text).toContain('Ersetzt den Bericht vom 30.11.2026');
    const query = h.statements.find((s) => s.text.includes("status = 'credited'"));
    expect(query?.values.slice(0, 4)).toEqual(['flt_1', 'drv_1', '2026-11-01', 'inv_1']);
  });

  it('renders in English for a language without report labels', async () => {
    const text = pdfText(await generateSessionReportPdf(detail({ language: 'fr' })));
    expect(text).toContain('Charging session report');
    expect(text).toContain('This report is not an invoice.');
  });
});

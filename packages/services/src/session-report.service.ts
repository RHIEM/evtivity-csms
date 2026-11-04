// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import PDFDocument from 'pdfkit';
import { client, getSystemTimezone } from '@evtivity/database';
import { createLogger, csvEscape, formatCurrencyAmount, formatTaxRatePercent } from '@evtivity/lib';
import type { InvoiceDetail } from './invoice.service.js';
import { getInvoice } from './invoice.service.js';
import { INVOICE_LABELS, describeLineItem } from './invoice-labels.js';
import type { InvoiceLanguage } from './invoice-labels.js';
import {
  INVOICE_EVIDENCE_LABELS,
  loadSessionEvidence,
  sessionEvidenceLine,
} from './invoice-evidence.js';
import {
  formatPeriod,
  loadInvoiceSeller,
  readBillTo,
  resolveInvoicePdfLanguage,
} from './invoice-pdf.service.js';
import { fleetInvoicePeriod } from './fleet-invoice.service.js';
import { SESSION_REPORT_LABELS } from './session-report-labels.js';
import type { SessionReportLabels } from './session-report-labels.js';
import { registerPdfFonts, registerPdfTextFonts } from './cjk-fonts.js';
import {
  defaultPdfLogoPng,
  drawPdfFooter,
  layoutPdfFooter,
  loadPdfBranding,
  reservePdfFooterSpace,
} from './pdf-branding.js';

/**
 * The session report: what a driver gets instead of a member invoice when the
 * operator invoices outside EVtivity (`invoice.externalInvoicing`). It is
 * rendered from the internal member invoice, so the report, the invoice and
 * the CSV for the external invoicing agree to the cent: one row per session
 * with its net and gross amount, and the totals. It carries none of the
 * marks of an invoice (no invoice number, due date, payment details or tax
 * line) and says that it is not one.
 */

const logger = createLogger('session-report');

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 portrait width in points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LOGO_MAX_WIDTH = 160;
const LOGO_MAX_HEIGHT = 60;
/** Lowest y of the page content with the default bottom margin. */
const PAGE_BOTTOM = 760;

const COLOR_TEXT = '#0f172a';
const COLOR_MUTED = '#64748b';
const COLOR_LINE = '#cbd5e1';
const COLOR_NOTICE = '#f1f5f9';
const ROW_BAND_COLOR = '#f5f7fa';

type Invoice = InvoiceDetail['invoice'];
type LineItem = InvoiceDetail['lineItems'][number];

/**
 * True for the invoices a session report renders: member invoices (not their
 * credit notes, not fleet invoices, not driver invoices).
 */
export function isSessionReportInvoice(
  invoice: Pick<Invoice, 'fleetId' | 'memberBilled' | 'kind'>,
): boolean {
  return invoice.fleetId != null && invoice.memberBilled && invoice.kind === 'invoice';
}

/** What the report prints of a session besides its amounts. */
export interface SessionFacts {
  startedAt: Date | null;
  endedAt: Date | null;
  energyWh: number | null;
  idToken: string | null;
  tokenLabel: string | null;
}

function toDate(value: unknown): Date | null {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
  else return null;
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Start, end, energy and the card of the sessions, by session id. */
export async function loadSessionFacts(sessionIds: string[]): Promise<Map<string, SessionFacts>> {
  const facts = new Map<string, SessionFacts>();
  if (sessionIds.length === 0) return facts;
  const rows = await client`
    SELECT cs.id, cs.started_at, cs.ended_at, cs.energy_delivered_wh,
      dt.id_token, dt.label AS token_label
    FROM charging_sessions cs
    LEFT JOIN driver_tokens dt ON dt.id = cs.token_id
    WHERE cs.id = ANY(${sessionIds}::text[])
  `;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    if (typeof record['id'] !== 'string') continue;
    facts.set(record['id'], {
      startedAt: toDate(record['started_at']),
      endedAt: toDate(record['ended_at']),
      energyWh: toNumber(record['energy_delivered_wh']),
      idToken: typeof record['id_token'] === 'string' ? record['id_token'] : null,
      tokenLabel:
        typeof record['token_label'] === 'string' && record['token_label'] !== ''
          ? record['token_label']
          : null,
    });
  }
  return facts;
}

/** One row of the report: a session (all its lines), or a line without a session. */
export interface SessionReportRow {
  sessionId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  /** The station (site and station at issue), or the line's description without a session. */
  place: string;
  idToken: string | null;
  tokenLabel: string | null;
  energyWh: number | null;
  netCents: number;
  taxCents: number;
  grossCents: number;
  /** The distinct tax rates of the row's lines (decimal fraction strings). */
  taxRates: string[];
}

function lineMeta(item: LineItem): Record<string, unknown> {
  return item.metadata != null && typeof item.metadata === 'object'
    ? (item.metadata as Record<string, unknown>)
    : {};
}

/**
 * The rows of a member invoice, in the order of its lines: the lines of a
 * session are summed into one row (net, tax, gross); a line without a
 * session (a fee) is a row of its own, named by its description.
 */
export function sessionReportRows(
  detail: InvoiceDetail,
  facts: Map<string, SessionFacts>,
  language: InvoiceLanguage,
): SessionReportRow[] {
  const rows: SessionReportRow[] = [];
  const bySession = new Map<string, SessionReportRow>();
  for (const item of detail.lineItems) {
    const meta = lineMeta(item);
    let row = item.sessionId != null ? bySession.get(item.sessionId) : undefined;
    if (row == null) {
      const fact = item.sessionId != null ? facts.get(item.sessionId) : undefined;
      row = {
        sessionId: item.sessionId,
        startedAt: fact?.startedAt ?? null,
        endedAt: fact?.endedAt ?? null,
        place:
          item.sessionId == null
            ? describeLineItem(INVOICE_LABELS[language], item.description, item.metadata)
            : '',
        idToken: fact?.idToken ?? null,
        tokenLabel: fact?.tokenLabel ?? null,
        energyWh: fact?.energyWh ?? null,
        netCents: 0,
        taxCents: 0,
        grossCents: 0,
        taxRates: [],
      };
      rows.push(row);
      if (item.sessionId != null) bySession.set(item.sessionId, row);
    }
    // The billed values of the session line win over the session row.
    if (typeof meta['stationName'] === 'string' && meta['stationName'] !== '') {
      row.place = meta['stationName'];
    }
    if (typeof meta['energyWh'] === 'number' && Number.isFinite(meta['energyWh'])) {
      row.energyWh = meta['energyWh'];
    }
    row.netCents += item.totalCents;
    row.taxCents += item.taxCents;
    row.grossCents += item.totalCents + item.taxCents;
    if (!row.taxRates.includes(item.taxRate)) row.taxRates.push(item.taxRate);
  }
  return rows;
}

/** The card as the report names it: its label with the UID, else the UID. */
export function sessionReportToken(row: Pick<SessionReportRow, 'idToken' | 'tokenLabel'>): string {
  if (row.idToken == null) return row.tokenLabel ?? '';
  return row.tokenLabel != null ? `${row.tokenLabel} (${row.idToken})` : row.idToken;
}

/** `<stem>-YYYY-MM.pdf` in the report's language, ASCII only. */
export function sessionReportFileName(detail: InvoiceDetail): string {
  const language = resolveInvoicePdfLanguage(detail.invoice.language ?? detail.driver?.language);
  const month = detail.invoice.periodStart?.slice(0, 7) ?? detail.invoice.id;
  return `${SESSION_REPORT_LABELS[language].fileStem}-${month}.pdf`;
}

function formatDay(value: Date | null, locale: string, timeZone: string): string {
  if (value == null) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(value);
}

function formatDateTime(value: Date | null, locale: string, timeZone: string): string {
  if (value == null) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(value);
}

function formatKwh(energyWh: number | null, locale: string): string {
  if (energyWh == null) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(energyWh / 1000);
}

/** A table column: x offset from the margin, width, and alignment. */
interface Column {
  x: number;
  width: number;
  align: 'left' | 'right';
}

const COLUMNS: Column[] = [
  { x: 0, width: 68, align: 'left' }, // start
  { x: 74, width: 68, align: 'left' }, // end
  { x: 148, width: 114, align: 'left' }, // location
  { x: 266, width: 90, align: 'left' }, // card
  { x: 360, width: 38, align: 'right' }, // kWh
  { x: 402, width: 45, align: 'right' }, // net
  { x: 451, width: CONTENT_WIDTH - 451, align: 'right' }, // gross
];

function rowHeight(doc: PDFKit.PDFDocument, values: string[]): number {
  let height = 0;
  COLUMNS.forEach((col, i) => {
    height = Math.max(height, doc.heightOfString(values[i] ?? '', { width: col.width }));
  });
  return Math.max(14, height + 4);
}

function drawRow(doc: PDFKit.PDFDocument, values: string[], y: number): number {
  COLUMNS.forEach((col, i) => {
    doc.text(values[i] ?? '', MARGIN + col.x, y, { width: col.width, align: col.align });
  });
  return rowHeight(doc, values);
}

function drawRule(doc: PDFKit.PDFDocument, y: number, fromX = MARGIN): void {
  doc
    .moveTo(fromX, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .stroke(COLOR_LINE);
}

/** The driver's name: the bill-to name at issue, else the driver's name. */
function reportDriverName(detail: InvoiceDetail): string {
  const billTo = readBillTo(detail.invoice.billTo);
  if (billTo != null) return billTo.name;
  const { driver } = detail;
  return driver != null ? `${driver.firstName} ${driver.lastName}`.trim() : '—';
}

/**
 * Renders the session report of a member invoice (isSessionReportInvoice) as
 * a portrait A4 PDF in the invoice's language: the PDF logo and footer of
 * the invoices, the driver and fleet, the operator, the period, the notice
 * that it is not an invoice, one row per session (start, end, location,
 * card, energy, net, gross) with the check line of the signed meter data,
 * and the totals. Times are in the system timezone.
 */
export async function generateSessionReportPdf(detail: InvoiceDetail): Promise<Buffer> {
  const { invoice, lineItems, fleet, driver } = detail;
  const language = resolveInvoicePdfLanguage(invoice.language ?? driver?.language);
  const labels: SessionReportLabels = SESSION_REPORT_LABELS[language];
  const { locale } = INVOICE_LABELS[language];
  const money = (cents: number): string => formatCurrencyAmount(cents, invoice.currency, locale);

  const sessionIds = [
    ...new Set(lineItems.flatMap((item) => (item.sessionId != null ? [item.sessionId] : []))),
  ];
  const [seller, branding, timeZone, facts, evidence] = await Promise.all([
    loadInvoiceSeller(),
    loadPdfBranding(),
    getSystemTimezone(),
    loadSessionFacts(sessionIds),
    loadSessionEvidence(sessionIds),
  ]);
  const rows = sessionReportRows(detail, facts, language);
  const evidenceLabels = INVOICE_EVIDENCE_LABELS[language];

  const doc = new PDFDocument({
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN },
    size: 'A4',
    layout: 'portrait',
    bufferPages: true,
  });
  const baseFonts = registerPdfFonts(doc, language);
  const driverName = reportDriverName(detail);
  // Names, places and card labels are operator or driver text: they can hold
  // characters the document font lacks.
  const fonts = registerPdfTextFonts(
    doc,
    baseFonts,
    [
      driverName,
      fleet?.name ?? '',
      seller.name,
      ...seller.addressLines,
      ...rows.flatMap((row) => [row.place, sessionReportToken(row)]),
    ].join('\n'),
  );
  const footer = layoutPdfFooter(doc, branding.footer, CONTENT_WIDTH);
  const pageBottom = PAGE_BOTTOM - (reservePdfFooterSpace(doc, footer, MARGIN) - MARGIN);
  const ensure = (y: number, needed: number): number => {
    if (y + needed > pageBottom) {
      doc.addPage();
      return MARGIN;
    }
    return y;
  };
  const chunks: Buffer[] = [];
  const built = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });

  // Header: the PDF logo on the left, the title and the period on the right.
  try {
    doc.image(branding.logo, MARGIN, MARGIN, { fit: [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT] });
  } catch (err) {
    logger.warn({ err }, 'pdfkit rejected the PDF logo, using the default logo');
    doc.image(defaultPdfLogoPng(), MARGIN, MARGIN, { fit: [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT] });
  }
  const period = formatPeriod(invoice.periodStart, locale) ?? '—';
  doc
    .fontSize(18)
    .font(fonts.bold)
    .fillColor(COLOR_TEXT)
    .text(labels.title, MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
  doc
    .fontSize(11)
    .font(fonts.regular)
    .fillColor(COLOR_MUTED)
    .text(period, MARGIN, MARGIN + 26, { width: CONTENT_WIDTH, align: 'right' });

  let y = MARGIN + LOGO_MAX_HEIGHT + 20;
  drawRule(doc, y);
  y += 20;

  // The driver (with the fleet) on the left, the operator on the right.
  const half = CONTENT_WIDTH / 2 - 10;
  const rightX = MARGIN + CONTENT_WIDTH / 2;
  doc.fontSize(9).font(fonts.bold).fillColor(COLOR_MUTED).text(labels.driver, MARGIN, y);
  doc
    .fontSize(11)
    .font(fonts.regular)
    .fillColor(COLOR_TEXT)
    .text(driverName, MARGIN, y + 12, { width: half });
  let leftY = y + 12 + Math.max(15, doc.heightOfString(driverName, { width: half }));
  if (fleet != null) {
    const line = labels.viaFleet.replace('{fleet}', fleet.name);
    doc.fontSize(10).fillColor(COLOR_MUTED).text(line, MARGIN, leftY, { width: half });
    leftY += Math.max(14, doc.heightOfString(line, { width: half }));
  }
  doc.fontSize(9).font(fonts.bold).fillColor(COLOR_MUTED).text(labels.operator, rightX, y);
  doc
    .fontSize(11)
    .font(fonts.regular)
    .fillColor(COLOR_TEXT)
    .text(seller.name, rightX, y + 12, { width: half });
  let rightY = y + 12 + Math.max(15, doc.heightOfString(seller.name, { width: half }));
  doc.fontSize(10).fillColor(COLOR_MUTED);
  for (const line of seller.addressLines) {
    doc.text(line, rightX, rightY, { width: half });
    rightY += Math.max(14, doc.heightOfString(line, { width: half }));
  }
  y = Math.max(y + 50, leftY + 10, rightY + 10);

  const metaRows: Array<[string, string]> = [
    [labels.period, period],
    [labels.created, formatDay(invoice.issuedAt, locale, timeZone)],
    [labels.reference, invoice.id],
  ];
  for (const [label, value] of metaRows) {
    doc.fontSize(10).font(fonts.regular).fillColor(COLOR_MUTED).text(label, MARGIN, y, {
      width: 120,
    });
    doc
      .font(fonts.bold)
      .fillColor(COLOR_TEXT)
      .text(value, MARGIN + 120, y, { width: CONTENT_WIDTH - 120 });
    y += 16;
  }
  y += 8;

  // The notice that this is not an invoice, in a box.
  doc.fontSize(10).font(fonts.bold);
  const noticeHeight = doc.heightOfString(labels.notice, { width: CONTENT_WIDTH - 16 });
  doc.rect(MARGIN, y, CONTENT_WIDTH, noticeHeight + 12).fill(COLOR_NOTICE);
  doc.fillColor(COLOR_TEXT).text(labels.notice, MARGIN + 8, y + 6, { width: CONTENT_WIDTH - 16 });
  y += noticeHeight + 26;

  // The sessions.
  const header = [
    labels.begin,
    labels.end,
    labels.place,
    labels.token,
    labels.energy,
    labels.net,
    labels.gross,
  ];
  doc.fontSize(8).font(fonts.bold).fillColor(COLOR_MUTED);
  y += drawRow(doc, header, y);
  drawRule(doc, y - 3);

  rows.forEach((row, index) => {
    const values = [
      formatDateTime(row.startedAt, locale, timeZone),
      formatDateTime(row.endedAt, locale, timeZone),
      row.place,
      sessionReportToken(row),
      formatKwh(row.energyWh, locale),
      money(row.netCents),
      money(row.grossCents),
    ];
    doc.font(fonts.regular).fontSize(8);
    y = ensure(y, rowHeight(doc, values) + 12);
    if (index % 2 === 1) {
      doc.rect(MARGIN - 4, y - 2, CONTENT_WIDTH + 8, rowHeight(doc, values)).fill(ROW_BAND_COLOR);
    }
    doc.fillColor(COLOR_TEXT);
    y += drawRow(doc, values, y);
    if (row.sessionId != null) {
      // The check line: the session id and its signed meter readings.
      const text = sessionEvidenceLine(
        evidenceLabels,
        locale,
        row.sessionId,
        evidence.get(row.sessionId),
      );
      doc.font(fonts.regular).fontSize(7).fillColor(COLOR_MUTED);
      const height = doc.heightOfString(text, { width: CONTENT_WIDTH });
      y = ensure(y - 3, height + 4);
      doc.text(text, MARGIN, y, { width: CONTENT_WIDTH });
      y += height + 4;
    }
  });

  // The totals: sessions, energy, net and gross. Must not split across pages.
  const energyWh = rows.reduce((sum, row) => sum + (row.energyWh ?? 0), 0);
  const sessionCount = rows.filter((row) => row.sessionId != null).length;
  const totals: Array<[string, string, boolean]> = [
    [labels.sessionCount, String(sessionCount), false],
    [labels.totalEnergy, `${formatKwh(energyWh, locale)} kWh`, false],
    [labels.totalNet, money(invoice.subtotalCents), false],
    [labels.totalGross, money(invoice.totalCents), true],
  ];
  y = ensure(y + 10, 10 + totals.length * 18);
  drawRule(doc, y, MARGIN + CONTENT_WIDTH / 2);
  y += 10;
  const totalsX = MARGIN + CONTENT_WIDTH / 2;
  const valueWidth = 110;
  for (const [label, value, bold] of totals) {
    doc
      .fontSize(bold ? 12 : 10)
      .font(bold ? fonts.bold : fonts.regular)
      .fillColor(bold ? COLOR_TEXT : COLOR_MUTED)
      .text(label, totalsX, y, { width: CONTENT_WIDTH / 2 - valueWidth });
    doc
      .fillColor(COLOR_TEXT)
      .text(value, MARGIN + CONTENT_WIDTH - valueWidth, y, { width: valueWidth, align: 'right' });
    y += bold ? 20 : 16;
  }

  const notes = [labels.timesNote.replace('{zone}', timeZone)];
  if (evidence.size > 0) notes.push(evidenceLabels.note);
  doc.font(fonts.regular).fontSize(7).fillColor(COLOR_MUTED);
  y += 6;
  for (const note of notes) {
    const height = doc.heightOfString(note, { width: CONTENT_WIDTH });
    y = ensure(y, height + 4);
    doc.text(note, MARGIN, y, { width: CONTENT_WIDTH });
    y += height + 4;
  }

  drawPdfFooter(doc, footer, MARGIN, CONTENT_WIDTH);
  doc.end();
  return built;
}

/** Cents as a decimal with a comma, e.g. 1234 → "12,34". */
function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Wh as kWh with three decimals and a comma, e.g. 4578.5 → "4,579". */
function csvKwh(energyWh: number | null): string {
  return energyWh == null ? '' : (energyWh / 1000).toFixed(3).replace('.', ',');
}

/** A decimal fraction tax rate as a percent with a comma, e.g. "0.19" → "19". */
function csvTaxRate(taxRate: string): string {
  return formatTaxRatePercent(Number(taxRate), 'de-DE');
}

/** The instant in the timezone as ISO 8601 with its offset, e.g. 2026-11-03T09:09:16+01:00. */
export function zonedIsoString(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const zone = get('timeZoneName').replace('GMT', '');
  const offset = zone === '' ? '+00:00' : zone;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

export const SESSION_REPORT_CSV_HEADER = [
  'period',
  'driver_id',
  'driver_name',
  'driver_email',
  'session_id',
  'started_at',
  'ended_at',
  'location',
  'card_uid',
  'card_label',
  'energy_kwh',
  'net',
  'tax_rate_percent',
  'tax',
  'gross',
  'currency',
  'invoice_number',
] as const;

/**
 * The CSV rows of member invoices for the external invoicing: one row per
 * session (or line without a session), in the order of the invoices.
 * Amounts and energy with a decimal comma, times as ISO 8601 with the offset
 * of the timezone. `invoice_number` is the internal invoice, for matching.
 */
export function sessionReportCsvRows(
  details: InvoiceDetail[],
  facts: Map<string, SessionFacts>,
  timeZone: string,
): string[][] {
  const out: string[][] = [];
  for (const detail of details) {
    const { invoice, driver } = detail;
    const language = resolveInvoicePdfLanguage(invoice.language ?? driver?.language);
    const period = invoice.periodStart?.slice(0, 7) ?? '';
    const driverName = reportDriverName(detail);
    for (const row of sessionReportRows(detail, facts, language)) {
      out.push([
        period,
        invoice.driverId ?? '',
        driverName,
        driver?.email ?? '',
        row.sessionId ?? '',
        row.startedAt != null ? zonedIsoString(row.startedAt, timeZone) : '',
        row.endedAt != null ? zonedIsoString(row.endedAt, timeZone) : '',
        row.place,
        row.idToken ?? '',
        row.tokenLabel ?? '',
        csvKwh(row.energyWh),
        csvAmount(row.netCents),
        row.taxRates.map(csvTaxRate).join('/'),
        csvAmount(row.taxCents),
        csvAmount(row.grossCents),
        invoice.currency,
        invoice.invoiceNumber,
      ]);
    }
  }
  return out;
}

/** Semicolon-separated CSV with a UTF-8 BOM and CRLF, as a German Excel opens it. */
export function buildSemicolonCsv(header: readonly string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(';'));
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * The CSV of a fleet's member invoices of a month (YYYY-MM) for the external
 * invoicing: the live member invoices of the period (issued or paid, not
 * void or credited), ordered by invoice number. Throws VALIDATION_ERROR
 * (400) for a malformed period.
 */
export async function buildFleetSessionReportCsv(
  fleetId: string,
  period: string,
): Promise<{ csv: string; fileName: string; invoiceCount: number }> {
  const timeZone = await getSystemTimezone();
  const bounds = fleetInvoicePeriod(period, timeZone);
  const ids = (await client`
    SELECT id FROM invoices
    WHERE fleet_id = ${fleetId} AND member_billed AND kind = 'invoice'
      AND period_start = ${bounds.periodStart}::date
      AND status IN ('issued', 'paid')
    ORDER BY invoice_number
  `) as unknown as Array<{ id: string }>;
  const details: InvoiceDetail[] = [];
  for (const { id } of ids) {
    const detail = await getInvoice(id);
    if (detail != null) details.push(detail);
  }
  const sessionIds = [
    ...new Set(
      details.flatMap((detail) =>
        detail.lineItems.flatMap((item) => (item.sessionId != null ? [item.sessionId] : [])),
      ),
    ),
  ];
  const facts = await loadSessionFacts(sessionIds);
  const csv = buildSemicolonCsv(
    SESSION_REPORT_CSV_HEADER,
    sessionReportCsvRows(details, facts, timeZone),
  );
  return { csv, fileName: `session-report-${fleetId}-${period}.csv`, invoiceCount: details.length };
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { client, getInvoicePaymentSettings } from '@evtivity/database';
import {
  COMPANY_INVOICE_EMAIL_KEY,
  COMPANY_INVOICE_PHONE_KEY,
  COMPANY_REGISTRATION_NUMBER_KEY,
  COMPANY_TAX_ID_KEY,
  COMPANY_TAX_ID_LABEL_KEY,
  INVOICE_SELLER_SETTING_KEYS,
  PDF_LETTERHEAD_FOLLOWING_TOP_MM,
  createLogger,
  formatCurrencyAmount,
  formatTaxRatePercent,
} from '@evtivity/lib';
import type { InvoiceDetail } from './invoice.service.js';
import { INVOICE_LABELS, describeLineItem, isInvoiceLanguage } from './invoice-labels.js';
import { invoicePaymentBlock } from './invoice-payment-block.js';
import {
  INVOICE_EVIDENCE_LABELS,
  loadSessionEvidence,
  sessionEvidenceLine,
} from './invoice-evidence.js';
import type { InvoicePaymentBlock } from './invoice-payment-block.js';
import type { InvoiceLabels, InvoiceLanguage } from './invoice-labels.js';
import { pdfCanRender, registerPdfFonts, registerPdfTextFonts } from './cjk-fonts.js';
import {
  defaultPdfLogoPng,
  drawPdfFooter,
  layoutPdfFooter,
  loadPdfBranding,
  reservePdfFooterSpace,
} from './pdf-branding.js';
import { loadPdfLetterhead, mmToPt, renderPdfLetterheadBackground } from './invoice-letterhead.js';
import type { PdfLetterhead } from './invoice-letterhead.js';

const logger = createLogger('invoice-pdf');

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 portrait width in points
const PAGE_HEIGHT = 841.89; // A4 portrait height in points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LOGO_MAX_WIDTH = 160;
const LOGO_MAX_HEIGHT = 60;
/** Lowest y of the page content with the default bottom margin. */
const PAGE_BOTTOM = 760;

const COLOR_TEXT = '#0f172a';
const COLOR_MUTED = '#64748b';
const COLOR_LINE = '#cbd5e1';

/**
 * The PDF language: the given language (the driver's, or the language stored
 * on a fleet invoice) when the PDF can render it, else English. Korean and Chinese need the Noto Sans CJK fonts of the API image
 * (`@evtivity/services/cjk-fonts`) and fall back to English without them.
 */
export function resolveInvoicePdfLanguage(
  driverLanguage: string | null | undefined,
): InvoiceLanguage {
  if (!isInvoiceLanguage(driverLanguage)) return 'en';
  if (!pdfCanRender(driverLanguage)) return 'en';
  return driverLanguage;
}

/** The bill-to block as stored on a fleet or member invoice (FleetBillTo). */
interface BillToBlock {
  name: string;
  lines: string[];
  /** The postal address lines alone (lines without the email). */
  address: string[];
  email: string | null;
  taxId: string | null;
  /** Member invoice: the driver's employee number at issue. */
  employeeNumber: string | null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The bill-to snapshot of a fleet or member invoice, or null on a driver
 * invoice. A member invoice's snapshot carries the driver's email, printed
 * after the address lines, so an invoice without an address still names its
 * recipient.
 */
export function readBillTo(billTo: unknown): BillToBlock | null {
  if (billTo == null || typeof billTo !== 'object') return null;
  const record = billTo as Record<string, unknown>;
  const name = stringField(record, 'name');
  if (name == null) return null;
  const email = stringField(record, 'email');
  const address = addressLines(record);
  return {
    name,
    lines: [...address, ...(email != null ? [email] : [])],
    address,
    email,
    taxId: stringField(record, 'taxId'),
    employeeNumber: stringField(record, 'employeeNumber'),
  };
}

/**
 * Address lines from `street`, `zip`, `city`, `state` and `country` fields:
 * the street, "zip city", the state and the country, each left out when empty.
 */
function addressLines(record: Record<string, unknown>): string[] {
  const cityLine = [stringField(record, 'zip'), stringField(record, 'city')]
    .filter((part): part is string => part != null)
    .join(' ');
  return [
    stringField(record, 'street'),
    cityLine !== '' ? cityLine : null,
    stringField(record, 'state'),
    stringField(record, 'country'),
  ].filter((line): line is string => line != null);
}

/** The seller printed in the "From" block of an invoice or credit note. */
export interface InvoiceSeller {
  name: string;
  /** The company address, formatted like the fleet bill-to block. */
  addressLines: string[];
  taxId: string | null;
  /** The operator's tax ID label; null prints the localized "Tax ID" label. */
  taxIdLabel: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
}

const COMPANY_ADDRESS_KEYS = {
  street: 'company.street',
  city: 'company.city',
  zip: 'company.zip',
  state: 'company.state',
  country: 'company.country',
} as const;

const SELLER_SETTING_KEYS = [
  'company.name',
  ...Object.values(COMPANY_ADDRESS_KEYS),
  ...INVOICE_SELLER_SETTING_KEYS,
];

/** The seller from the settings rows (key to value). Empty values are null. */
export function readInvoiceSeller(settings: Record<string, unknown>): InvoiceSeller {
  return {
    name: stringField(settings, 'company.name') ?? 'EVtivity',
    addressLines: addressLines({
      street: settings[COMPANY_ADDRESS_KEYS.street],
      city: settings[COMPANY_ADDRESS_KEYS.city],
      zip: settings[COMPANY_ADDRESS_KEYS.zip],
      state: settings[COMPANY_ADDRESS_KEYS.state],
      country: settings[COMPANY_ADDRESS_KEYS.country],
    }),
    taxId: stringField(settings, COMPANY_TAX_ID_KEY),
    taxIdLabel: stringField(settings, COMPANY_TAX_ID_LABEL_KEY),
    registrationNumber: stringField(settings, COMPANY_REGISTRATION_NUMBER_KEY),
    email: stringField(settings, COMPANY_INVOICE_EMAIL_KEY),
    phone: stringField(settings, COMPANY_INVOICE_PHONE_KEY),
  };
}

/**
 * The seller kept on an invoice or credit note at issue (`invoices.seller`,
 * InvoiceSellerSnapshot), or null on a document issued before the seller was
 * kept: its PDF prints the current settings (loadInvoiceSeller).
 */
export function readStoredInvoiceSeller(stored: unknown): InvoiceSeller | null {
  if (stored == null || typeof stored !== 'object') return null;
  const record = stored as Record<string, unknown>;
  return {
    name: stringField(record, 'name') ?? 'EVtivity',
    addressLines: addressLines(record),
    taxId: stringField(record, 'taxId'),
    taxIdLabel: stringField(record, 'taxIdLabel'),
    registrationNumber: stringField(record, 'registrationNumber'),
    email: stringField(record, 'email'),
    phone: stringField(record, 'phone'),
  };
}

/**
 * The lines printed under the seller's name: the address, the tax ID with
 * its label, the registration number, the invoice email and phone. Fields
 * that are not set are left out.
 */
export function sellerDetailLines(seller: InvoiceSeller, labels: InvoiceLabels): string[] {
  const lines = [...seller.addressLines];
  if (seller.taxId != null) {
    lines.push(
      seller.taxIdLabel != null
        ? `${seller.taxIdLabel}: ${seller.taxId}`
        : labels.sellerTaxId.replace('{id}', seller.taxId),
    );
  }
  if (seller.registrationNumber != null) {
    lines.push(labels.registrationNumber.replace('{id}', seller.registrationNumber));
  }
  if (seller.email != null) lines.push(seller.email);
  if (seller.phone != null) lines.push(seller.phone);
  return lines;
}

/** The seller settings (one query, no cache: PDFs are rendered on demand). */
async function loadInvoiceSeller(): Promise<InvoiceSeller> {
  const rows = await client`
    SELECT key, value FROM settings WHERE key = ANY(${SELLER_SETTING_KEYS}::text[])
  `;
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    const { key, value } = row as { key: string; value: unknown };
    settings[key] = value;
  }
  return readInvoiceSeller(settings);
}

/** The billed month of a fleet invoice (period_start YYYY-MM-DD), e.g. "October 2026". */
export function formatPeriod(periodStart: string | null, locale: string): string | null {
  if (periodStart == null) return null;
  const parsed = new Date(`${periodStart.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return periodStart;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parsed);
}

type LineItem = InvoiceDetail['lineItems'][number];

/** A driver's lines on a fleet invoice. */
export interface DriverLineGroup {
  driverId: string | null;
  driverName: string;
  /** The driver's employee number at issue, printed after the name. */
  employeeNumber: string | null;
  items: LineItem[];
  /** Sum of the lines' net amounts. */
  netCents: number;
}

/**
 * The lines of a fleet invoice grouped by the driver in their metadata, in
 * the order the invoice lists them (the invoice is issued grouped by driver).
 */
export function groupLinesByDriver(lineItems: LineItem[]): DriverLineGroup[] {
  const groups: DriverLineGroup[] = [];
  const byKey = new Map<string, DriverLineGroup>();
  for (const item of lineItems) {
    const meta =
      item.metadata != null && typeof item.metadata === 'object'
        ? (item.metadata as Record<string, unknown>)
        : {};
    const driverId = typeof meta['driverId'] === 'string' ? meta['driverId'] : null;
    const driverName = typeof meta['driverName'] === 'string' ? meta['driverName'] : '';
    const employeeNumber =
      typeof meta['employeeNumber'] === 'string' && meta['employeeNumber'] !== ''
        ? meta['employeeNumber']
        : null;
    const key = driverId ?? '';
    let group = byKey.get(key);
    if (group == null) {
      group = { driverId, driverName, employeeNumber, items: [], netCents: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    group.netCents += item.totalCents;
  }
  return groups;
}

function formatDate(value: Date | string | null, locale: string): string {
  if (value == null) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Where the text of the pages goes: the left edge and width of the text, the
 * first y of the text on a page added for the overflow, and the lowest y of
 * the text. Without a letterhead the page margins; with one its layout.
 */
interface PageFrame {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

/** The frame of a letterhead layout (millimetres) in points. */
function letterheadFrame(letterhead: PdfLetterhead): PageFrame {
  const { layout } = letterhead;
  const left = mmToPt(layout.marginLeftMm);
  return {
    left,
    width: PAGE_WIDTH - left - mmToPt(layout.marginRightMm),
    top: mmToPt(PDF_LETTERHEAD_FOLLOWING_TOP_MM),
    bottom: mmToPt(layout.contentBottomMm),
  };
}

/** A table column: x offset from the margin, width, and alignment. */
interface Column {
  x: number;
  width: number;
  align: 'left' | 'right';
}

/** The height drawRow gives a row of these values, in the current font. */
function rowHeight(doc: PDFKit.PDFDocument, columns: Column[], values: string[]): number {
  let height = 0;
  columns.forEach((col, i) => {
    height = Math.max(height, doc.heightOfString(values[i] ?? '', { width: col.width }));
  });
  return Math.max(16, height + 4);
}

function drawRow(
  doc: PDFKit.PDFDocument,
  frame: PageFrame,
  columns: Column[],
  values: string[],
  y: number,
): number {
  columns.forEach((col, i) => {
    doc.text(values[i] ?? '', frame.left + col.x, y, { width: col.width, align: col.align });
  });
  return rowHeight(doc, columns, values);
}

/** Line item rows alternate a light band, starting with the second row. */
export const INVOICE_ROW_BAND_COLOR = '#f5f7fa';

function drawRule(doc: PDFKit.PDFDocument, frame: PageFrame, y: number, fromX = frame.left): void {
  doc
    .moveTo(fromX, y)
    .lineTo(frame.left + frame.width, y)
    .stroke(COLOR_LINE);
}

function ensureSpace(doc: PDFKit.PDFDocument, frame: PageFrame, y: number, needed: number): number {
  if (y + needed > frame.bottom) {
    doc.addPage();
    return frame.top;
  }
  return y;
}

const QR_SIZE = 96;
const QR_GAP = 16;

/** Draws a QR code of the payload as vector modules (error correction M, EPC069-12). */
function drawQrCode(doc: PDFKit.PDFDocument, payload: string, x: number, y: number): void {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const quiet = 2;
  const cell = QR_SIZE / (modules.size + quiet * 2);
  doc.save();
  doc.rect(x, y, QR_SIZE, QR_SIZE).fill('#ffffff');
  doc.fillColor('#000000');
  for (let row = 0; row < modules.size; row++) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col++;
      doc
        .rect(x + (start + quiet) * cell, y + (row + quiet) * cell, (col - start) * cell, cell)
        .fill();
    }
  }
  doc.restore();
}

/**
 * The "Payment information" block below the totals: the heading, the
 * sentence, the label and value rows, and the EPC QR code on the right when
 * there is one. The block does not split across pages.
 */
function drawPaymentBlock(
  doc: PDFKit.PDFDocument,
  frame: PageFrame,
  block: InvoicePaymentBlock,
  labels: InvoiceLabels,
  fonts: { regular: string; bold: string },
  startY: number,
  ensure: (y: number, needed: number) => number,
): void {
  const textWidth = block.qrPayload != null ? frame.width - QR_SIZE - QR_GAP : frame.width;
  const labelWidth = 110;
  doc.fontSize(10).font(fonts.regular);
  const textHeight = doc.heightOfString(block.text, { width: textWidth });
  const rowsHeight = block.rows.reduce(
    (sum, [, value]) =>
      sum + Math.max(14, doc.heightOfString(value, { width: textWidth - labelWidth }) + 2),
    0,
  );
  const qrHeight = block.qrPayload != null ? QR_SIZE + 24 : 0;
  const needed = 16 + Math.max(textHeight + 6 + rowsHeight, qrHeight);
  let y = ensure(startY, needed);
  const top = y;

  drawRule(doc, frame, y - 6);
  doc
    .fontSize(9)
    .font(fonts.bold)
    .fillColor(COLOR_MUTED)
    .text(labels.paymentInformation, frame.left, y, { width: textWidth });
  y += 16;
  doc
    .fontSize(10)
    .font(fonts.regular)
    .fillColor(COLOR_TEXT)
    .text(block.text, frame.left, y, { width: textWidth });
  y += textHeight + 6;
  for (const [label, value] of block.rows) {
    doc
      .fontSize(10)
      .font(fonts.regular)
      .fillColor(COLOR_MUTED)
      .text(label, frame.left, y, { width: labelWidth });
    doc
      .font(fonts.bold)
      .fillColor(COLOR_TEXT)
      .text(value, frame.left + labelWidth, y, { width: textWidth - labelWidth });
    y += Math.max(14, doc.heightOfString(value, { width: textWidth - labelWidth }) + 2);
  }

  if (block.qrPayload != null) {
    const qrX = frame.left + frame.width - QR_SIZE;
    drawQrCode(doc, block.qrPayload, qrX, top);
    doc
      .fontSize(7)
      .font(fonts.regular)
      .fillColor(COLOR_MUTED)
      .text(labels.paymentQrHint, qrX, top + QR_SIZE + 4, { width: QR_SIZE, align: 'center' });
  }
}

/**
 * The letterhead image as the PNG the invoice PDF embeds, or null when it
 * cannot be used: not a valid PNG or SVG, or a PNG pdfkit cannot read. The
 * PDF is then drawn without the letterhead, and an upload is refused.
 */
export function letterheadBackground(letterhead: PdfLetterhead): Buffer | null {
  const png = renderPdfLetterheadBackground(letterhead);
  if (png == null) return null;
  try {
    // A PNG with a valid header can still be unreadable; pdfkit parses it here.
    new PDFDocument({ size: 'A4' }).image(png, 0, 0, { width: 1 });
    return png;
  } catch (err) {
    logger.warn({ err }, 'pdfkit rejected the letterhead image, drawing the PDF without it');
    return null;
  }
}

/** Width of the recipient address in the envelope window (DIN 5008: 85 mm field, 5 mm indent). */
const ADDRESS_WIDTH = mmToPt(80);
/** Where the page header of the pages after the first starts. */
const FOLLOWING_HEADER_Y = mmToPt(12);

/**
 * The first page on a letterhead: the letterhead as the background, the
 * recipient address in the envelope window, and the title with the document
 * number where the text starts. Returns the y below the title.
 */
function drawLetterheadFirstPage(
  doc: PDFKit.PDFDocument,
  letterhead: PdfLetterhead,
  background: Buffer,
  frame: PageFrame,
  fonts: { regular: string; bold: string },
  content: { title: string; addressName: string; addressLines: string[] },
): number {
  doc.image(background, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });

  const x = mmToPt(letterhead.layout.addressLeftMm);
  const addressWidth = Math.min(ADDRESS_WIDTH, PAGE_WIDTH - x - frame.left / 2);
  let y = mmToPt(letterhead.layout.addressTopMm);
  doc.fontSize(10).font(fonts.regular).fillColor(COLOR_TEXT);
  for (const line of [content.addressName, ...content.addressLines]) {
    doc.text(line, x, y, { width: addressWidth });
    y += Math.max(13, doc.heightOfString(line, { width: addressWidth }));
  }

  const top = mmToPt(letterhead.layout.contentTopMm);
  doc
    .fontSize(14)
    .font(fonts.bold)
    .fillColor(COLOR_TEXT)
    .text(content.title, frame.left, top, { width: frame.width });
  return top + doc.heightOfString(content.title, { width: frame.width }) + 12;
}

/**
 * On a letterhead document of two or more pages: "Page 1 of n" above the
 * letterhead's footer on the first page, and a header with the seller, the
 * document and the page on every later page (which has no letterhead). Call
 * it once, right before `doc.end()`.
 */
function drawLetterheadPageMarks(
  doc: PDFKit.PDFDocument,
  frame: PageFrame,
  fonts: { regular: string; bold: string },
  documentLabel: string,
  pageOf: string,
): void {
  const range = doc.bufferedPageRange();
  if (range.count < 2) return;
  const headerFonts = registerPdfTextFonts(doc, fonts, documentLabel);
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const { margins } = doc.page;
    const bottomMargin = margins.bottom;
    // Text below the bottom margin would make pdfkit open a new page.
    margins.bottom = 0;
    const page = pageOf.replace('{page}', String(i + 1)).replace('{pages}', String(range.count));
    doc.fontSize(8).fillColor(COLOR_MUTED);
    if (i === 0) {
      doc.font(fonts.regular).text(page, frame.left, frame.bottom + 6, {
        width: frame.width,
        align: 'right',
      });
    } else {
      doc
        .font(headerFonts.regular)
        .text(`${documentLabel} · ${page}`, frame.left, FOLLOWING_HEADER_Y, {
          width: frame.width,
        });
    }
    margins.bottom = bottomMargin;
  }
}

export interface GenerateInvoicePdfOptions {
  /**
   * The letterhead to draw instead of the one the invoice was issued under
   * (invoices.letterhead_id), e.g. the preview of a letterhead not yet stored.
   * Null draws no letterhead.
   */
  letterhead?: PdfLetterhead | null;
}

export async function generateInvoicePdf(
  detail: InvoiceDetail,
  options: GenerateInvoicePdfOptions = {},
): Promise<Buffer> {
  const { invoice, lineItems, driver, fleet, taxBreakdown, creditedInvoice, creditNote } = detail;
  const isCreditNote = invoice.kind === 'credit_note';
  // A member invoice (and its credit note) bills one driver: its lines are not
  // grouped by driver, and it names the fleet whose account was charged.
  const isMemberInvoice = invoice.fleetId != null && invoice.memberBilled;
  const isFleetInvoice = invoice.fleetId != null && !invoice.memberBilled;
  const language = resolveInvoicePdfLanguage(invoice.language ?? driver?.language);
  const labels: InvoiceLabels = INVOICE_LABELS[language];
  const money = (cents: number): string =>
    formatCurrencyAmount(cents, invoice.currency, labels.locale);
  const rate = (taxRate: number | string): string =>
    labels.taxRateValue.replace('{rate}', formatTaxRatePercent(Number(taxRate), labels.locale));

  const sessionIds = [
    ...new Set(lineItems.flatMap((item) => (item.sessionId != null ? [item.sessionId] : []))),
  ];
  const [seller, branding, payment, evidence, issuedLetterhead] = await Promise.all([
    readStoredInvoiceSeller(invoice.seller) ?? loadInvoiceSeller(),
    loadPdfBranding(invoice.issuerId),
    getInvoicePaymentSettings(),
    loadSessionEvidence(sessionIds),
    options.letterhead !== undefined
      ? options.letterhead
      : invoice.letterheadId != null
        ? loadPdfLetterhead(invoice.letterheadId)
        : null,
  ]);
  const evidenceLabels = INVOICE_EVIDENCE_LABELS[language];
  // A letterhead whose image cannot be used draws the PDF without it.
  const background = issuedLetterhead != null ? letterheadBackground(issuedLetterhead) : null;
  const letterhead = background != null ? issuedLetterhead : null;
  const letterheadPageFrame = letterhead != null ? letterheadFrame(letterhead) : null;

  const doc = new PDFDocument({
    margins:
      letterheadPageFrame != null
        ? {
            top: letterheadPageFrame.top,
            left: letterheadPageFrame.left,
            right: PAGE_WIDTH - letterheadPageFrame.left - letterheadPageFrame.width,
            bottom: PAGE_HEIGHT - letterheadPageFrame.bottom,
          }
        : { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN },
    size: 'A4',
    layout: 'portrait',
    bufferPages: true,
  });
  const fonts = registerPdfFonts(doc, language);
  // A letterhead carries its own footer.
  const footer = layoutPdfFooter(doc, letterhead != null ? '' : branding.footer, CONTENT_WIDTH);
  const frame: PageFrame = letterheadPageFrame ?? {
    left: MARGIN,
    width: CONTENT_WIDTH,
    top: MARGIN,
    // A footer taller than the bottom margin moves the content limit up.
    bottom: PAGE_BOTTOM - (reservePdfFooterSpace(doc, footer, MARGIN) - MARGIN),
  };
  const ensure = (y: number, needed: number): number => ensureSpace(doc, frame, y, needed);
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

  const billTo = readBillTo(invoice.billTo);
  // The employee number: kept on a member invoice at issue, read from the
  // driver on a driver invoice (as its name and email); printed when set.
  const employeeNumber =
    billTo != null
      ? billTo.employeeNumber
      : driver?.employeeNumber != null && driver.employeeNumber.trim() !== ''
        ? driver.employeeNumber.trim()
        : null;
  const employeeNumberLine =
    employeeNumber != null ? [labels.employeeNumber.replace('{id}', employeeNumber)] : [];
  const documentTitle = isCreditNote ? labels.creditNoteTitle : labels.title;
  let y: number;
  if (letterhead != null && background != null) {
    // The letterhead holds the logo and the seller; the recipient goes into
    // the envelope window, the fleet and tax ID below the title.
    const addressName =
      billTo?.name ?? (driver != null ? `${driver.firstName} ${driver.lastName}`.trim() : '—');
    const fallbackEmail = billTo != null ? billTo.email : (driver?.email ?? null);
    const addressLines =
      billTo != null && billTo.address.length > 0
        ? billTo.address
        : fallbackEmail != null && fallbackEmail !== ''
          ? [fallbackEmail]
          : [];
    y = drawLetterheadFirstPage(doc, letterhead, background, frame, fonts, {
      title: `${documentTitle} ${invoice.invoiceNumber}`,
      addressName,
      addressLines,
    });
    const recipientLines = [
      ...employeeNumberLine,
      ...(billTo?.taxId != null ? [labels.taxId.replace('{id}', billTo.taxId)] : []),
      ...(isMemberInvoice && fleet != null ? [labels.viaFleet.replace('{fleet}', fleet.name)] : []),
    ];
    for (const line of recipientLines) {
      doc.fontSize(10).font(fonts.regular).fillColor(COLOR_MUTED).text(line, frame.left, y, {
        width: frame.width,
      });
      y += 14;
    }
    if (recipientLines.length > 0) y += 6;
  } else {
    // Header: the PDF logo on the left, invoice meta on the right.
    try {
      doc.image(branding.logo, MARGIN, MARGIN, { fit: [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT] });
    } catch (err) {
      logger.warn({ err }, 'pdfkit rejected the PDF logo, using the default logo');
      doc.image(defaultPdfLogoPng(), MARGIN, MARGIN, { fit: [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT] });
    }
    const headerBottom = MARGIN + LOGO_MAX_HEIGHT;

    doc
      .fontSize(20)
      .font(fonts.bold)
      .fillColor(COLOR_TEXT)
      .text(isCreditNote ? labels.creditNoteTitle : labels.title, MARGIN, MARGIN, {
        width: CONTENT_WIDTH,
        align: 'right',
      });
    doc
      .fontSize(11)
      .font(fonts.regular)
      .fillColor(COLOR_MUTED)
      .text(invoice.invoiceNumber, MARGIN, MARGIN + 26, { width: CONTENT_WIDTH, align: 'right' });

    y = Math.max(headerBottom, MARGIN + 50) + 20;
    drawRule(doc, frame, y);
    y += 20;

    // Meta block: billed-to driver (or the fleet's bill-to block) and the issuing company.
    const rightX = MARGIN + CONTENT_WIDTH / 2;
    const billedToName =
      billTo?.name ?? (driver != null ? `${driver.firstName} ${driver.lastName}`.trim() : '—');
    const billedToDetails = [
      ...employeeNumberLine,
      ...(billTo != null
        ? [
            ...billTo.lines,
            ...(billTo.taxId != null ? [labels.taxId.replace('{id}', billTo.taxId)] : []),
          ]
        : driver?.email != null && driver.email !== ''
          ? [driver.email]
          : []),
    ];
    if (isMemberInvoice && fleet != null) {
      billedToDetails.push(labels.viaFleet.replace('{fleet}', fleet.name));
    }

    doc.fontSize(9).font(fonts.bold).fillColor(COLOR_MUTED).text(labels.billedTo, MARGIN, y);
    doc
      .fontSize(11)
      .font(fonts.regular)
      .fillColor(COLOR_TEXT)
      .text(billedToName, MARGIN, y + 12, { width: CONTENT_WIDTH / 2 - 10 });
    let detailY = y + 27;
    for (const detailLine of billedToDetails) {
      doc
        .fontSize(10)
        .fillColor(COLOR_MUTED)
        .text(detailLine, MARGIN, detailY, { width: CONTENT_WIDTH / 2 - 10 });
      detailY += 14;
    }

    // The seller: name, address, tax ID, registration number and contact. The
    // operator's text can hold characters the document font lacks.
    const sellerLines = sellerDetailLines(seller, labels);
    const sellerFonts = registerPdfTextFonts(doc, fonts, [seller.name, ...sellerLines].join('\n'));
    const sellerWidth = CONTENT_WIDTH / 2;
    doc.fontSize(9).font(fonts.bold).fillColor(COLOR_MUTED).text(labels.from, rightX, y);
    doc
      .fontSize(11)
      .font(sellerFonts.regular)
      .fillColor(COLOR_TEXT)
      .text(seller.name, rightX, y + 12, { width: sellerWidth });
    let sellerY = y + 12 + Math.max(15, doc.heightOfString(seller.name, { width: sellerWidth }));
    doc.fontSize(10).fillColor(COLOR_MUTED);
    for (const sellerLine of sellerLines) {
      doc.text(sellerLine, rightX, sellerY, { width: sellerWidth });
      sellerY += Math.max(14, doc.heightOfString(sellerLine, { width: sellerWidth }));
    }

    y = Math.max(y + 50, detailY + 10, sellerY + 10);
  }

  const metaRows: Array<[string, string]> = [
    [labels.status, labels.statuses[invoice.status]],
    [labels.issued, formatDate(invoice.issuedAt, labels.locale)],
  ];
  const period = formatPeriod(invoice.periodStart, labels.locale);
  if (period != null) metaRows.push([labels.period, period]);
  // A credit note has no due date; it names the invoice it credits and why.
  if (isCreditNote) {
    metaRows.push([labels.creditsInvoice, creditedInvoice?.invoiceNumber ?? '—']);
    if (invoice.creditReason != null) metaRows.push([labels.reason, invoice.creditReason]);
  } else {
    metaRows.push([labels.due, formatDate(invoice.dueAt, labels.locale)]);
  }
  if (creditNote != null) metaRows.push([labels.creditedBy, creditNote.invoiceNumber]);
  for (const [label, value] of metaRows) {
    doc.fontSize(10).font(fonts.regular).fillColor(COLOR_MUTED).text(label, frame.left, y, {
      width: 120,
    });
    doc
      .fontSize(10)
      .font(fonts.bold)
      .fillColor(COLOR_TEXT)
      .text(value, frame.left + 120, y, { width: frame.width - 120 });
    y += Math.max(16, doc.heightOfString(value, { width: frame.width - 120 }) + 4);
  }

  y += 14;

  // Line items: description, quantity, net unit price, tax rate, net amount.
  const itemColumns: Column[] = [
    { x: 0, width: 205, align: 'left' },
    { x: 210, width: 35, align: 'right' },
    { x: 250, width: 80, align: 'right' },
    { x: 335, width: 60, align: 'right' },
    { x: 400, width: frame.width - 400, align: 'right' },
  ];
  doc.fontSize(9).font(fonts.bold).fillColor(COLOR_MUTED);
  y += drawRow(
    doc,
    frame,
    itemColumns,
    [labels.description, labels.quantity, labels.unitPrice, labels.taxRate, labels.amount],
    y,
  );
  drawRule(doc, frame, y - 4);

  const drawItem = (item: LineItem, index: number): void => {
    y = ensure(y, 30);
    const qty = Number(item.quantity);
    const values = [
      describeLineItem(labels, item.description, item.metadata),
      Number.isNaN(qty) ? item.quantity : qty.toString(),
      money(item.unitPriceCents),
      rate(item.taxRate),
      money(item.totalCents),
    ];
    doc.font(fonts.regular).fontSize(10);
    if (index % 2 === 1) {
      // The band spans the row's text plus half the row gap above and below.
      doc
        .rect(frame.left - 4, y - 2, frame.width + 8, rowHeight(doc, itemColumns, values))
        .fill(INVOICE_ROW_BAND_COLOR);
    }
    doc.fillColor(COLOR_TEXT);
    y += drawRow(doc, frame, itemColumns, values, y);
  };

  // The check line under a session's last line: the session id, and the
  // signed begin and end readings when the station signed its meter data.
  const drawSessionEvidence = (sessionId: string): void => {
    const text = sessionEvidenceLine(
      evidenceLabels,
      labels.locale,
      sessionId,
      evidence.get(sessionId),
    );
    doc.font(fonts.regular).fontSize(7).fillColor(COLOR_MUTED);
    const height = doc.heightOfString(text, { width: frame.width });
    y = ensure(y - 3, height + 4);
    doc.text(text, frame.left, y, { width: frame.width });
    y += height + 4;
  };

  const drawItems = (items: LineItem[]): void => {
    items.forEach((item, i) => {
      drawItem(item, i);
      if (item.sessionId != null && items[i + 1]?.sessionId !== item.sessionId) {
        drawSessionEvidence(item.sessionId);
      }
    });
  };

  if (isFleetInvoice) {
    // A fleet invoice lists each driver's sessions under the driver, with a
    // net subtotal per driver; the tax summary below covers the whole invoice.
    for (const group of groupLinesByDriver(lineItems)) {
      y = ensure(y, 50);
      const driverName = group.driverName !== '' ? group.driverName : labels.unknownDriver;
      const name =
        group.employeeNumber != null
          ? `${driverName} · ${labels.employeeNumber.replace('{id}', group.employeeNumber)}`
          : driverName;
      doc.font(fonts.bold).fontSize(10).fillColor(COLOR_TEXT).text(name, frame.left, y, {
        width: frame.width,
      });
      y += 16;
      drawItems(group.items);
      y = ensure(y, 20);
      drawRule(doc, frame, y - 2, frame.left + frame.width / 2);
      doc.font(fonts.bold).fontSize(10).fillColor(COLOR_TEXT);
      y += drawRow(
        doc,
        frame,
        itemColumns,
        [labels.driverSubtotal.replace('{driver}', name), '', '', '', money(group.netCents)],
        y,
      );
      y += 6;
    }
  } else {
    drawItems(lineItems);
  }

  if (evidence.size > 0) {
    doc.font(fonts.regular).fontSize(7).fillColor(COLOR_MUTED);
    const height = doc.heightOfString(evidenceLabels.note, { width: frame.width });
    y = ensure(y + 4, height + 4);
    doc.text(evidenceLabels.note, frame.left, y, { width: frame.width });
    y += height + 4;
  }

  y += 10;

  // Tax summary: net amount, tax rate, and tax amount per rate. Must not
  // split across pages.
  const summaryColumns: Column[] = [
    { x: 0, width: 120, align: 'left' },
    { x: 125, width: 120, align: 'right' },
    { x: 250, width: 120, align: 'right' },
    { x: 375, width: frame.width - 375, align: 'right' },
  ];
  y = ensure(y, 30 + taxBreakdown.length * 16);
  doc.fontSize(9).font(fonts.bold).fillColor(COLOR_MUTED).text(labels.taxSummary, frame.left, y);
  y += 16;
  y += drawRow(
    doc,
    frame,
    summaryColumns,
    [labels.taxRate, labels.netAmount, labels.tax, labels.grossAmount],
    y,
  );
  drawRule(doc, frame, y - 4);
  doc.font(fonts.regular).fontSize(10).fillColor(COLOR_TEXT);
  for (const line of taxBreakdown) {
    y += drawRow(
      doc,
      frame,
      summaryColumns,
      [rate(line.taxRate), money(line.netCents), money(line.taxCents), money(line.grossCents)],
      y,
    );
  }

  y += 10;

  // Totals block (divider + net subtotal + tax + total) must not split across pages.
  y = ensure(y, 10 + 16 + 16 + 20 + 20);
  drawRule(doc, frame, y, frame.left + frame.width / 2);
  y += 10;

  const totalsX = frame.left + frame.width / 2;
  const amountCol = itemColumns[4] ?? { x: 400, width: frame.width - 400, align: 'right' };
  const totalsLabelWidth = frame.width / 2 - amountCol.width;
  const totalRows: Array<[string, string, boolean]> = [
    [labels.subtotal, money(invoice.subtotalCents), false],
    [labels.totalTax, money(invoice.taxCents), false],
    [labels.total, money(invoice.totalCents), true],
  ];
  for (const [label, value, bold] of totalRows) {
    doc
      .fontSize(bold ? 12 : 10)
      .font(bold ? fonts.bold : fonts.regular)
      .fillColor(bold ? COLOR_TEXT : COLOR_MUTED)
      .text(label, totalsX, y, { width: totalsLabelWidth });
    doc
      .fontSize(bold ? 12 : 10)
      .font(bold ? fonts.bold : fonts.regular)
      .fillColor(COLOR_TEXT)
      .text(value, frame.left + amountCol.x, y, { width: amountCol.width, align: 'right' });
    y += bold ? 20 : 16;
  }

  doc
    .fontSize(8)
    .font(fonts.regular)
    .fillColor(COLOR_MUTED)
    .text(labels.amountsNote, frame.left, y + 4, { width: frame.width });
  y += 16;
  if (isCreditNote && creditedInvoice?.paidAt != null) {
    y = ensure(y, 24);
    doc.text(labels.creditNotePaidNote, frame.left, y, { width: frame.width });
    y += Math.max(12, doc.heightOfString(labels.creditNotePaidNote, { width: frame.width }));
  }

  const paymentBlock = invoicePaymentBlock({
    invoice,
    labels,
    payment,
    sellerName: seller.name,
    formatDate: (value) => formatDate(value, labels.locale),
  });
  if (paymentBlock != null) {
    const blockFonts = registerPdfTextFonts(
      doc,
      fonts,
      [paymentBlock.text, ...paymentBlock.rows.map(([, value]) => value)].join('\n'),
    );
    drawPaymentBlock(doc, frame, paymentBlock, labels, blockFonts, y + 14, ensure);
  }

  if (letterhead != null) {
    drawLetterheadPageMarks(
      doc,
      frame,
      fonts,
      `${seller.name} · ${documentTitle} ${invoice.invoiceNumber}`,
      labels.pageOf,
    );
  }
  drawPdfFooter(doc, footer, MARGIN, CONTENT_WIDTH);
  doc.end();
  return built;
}

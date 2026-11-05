// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn, letterheadRows } = vi.hoisted(() => ({
  warn: vi.fn(),
  letterheadRows: { rows: [] as unknown[] },
}));

vi.mock('@evtivity/database', () => ({
  // Settings queries (seller, branding) find no rows; the letterhead query
  // returns letterheadRows.
  client: vi.fn((strings: TemplateStringsArray) =>
    Promise.resolve(strings.join('').includes('pdf_letterheads') ? letterheadRows.rows : []),
  ),
  getInvoicePaymentSettings: vi.fn(() =>
    Promise.resolve({
      accountHolder: null,
      iban: null,
      bic: null,
      bankName: null,
      epcQrEnabled: true,
    }),
  ),
  getCompanyCurrency: vi.fn(() => Promise.resolve('EUR')),
}));

vi.mock('@evtivity/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evtivity/lib')>()),
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { DEFAULT_PDF_LETTERHEAD_LAYOUT } from '@evtivity/lib';
import { generateInvoicePdf, letterheadBackground } from '../invoice-pdf.service.js';
import {
  clearPdfLetterheadCache,
  loadPdfLetterhead,
  mmToPt,
  renderPdfLetterheadBackground,
} from '../invoice-letterhead.js';
import type { PdfLetterhead } from '../invoice-letterhead.js';
import {
  generatePdfLetterheadPreview,
  letterheadPreviewDetail,
} from '../invoice-letterhead-preview.js';
import type { InvoiceDetail } from '../invoice.service.js';

/** Uncompressed page content streams, one per page in drawing order. */
function pageStreams(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const pages: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let data = Buffer.from(m[1] ?? '', 'latin1');
    try {
      data = inflateSync(data);
    } catch {
      // not compressed
    }
    const content = data.toString('latin1');
    if (content.includes(' Tf') || content.includes(' Do')) pages.push(content);
  }
  return pages;
}

/** Text of a content stream, decoded as WinAnsi (latin1) bytes. */
function streamText(content: string): string {
  return [...content.matchAll(/<([0-9a-fA-F]*)>/g)]
    .map((t) => Buffer.from(t[1] ?? '', 'hex').toString('latin1'))
    .join('');
}

function pdfText(pdf: Buffer): string {
  return pageStreams(pdf).map(streamText).join('');
}

/** Image XObjects of the PDF with their pixel size. */
function pdfImages(pdf: Buffer): Array<{ width: number; height: number }> {
  const raw = pdf.toString('latin1');
  return [...raw.matchAll(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)/g)].map(
    (m) => ({ width: Number(m[1]), height: Number(m[2]) }),
  );
}

/** An A4 page drawn at 1240 px width (150 dpi) as the letterhead image. */
function letterheadPng(): Buffer {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect width="210" height="297" fill="#fff"/><rect x="150" y="10" width="50" height="20" fill="#e4007c"/></svg>';
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1240 } }).render().asPng());
}

function letterhead(image = letterheadPng()): PdfLetterhead {
  return {
    image: `data:image/png;base64,${image.toString('base64')}`,
    imageSha256: createHash('sha256').update(image).digest('hex'),
    layout: { ...DEFAULT_PDF_LETTERHEAD_LAYOUT },
  };
}

const now = new Date('2026-11-02T09:00:00Z');

function line(id: number, totalCents: number): InvoiceDetail['lineItems'][number] {
  return {
    id,
    invoiceId: 'inv_m1',
    sessionId: `ses_${String(id)}`,
    paymentRecordId: null,
    description: 'Charging session',
    quantity: '1',
    unitPriceCents: totalCents,
    totalCents,
    taxCents: Math.round(totalCents * 0.19),
    taxRate: '0.19',
    metadata: { kind: 'session', sessionDate: '2026-10-10', energyWh: 12000 },
    createdAt: now,
  };
}

function memberDetail(lines = 2): InvoiceDetail {
  const lineItems = Array.from({ length: lines }, (_, i) => line(i + 1, 500));
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.totalCents, 0);
  const taxCents = lineItems.reduce((sum, item) => sum + item.taxCents, 0);
  return {
    invoice: {
      id: 'inv_m1',
      invoiceNumber: 'RI-2600001',
      driverId: 'drv_a',
      status: 'issued',
      kind: 'invoice',
      memberBilled: true,
      creditedInvoiceId: null,
      creditReason: null,
      paidAt: null,
      paymentReference: null,
      letterheadId: null,
      fleetId: 'flt_1',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      billTo: {
        name: 'Anna Berg',
        street: 'Lindenweg 3',
        zip: '28195',
        city: 'Bremen',
        state: null,
        country: 'Deutschland',
        taxId: 'DE123456789',
        email: 'anna@fleet.test',
      },
      language: 'en',
      sentAt: null,
      overdueNoticeSentAt: null,
      issuedAt: now,
      dueAt: now,
      currency: 'EUR',
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    },
    lineItems,
    driver: {
      id: 'drv_a',
      firstName: 'Anna',
      lastName: 'Berg',
      email: 'anna@fleet.test',
      language: 'en',
    },
    fleet: { id: 'flt_1', name: 'Staff' },
    taxBreakdown: [{ taxRate: 0.19, netCents: subtotalCents, taxCents, grossCents: 0 }],
    creditedInvoice: null,
    creditNote: null,
  };
}

beforeEach(() => {
  clearPdfLetterheadCache();
  letterheadRows.rows = [];
  warn.mockClear();
});

describe('renderPdfLetterheadBackground', () => {
  it('embeds a PNG as stored and renders it once per image', () => {
    const png = letterheadPng();
    const first = renderPdfLetterheadBackground(letterhead(png));
    expect(first?.equals(png)).toBe(true);
    expect(renderPdfLetterheadBackground(letterhead(png))).toBe(first);
  });

  it('rasterizes an SVG at 300 dpi', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect width="210" height="297" fill="#fff"/></svg>';
    const png = renderPdfLetterheadBackground({
      image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      imageSha256: 'svg',
      layout: { ...DEFAULT_PDF_LETTERHEAD_LAYOUT },
    });
    expect(png?.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png?.readUInt32BE(16)).toBe(2480);
  });

  it('returns null for an image that cannot be used', () => {
    expect(
      renderPdfLetterheadBackground({
        image: 'data:text/plain,hello',
        imageSha256: 'bad',
        layout: { ...DEFAULT_PDF_LETTERHEAD_LAYOUT },
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('letterheadBackground', () => {
  it('returns the PNG pdfkit can read', () => {
    const png = letterheadPng();
    expect(letterheadBackground(letterhead(png))?.equals(png)).toBe(true);
  });

  it('returns null for a PNG pdfkit cannot read', () => {
    const header = letterheadPng().subarray(0, 40);
    expect(
      letterheadBackground({
        image: `data:image/png;base64,${header.toString('base64')}`,
        imageSha256: 'truncated',
        layout: { ...DEFAULT_PDF_LETTERHEAD_LAYOUT },
      }),
    ).toBeNull();
  });
});

describe('loadPdfLetterhead', () => {
  it('reads the version with its layout as numbers', async () => {
    letterheadRows.rows = [
      {
        image: 'data:image/png;base64,AAAA',
        image_sha256: 'abc',
        address_left_mm: '22.9',
        address_top_mm: '53.6',
        content_top_mm: '100.0',
        content_bottom_mm: '255.0',
        margin_left_mm: '15.0',
        margin_right_mm: '15.0',
      },
    ];
    await expect(loadPdfLetterhead('lhd_1')).resolves.toEqual({
      image: 'data:image/png;base64,AAAA',
      imageSha256: 'abc',
      layout: {
        addressLeftMm: 22.9,
        addressTopMm: 53.6,
        contentTopMm: 100,
        contentBottomMm: 255,
        marginLeftMm: 15,
        marginRightMm: 15,
      },
    });
  });

  it('returns null for an unknown version', async () => {
    await expect(loadPdfLetterhead('lhd_missing')).resolves.toBeNull();
  });
});

describe('generateInvoicePdf on a letterhead', () => {
  it('draws the letterhead instead of the logo, the seller block and the footer', async () => {
    const pdf = await generateInvoicePdf(memberDetail(), { letterhead: letterhead() });
    const text = pdfText(pdf);
    expect(text).toContain('INVOICE RI-2600001');
    expect(text).toContain('Anna Berg');
    expect(text).toContain('28195 Bremen');
    expect(text).toContain('VAT ID: DE123456789');
    expect(text).toContain('Charged on account of Staff');
    expect(text).not.toContain('BILLED TO');
    expect(text).not.toContain('FROM');
    expect(text).not.toContain('www.evtivity.com');
    expect(text).not.toContain('anna@fleet.test');
    expect(text).not.toContain('Page 1 of');
    // The letterhead is the only image: no PDF logo.
    expect(pdfImages(pdf)).toEqual([{ width: 1240, height: 1754 }]);
  });

  it('draws the letterhead full page, below the text', async () => {
    const pdf = await generateInvoicePdf(memberDetail(), { letterhead: letterhead() });
    const [first] = pageStreams(pdf);
    // pdfkit draws an image as "w 0 0 -h x y cm /Im Do"; the background comes first.
    expect(first).toMatch(/^[\s\S]*?595\.28 0 0 -841\.89 0 841\.89 cm\s*\/I\w+ Do/);
    expect(first?.indexOf(' Do')).toBeLessThan(first?.indexOf(' Tf') ?? 0);
  });

  it('puts the address at the layout position and the text between the margins', async () => {
    const layout = {
      ...DEFAULT_PDF_LETTERHEAD_LAYOUT,
      addressLeftMm: 22.9,
      marginLeftMm: 15,
      marginRightMm: 15,
    };
    const pdf = await generateInvoicePdf(memberDetail(), {
      letterhead: { ...letterhead(), layout },
    });
    const [first] = pageStreams(pdf);
    // pdfkit positions text with "1 0 0 1 x y Tm".
    const at = (mm: number): string => `1 0 0 1 ${String(Math.floor(mmToPt(mm) * 100) / 100)}`;
    expect(first).toContain(at(22.9));
    expect(first).toContain(at(15));
  });

  it('numbers the pages and heads the later pages with the seller and the number', async () => {
    const pdf = await generateInvoicePdf(memberDetail(40), { letterhead: letterhead() });
    const pages = pageStreams(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const total = pages.length;
    expect(streamText(pages[0] ?? '')).toContain(`Page 1 of ${String(total)}`);
    expect(streamText(pages[1] ?? '')).toContain(
      `EVtivity · INVOICE RI-2600001 · Page 2 of ${String(total)}`,
    );
    // The later pages have no letterhead.
    expect(pages.slice(1).some((page) => page.includes(' Do'))).toBe(false);
  });

  it('loads the version the invoice was issued under', async () => {
    const lh = letterhead();
    letterheadRows.rows = [
      {
        image: lh.image,
        image_sha256: lh.imageSha256,
        address_left_mm: '25.0',
        address_top_mm: '62.7',
        content_top_mm: '105.0',
        content_bottom_mm: '250.0',
        margin_left_mm: '25.0',
        margin_right_mm: '20.0',
      },
    ];
    const detail = memberDetail();
    detail.invoice.letterheadId = 'lhd_1';
    const text = pdfText(await generateInvoicePdf(detail));
    expect(text).toContain('INVOICE RI-2600001');
    expect(text).not.toContain('BILLED TO');
  });

  it('draws the PDF without the letterhead when its image cannot be used', async () => {
    const text = pdfText(
      await generateInvoicePdf(memberDetail(), {
        letterhead: { ...letterhead(), image: 'data:text/plain,x', imageSha256: 'bad' },
      }),
    );
    expect(text).toContain('BILLED TO');
    expect(text).toContain('www.evtivity.com');
  });

  it('keeps the standard layout without a letterhead', async () => {
    const text = pdfText(await generateInvoicePdf(memberDetail()));
    expect(text).toContain('BILLED TO');
    expect(text).toContain('FROM');
    expect(text).toContain('www.evtivity.com');
    expect(text).not.toContain('Page 1 of');
  });
});

describe('generatePdfLetterheadPreview', () => {
  it('renders a sample invoice of two pages on the letterhead', async () => {
    const pdf = await generatePdfLetterheadPreview(letterhead(), 'de');
    const pages = pageStreams(pdf);
    expect(pages.length).toBe(2);
    const text = pdfText(pdf);
    expect(text).toContain('Alex Example');
    expect(text).toContain('Seite 1 von 2');
    expect(text).toContain('Seite 2 von 2');
  });

  it('builds the sample in the given currency without storing anything', () => {
    const detail = letterheadPreviewDetail('en', 'CHF', now);
    expect(detail.invoice.currency).toBe('CHF');
    expect(detail.invoice.letterheadId).toBeNull();
    expect(detail.invoice.totalCents).toBe(
      detail.lineItems.reduce((sum, item) => sum + item.totalCents + item.taxCents, 0),
    );
  });
});

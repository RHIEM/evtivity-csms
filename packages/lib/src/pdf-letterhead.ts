// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * PDF letterheads (stationery): an A4 image drawn as the background of the
 * first page of an invoice or credit note, with the free areas the invoice
 * text goes into. A letterhead is a version that never changes; a new upload
 * is a new version and `pdf.letterhead` names the current one. An invoice
 * keeps the version it was issued under (invoices.letterhead_id).
 * Browser-safe, so the CSMS imports it via `@evtivity/lib/pdf-letterhead`.
 * The image checks live in `pdf-letterhead-image.ts` (server).
 */

/** The current letterhead version's id; empty (or no row) means none. */
export const PDF_LETTERHEAD_KEY = 'pdf.letterhead';

/** Largest letterhead image accepted, in bytes (the decoded PNG or SVG). */
export const MAX_PDF_LETTERHEAD_BYTES = 2 * 1024 * 1024;
/** Least width in pixels of a PNG letterhead: 150 dpi on A4. */
export const MIN_PDF_LETTERHEAD_PNG_WIDTH = 1240;
/** Longest version name accepted. */
export const MAX_PDF_LETTERHEAD_NAME_LENGTH = 100;

/** A4 portrait, the page every letterhead covers. */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
/** Largest deviation of the image's aspect ratio from A4 portrait. */
export const PDF_LETTERHEAD_ASPECT_TOLERANCE = 0.01;

/** Least width of the text between the side margins: the line item table needs it. */
export const MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM = 160;
/** Where the text starts on the pages after the first, which have no letterhead. */
export const PDF_LETTERHEAD_FOLLOWING_TOP_MM = 25;

/**
 * The free areas of a letterhead, in millimetres from the top left corner of
 * the page: where the recipient address starts (the window of an envelope),
 * where the text of the first page starts and where the text of every page
 * ends, and the side margins of the text.
 */
export interface PdfLetterheadLayout {
  addressLeftMm: number;
  addressTopMm: number;
  contentTopMm: number;
  contentBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
}

/**
 * DIN 5008 form B: the address zone of the address field starts 25 mm from
 * the left and 62.7 mm from the top (below the 17.7 mm note zone that holds
 * the return address), the text below the folding mark at 105 mm.
 */
export const DEFAULT_PDF_LETTERHEAD_LAYOUT: Readonly<PdfLetterheadLayout> = {
  addressLeftMm: 25,
  addressTopMm: 62.7,
  contentTopMm: 105,
  contentBottomMm: 250,
  marginLeftMm: 25,
  marginRightMm: 20,
};

export const PDF_LETTERHEAD_LAYOUT_KEYS = [
  'addressLeftMm',
  'addressTopMm',
  'contentTopMm',
  'contentBottomMm',
  'marginLeftMm',
  'marginRightMm',
] as const satisfies ReadonlyArray<keyof PdfLetterheadLayout>;

/** The range each value may take, in millimetres. */
export const PDF_LETTERHEAD_LAYOUT_RANGES: Readonly<
  Record<keyof PdfLetterheadLayout, { min: number; max: number }>
> = {
  addressLeftMm: { min: 0, max: 120 },
  addressTopMm: { min: 0, max: 200 },
  contentTopMm: { min: 10, max: 250 },
  contentBottomMm: { min: 60, max: 292 },
  marginLeftMm: { min: 5, max: 50 },
  marginRightMm: { min: 5, max: 50 },
};

/** Least height of the text area of the first page. */
export const MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM = 40;

/** A value rounded to a tenth of a millimetre. */
function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The layout as stored: each value rounded to a tenth of a millimetre. Null
 * when a value is missing or not a finite number, lies outside its range, the
 * first page leaves less than MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM for text,
 * or the side margins leave less than MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM.
 */
export function normalizePdfLetterheadLayout(value: unknown): PdfLetterheadLayout | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const layout = {} as PdfLetterheadLayout;
  for (const key of PDF_LETTERHEAD_LAYOUT_KEYS) {
    const raw = record[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const mm = roundMm(raw);
    const range = PDF_LETTERHEAD_LAYOUT_RANGES[key];
    if (mm < range.min || mm > range.max) return null;
    layout[key] = mm;
  }
  if (layout.contentBottomMm - layout.contentTopMm < MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM) {
    return null;
  }
  if (A4_WIDTH_MM - layout.marginLeftMm - layout.marginRightMm < MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM) {
    return null;
  }
  return layout;
}

/** The version name as stored (trimmed), or null when it is empty or too long. */
export function normalizePdfLetterheadName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name === '' || name.length > MAX_PDF_LETTERHEAD_NAME_LENGTH) return null;
  return name;
}

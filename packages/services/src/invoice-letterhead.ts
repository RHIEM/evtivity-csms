// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { Resvg } from '@resvg/resvg-js';
import { client } from '@evtivity/database';
import { createLogger, decodePdfLetterheadImage } from '@evtivity/lib';
import type { PdfLetterheadLayout } from '@evtivity/lib';

const logger = createLogger('invoice-letterhead');

/** Points per millimetre (PDF user space). */
export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

/** Width in pixels an SVG letterhead is rasterized to: 300 dpi on A4. */
const SVG_RENDER_WIDTH = 2480;
/** Rendered letterheads kept per process; versions never change, so no expiry. */
const MAX_CACHED_BACKGROUNDS = 8;

/** A letterhead version as the invoice PDF draws it. */
export interface PdfLetterhead {
  /** A PNG or SVG data URI of the whole A4 page. */
  image: string;
  /** SHA-256 of the image bytes: the render cache key. */
  imageSha256: string;
  layout: PdfLetterheadLayout;
}

const backgrounds = new Map<string, Buffer>();

/** Clears the render cache (tests). */
export function clearPdfLetterheadCache(): void {
  backgrounds.clear();
}

/**
 * The letterhead image as PNG bytes pdfkit embeds: a PNG as stored, an SVG
 * rasterized at 300 dpi. Rendered once per image (the cache key is its
 * SHA-256). Null when the image is not a valid PNG or SVG. Whether pdfkit
 * can read it is checked by `letterheadBackground` (invoice-pdf.service).
 */
export function renderPdfLetterheadBackground(letterhead: PdfLetterhead): Buffer | null {
  const cached = backgrounds.get(letterhead.imageSha256);
  if (cached != null) return cached;
  const decoded = decodePdfLetterheadImage(letterhead.image);
  let png: Buffer | null = null;
  if (decoded?.kind === 'png') {
    png = decoded.data;
  } else if (decoded?.kind === 'svg') {
    try {
      const resvg = new Resvg(decoded.svg, { fitTo: { mode: 'width', value: SVG_RENDER_WIDTH } });
      png = Buffer.from(resvg.render().asPng());
    } catch (err) {
      logger.warn({ err }, 'Failed to render the letterhead SVG, drawing the PDF without it');
      return null;
    }
  }
  if (png == null) {
    logger.warn('The letterhead is not a valid PNG or SVG, drawing the PDF without it');
    return null;
  }
  if (backgrounds.size >= MAX_CACHED_BACKGROUNDS) {
    const oldest = backgrounds.keys().next().value;
    if (oldest != null) backgrounds.delete(oldest);
  }
  backgrounds.set(letterhead.imageSha256, png);
  return png;
}

interface LetterheadRow {
  image: string;
  image_sha256: string;
  address_left_mm: string | number;
  address_top_mm: string | number;
  content_top_mm: string | number;
  content_bottom_mm: string | number;
  margin_left_mm: string | number;
  margin_right_mm: string | number;
}

/** A letterhead version by id (the one an invoice was issued under), or null. */
export async function loadPdfLetterhead(id: string): Promise<PdfLetterhead | null> {
  const [row] = await client<LetterheadRow[]>`
    SELECT image, image_sha256, address_left_mm, address_top_mm, content_top_mm,
           content_bottom_mm, margin_left_mm, margin_right_mm
    FROM pdf_letterheads WHERE id = ${id}
  `;
  if (row == null) return null;
  return {
    image: row.image,
    imageSha256: row.image_sha256,
    layout: {
      addressLeftMm: Number(row.address_left_mm),
      addressTopMm: Number(row.address_top_mm),
      contentTopMm: Number(row.content_top_mm),
      contentBottomMm: Number(row.content_bottom_mm),
      marginLeftMm: Number(row.margin_left_mm),
      marginRightMm: Number(row.margin_right_mm),
    },
  };
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The image of a PDF letterhead version: validation of an uploaded PNG or SVG
 * data URI (format, size, A4 portrait aspect ratio, resolution) and the value
 * stored. Server-side (the API on upload, the PDF generator on render).
 */

import { createHash } from 'node:crypto';
import { decodePdfLogo } from './pdf-logo.js';
import type { DecodedPdfLogo } from './pdf-logo.js';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  MAX_PDF_LETTERHEAD_BYTES,
  MIN_PDF_LETTERHEAD_PNG_WIDTH,
  PDF_LETTERHEAD_ASPECT_TOLERANCE,
} from './pdf-letterhead.js';

/** Why an upload was rejected: not a PNG or SVG, too large, not A4 portrait, too coarse. */
export type PdfLetterheadImageError = 'format' | 'size' | 'aspect' | 'resolution';

export interface NormalizedPdfLetterheadImage {
  /** Base64 data URI of the PNG or of the sanitized SVG. */
  dataUri: string;
  /** SHA-256 (hex) of the stored image bytes. */
  sha256: string;
}

/** Decodes a stored or uploaded letterhead image; SVG comes back sanitized. */
export function decodePdfLetterheadImage(value: unknown): DecodedPdfLogo | null {
  return decodePdfLogo(value, { maxBytes: MAX_PDF_LETTERHEAD_BYTES });
}

/** Width and height of a PNG from its IHDR chunk. */
function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** A length attribute in user units: a plain number or one in px; null otherwise. */
function svgLength(value: string | undefined): number | null {
  if (value == null) return null;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  return match != null ? Number(match[1]) : null;
}

/**
 * Width and height of an SVG from the viewBox of its root element, or from
 * its width and height when it has no viewBox.
 */
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (root == null) return null;
  const attr = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(root)?.[1];
  const viewBox = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4 && viewBox.every((n) => Number.isFinite(n))) {
    const [, , width, height] = viewBox as [number, number, number, number];
    if (width > 0 && height > 0) return { width, height };
  }
  const width = svgLength(attr('width'));
  const height = svgLength(attr('height'));
  return width != null && height != null && width > 0 && height > 0 ? { width, height } : null;
}

/** True when width : height is A4 portrait within PDF_LETTERHEAD_ASPECT_TOLERANCE. */
export function isA4Portrait(width: number, height: number): boolean {
  const ratio = height / width;
  const a4 = A4_HEIGHT_MM / A4_WIDTH_MM;
  return Math.abs(ratio - a4) / a4 <= PDF_LETTERHEAD_ASPECT_TOLERANCE;
}

/**
 * Byte length of a PNG or SVG data URI's decoded payload, so a file that is
 * too large is told apart from one that is not an image. Null for anything
 * else.
 */
function imagePayloadBytes(value: string): number | null {
  const match = /^data:image\/(?:png|svg\+xml)(;charset=[\w-]+)?(;base64)?,(.*)$/is.exec(value);
  if (match == null) return null;
  const payload = match[3] ?? '';
  if (match[2] != null) return Buffer.byteLength(payload, 'base64');
  try {
    return Buffer.byteLength(decodeURIComponent(payload), 'utf8');
  } catch {
    // fail-open: a malformed percent-encoding is rejected as an invalid file.
    return null;
  }
}

/**
 * The value to store for an uploaded letterhead image: a PNG of at least
 * MIN_PDF_LETTERHEAD_PNG_WIDTH pixels or an SVG (stored sanitized), at most
 * MAX_PDF_LETTERHEAD_BYTES, in the aspect ratio of A4 portrait. Returns the
 * reason when the upload is rejected.
 */
export function normalizePdfLetterheadImage(
  value: unknown,
): NormalizedPdfLetterheadImage | { error: PdfLetterheadImageError } {
  if (typeof value !== 'string') return { error: 'format' };
  const payloadBytes = imagePayloadBytes(value.trim());
  if (payloadBytes != null && payloadBytes > MAX_PDF_LETTERHEAD_BYTES) return { error: 'size' };
  const image = decodePdfLetterheadImage(value);
  if (image == null) return { error: 'format' };
  let bytes: Buffer;
  let mime: string;
  let size: { width: number; height: number } | null;
  if (image.kind === 'svg') {
    bytes = Buffer.from(image.svg, 'utf8');
    if (bytes.length > MAX_PDF_LETTERHEAD_BYTES) return { error: 'size' };
    mime = 'image/svg+xml';
    size = svgSize(image.svg);
  } else if (image.kind === 'png') {
    bytes = image.data;
    mime = 'image/png';
    size = pngSize(image.data);
    if (size != null && size.width < MIN_PDF_LETTERHEAD_PNG_WIDTH) return { error: 'resolution' };
  } else {
    return { error: 'format' };
  }
  if (size == null || !isA4Portrait(size.width, size.height)) return { error: 'aspect' };
  return {
    dataUri: `data:${mime};base64,${bytes.toString('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PDF_LETTERHEAD_LAYOUT,
  MAX_PDF_LETTERHEAD_BYTES,
  normalizePdfLetterheadLayout,
  normalizePdfLetterheadName,
} from '../pdf-letterhead.js';
import {
  decodePdfLetterheadImage,
  isA4Portrait,
  normalizePdfLetterheadImage,
  svgSize,
} from '../pdf-letterhead-image.js';

/** A PNG header (signature and IHDR) of the given size. */
function png(width: number, height: number, extraBytes = 0): Buffer {
  const header = Buffer.alloc(33 + extraBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

const pngUri = (data: Buffer): string => `data:image/png;base64,${data.toString('base64')}`;
const svgUri = (svg: string): string =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

describe('normalizePdfLetterheadLayout', () => {
  it('accepts the default layout', () => {
    expect(normalizePdfLetterheadLayout(DEFAULT_PDF_LETTERHEAD_LAYOUT)).toEqual(
      DEFAULT_PDF_LETTERHEAD_LAYOUT,
    );
  });

  it('rounds each value to a tenth of a millimetre', () => {
    expect(
      normalizePdfLetterheadLayout({ ...DEFAULT_PDF_LETTERHEAD_LAYOUT, addressTopMm: 53.64 }),
    ).toMatchObject({ addressTopMm: 53.6 });
  });

  it.each([
    ['a missing value', { addressLeftMm: undefined }],
    ['a string', { contentTopMm: '105' }],
    ['a value out of range', { marginLeftMm: 2 }],
    ['less than 40 mm of text on the first page', { contentTopMm: 220, contentBottomMm: 255 }],
    ['text narrower than 160 mm', { marginLeftMm: 30, marginRightMm: 25 }],
  ])('refuses %s', (_label, override) => {
    expect(
      normalizePdfLetterheadLayout({ ...DEFAULT_PDF_LETTERHEAD_LAYOUT, ...override }),
    ).toBeNull();
  });

  it('refuses anything but an object', () => {
    expect(normalizePdfLetterheadLayout(null)).toBeNull();
    expect(normalizePdfLetterheadLayout('25')).toBeNull();
  });
});

describe('normalizePdfLetterheadName', () => {
  it('trims the name', () => {
    expect(normalizePdfLetterheadName('  Letterhead 2026 ')).toBe('Letterhead 2026');
  });

  it('refuses an empty or too long name', () => {
    expect(normalizePdfLetterheadName('   ')).toBeNull();
    expect(normalizePdfLetterheadName('x'.repeat(101))).toBeNull();
    expect(normalizePdfLetterheadName(42)).toBeNull();
  });
});

describe('isA4Portrait and svgSize', () => {
  it('accepts A4 portrait within 1 %', () => {
    expect(isA4Portrait(2480, 3508)).toBe(true);
    expect(isA4Portrait(210, 297)).toBe(true);
    expect(isA4Portrait(2480, 3560)).toBe(false);
    expect(isA4Portrait(3508, 2480)).toBe(false);
  });

  it('reads the viewBox, else width and height', () => {
    expect(svgSize('<svg viewBox="0 0 595.28 841.89" width="210mm">')).toEqual({
      width: 595.28,
      height: 841.89,
    });
    expect(svgSize('<svg width="595px" height="842">')).toEqual({ width: 595, height: 842 });
    expect(svgSize('<svg width="210mm" height="297mm">')).toBeNull();
    expect(svgSize('<g/>')).toBeNull();
  });
});

describe('normalizePdfLetterheadImage', () => {
  it('stores a PNG with its SHA-256', () => {
    const data = png(2480, 3508);
    const result = normalizePdfLetterheadImage(pngUri(data));
    expect(result).toEqual({
      dataUri: pngUri(data),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('stores an SVG sanitized', () => {
    const result = normalizePdfLetterheadImage(
      svgUri(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><script>alert(1)</script><rect width="210" height="297"/></svg>',
      ),
    );
    expect('dataUri' in result).toBe(true);
    if ('dataUri' in result) {
      const svg = Buffer.from(result.dataUri.split(',')[1] ?? '', 'base64').toString('utf8');
      expect(svg).toContain('<rect');
      expect(svg).not.toContain('script');
    }
  });

  it.each([
    ['a JPEG', 'data:image/jpeg;base64,/9j/4AAQ', 'format'],
    ['not a data URI', 'https://example.com/letterhead.png', 'format'],
    ['a landscape page', pngUri(png(3508, 2480)), 'aspect'],
    ['an SVG without size', svgUri('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'), 'aspect'],
    ['a PNG below 150 dpi', pngUri(png(1000, 1414)), 'resolution'],
    ['a file over the limit', pngUri(png(2480, 3508, MAX_PDF_LETTERHEAD_BYTES)), 'size'],
  ])('refuses %s', (_label, value, error) => {
    expect(normalizePdfLetterheadImage(value)).toEqual({ error });
  });

  it('decodes a stored image larger than a logo', () => {
    const data = png(2480, 3508, 600 * 1024);
    expect(decodePdfLetterheadImage(pngUri(data))).toMatchObject({ kind: 'png' });
  });
});

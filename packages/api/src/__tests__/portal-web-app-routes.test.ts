// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';

let settingRows: { key: string; value: unknown }[] = [];

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where']) chain[m] = vi.fn(() => chain);
  chain['then'] = (resolve?: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
    Promise.resolve(settingRows).then(resolve, reject);
  return chain;
}

vi.mock('@evtivity/database', () => ({
  db: { select: vi.fn(() => makeChain()) },
  settings: {},
}));
vi.mock('drizzle-orm', () => ({ inArray: vi.fn() }));
vi.mock('../lib/config.js', () => ({ config: { PORTAL_URL: 'https://portal.test' } }));

import {
  clearWebAppIconCache,
  decodeImageDataUri,
  portalWebAppRoutes,
} from '../routes/portal/web-app.js';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ec008c"/></svg>';
const SVG_URI = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;

function useSettings(values: Record<string, string>): void {
  settingRows = Object.entries(values).map(([key, value]) => ({ key, value }));
}

describe('Portal web app routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(portalWebAppRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    clearWebAppIconCache();
    useSettings({});
  });

  describe('GET /portal/manifest.webmanifest', () => {
    it('describes the portal as a standalone app with the logo icons', async () => {
      useSettings({
        'company.name': 'RHIEM EV',
        'company.logo': SVG_URI,
        'company.themeColor': '#e5007d',
        'company.portalUrl': 'https://ev.example.com/',
      });
      const res = await app.inject({ method: 'GET', url: '/portal/manifest.webmanifest' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/manifest+json');
      const body = res.json();
      expect(body).toMatchObject({
        id: 'https://ev.example.com/',
        name: 'RHIEM EV',
        short_name: 'RHIEM EV',
        start_url: 'https://ev.example.com/',
        scope: 'https://ev.example.com/',
        display: 'standalone',
        theme_color: '#e5007d',
      });
      expect(
        body.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`),
      ).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
      // The logo version in the URL makes a new logo a new icon for installed apps.
      expect(body.icons[0].src).toMatch(/^\/v1\/portal\/app-icon\/192\.png\?v=[0-9a-f]{16}$/);
    });

    it('falls back to PORTAL_URL, the default name and color, and lists no icons without a logo', async () => {
      useSettings({
        'company.themeColor': 'magenta',
        'company.logo': 'https://cdn.example.com/x.svg',
      });
      const body = (
        await app.inject({ method: 'GET', url: '/portal/manifest.webmanifest' })
      ).json();
      expect(body.start_url).toBe('https://portal.test/');
      expect(body.name).toBe('EVtivity');
      expect(body.theme_color).toBe('#2563eb');
      expect(body.icons).toEqual([]);
    });
  });

  describe('GET /portal/app-icon/:file', () => {
    it('renders the logo on an opaque square PNG of the requested size', async () => {
      useSettings({ 'company.logo': SVG_URI });
      const res = await app.inject({ method: 'GET', url: '/portal/app-icon/180.png' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      const meta = await sharp(res.rawPayload).metadata();
      expect([meta.width, meta.height]).toEqual([180, 180]);
      // Corner is the white background, center is the logo.
      const { data, info } = await sharp(res.rawPayload)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const px = (x: number, y: number) =>
        Array.from(
          data.subarray(
            (y * info.width + x) * info.channels,
            (y * info.width + x) * info.channels + 3,
          ),
        );
      expect(px(0, 0)).toEqual([255, 255, 255]);
      expect(px(90, 90)).toEqual([236, 0, 140]);
    });

    it('uses the favicon when no logo is set and answers 304 to a matching ETag', async () => {
      useSettings({ 'company.favicon': SVG_URI });
      const first = await app.inject({ method: 'GET', url: '/portal/app-icon/512-maskable.png' });
      expect(first.statusCode).toBe(200);
      const etag = first.headers['etag'] as string;
      expect(etag).toMatch(/^"[0-9a-f]{16}-512-maskable\.png"$/);
      const again = await app.inject({
        method: 'GET',
        url: '/portal/app-icon/512-maskable.png',
        headers: { 'if-none-match': etag },
      });
      expect(again.statusCode).toBe(304);
    });

    it('answers 404 without an image logo and 400 for an unknown size', async () => {
      const none = await app.inject({ method: 'GET', url: '/portal/app-icon/192.png' });
      expect(none.statusCode).toBe(404);
      expect(none.json()).toEqual({ error: 'No company logo', code: 'NOT_FOUND' });
      useSettings({ 'company.logo': SVG_URI });
      const odd = await app.inject({ method: 'GET', url: '/portal/app-icon/64.png' });
      expect(odd.statusCode).toBe(400);
    });
  });

  describe('decodeImageDataUri', () => {
    it('reads base64 and percent-encoded image data URIs only', () => {
      expect(decodeImageDataUri(SVG_URI)?.toString('utf8')).toBe(SVG);
      expect(
        decodeImageDataUri(`data:image/svg+xml,${encodeURIComponent(SVG)}`)?.toString('utf8'),
      ).toBe(SVG);
      expect(decodeImageDataUri('data:text/html;base64,PGgxPg==')).toBeNull();
      expect(decodeImageDataUri('data:image/svg+xml,%E0%A4%A')).toBeNull();
      expect(decodeImageDataUri('')).toBeNull();
    });
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import { inArray } from 'drizzle-orm';
import { db, settings } from '@evtivity/database';
import { zodSchema } from '../../lib/zod-schema.js';
import { errorWith } from '../../lib/response-schemas.js';
import { ERROR_CODES } from '../../lib/error-codes.generated.js';
import { config as apiConfig } from '../../lib/config.js';

/**
 * The driver portal as an installable web app: the web app manifest and the
 * home screen icons, both built from the company branding (Settings >
 * Company). iOS takes the apple-touch-icon, Android and desktop browsers the
 * manifest icons. Without these, iOS falls back to a stale cached image and
 * Chrome offers no install. No service worker: the portal needs the network
 * anyway, and installability does not require one.
 */

const KEYS = [
  'company.name',
  'company.logo',
  'company.favicon',
  'company.themeColor',
  'company.portalUrl',
] as const;

/** apple-touch-icon (180), manifest icons (192, 512) and the maskable 512. */
const ICON_SIZES = [180, 192, 512] as const;
const ICON_BACKGROUND = '#ffffff';
const DEFAULT_THEME_COLOR = '#2563eb';
const MAX_INPUT_PIXELS = 4096 * 4096;
/** Share of the icon the logo fills: iOS rounds the corners, maskable icons keep an 80 % safe zone. */
const LOGO_SCALE = { any: 0.8, maskable: 0.6 } as const;

interface Branding {
  name: string;
  image: Buffer | null;
  themeColor: string;
  portalUrl: string;
}

const DATA_URI = /^data:image\/(svg\+xml|png|jpeg|webp)(;charset=[\w-]+)?(;base64)?,(.*)$/s;

/** Decodes an image data URI; null for anything else (an external URL is not fetched). */
export function decodeImageDataUri(value: string): Buffer | null {
  const match = DATA_URI.exec(value.trim());
  if (match == null) return null;
  const payload = match[4] ?? '';
  try {
    return match[3] != null
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    // fail-open: a malformed percent escape is treated like no image
    return null;
  }
}

async function readBranding(): Promise<Branding> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [...KEYS]));
  const value = (key: (typeof KEYS)[number]): string => {
    const row = rows.find((r) => r.key === key);
    return typeof row?.value === 'string' ? row.value.trim() : '';
  };
  // The logo is the brand mark; a favicon is often too small for a home screen.
  const image =
    decodeImageDataUri(value('company.logo')) ?? decodeImageDataUri(value('company.favicon'));
  const themeColor = /^#[0-9a-f]{6}$/i.test(value('company.themeColor'))
    ? value('company.themeColor')
    : DEFAULT_THEME_COLOR;
  const portalUrl = (value('company.portalUrl') || apiConfig.PORTAL_URL).replace(/\/+$/, '');
  return { name: value('company.name') || 'EVtivity', image, themeColor, portalUrl };
}

function versionOf(image: Buffer): string {
  return createHash('sha256').update(image).digest('hex').slice(0, 16);
}

/** Rendered icons by logo version, size and purpose; a new logo gets a new version. */
const iconCache = new Map<string, Buffer>();
const ICON_CACHE_LIMIT = 16;

export function clearWebAppIconCache(): void {
  iconCache.clear();
}

export async function renderAppIcon(
  image: Buffer,
  size: number,
  purpose: keyof typeof LOGO_SCALE,
): Promise<Buffer> {
  const key = `${versionOf(image)}:${String(size)}:${purpose}`;
  const cached = iconCache.get(key);
  if (cached != null) return cached;
  const inner = Math.round(size * LOGO_SCALE[purpose]);
  // A high density keeps SVG logos sharp at 512 px.
  const logo = await sharp(image, { density: 300, limitInputPixels: MAX_INPUT_PIXELS })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  // An opaque background: iOS fills transparent icon areas with black.
  const icon = await sharp({
    create: { width: size, height: size, channels: 4, background: ICON_BACKGROUND },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .flatten({ background: ICON_BACKGROUND })
    .png()
    .toBuffer();
  if (iconCache.size >= ICON_CACHE_LIMIT) iconCache.clear();
  iconCache.set(key, icon);
  return icon;
}

const iconParams = z.object({
  file: z
    .enum(['180.png', '192.png', '512.png', '512-maskable.png'])
    .describe('Icon size in pixels, and maskable for Android adaptive icons'),
});

const manifestIcon = z.object({
  src: z.string(),
  sizes: z.string(),
  type: z.string(),
  purpose: z.string(),
});

const manifestResponse = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  start_url: z.string(),
  scope: z.string(),
  display: z.string(),
  background_color: z.string(),
  theme_color: z.string(),
  icons: z.array(manifestIcon),
});

export function portalWebAppRoutes(app: FastifyInstance): void {
  app.get(
    '/portal/manifest.webmanifest',
    {
      schema: {
        tags: ['Settings'],
        summary: 'Get the web app manifest of the driver portal',
        description:
          'Makes the driver portal installable as a web app: name, start URL (company.portalUrl, else PORTAL_URL), standalone display, theme color and the home screen icons built from the company logo. Without a logo (or favicon) stored as an image data URI the icon list is empty. Public, application/manifest+json.',
        operationId: 'getPortalWebAppManifest',
        security: [],
        response: { 200: zodSchema(manifestResponse) },
      },
    },
    async (_request, reply) => {
      const branding = await readBranding();
      const v = branding.image != null ? `?v=${versionOf(branding.image)}` : '';
      const icon = (file: string, size: number, purpose: string) => ({
        src: `/v1/portal/app-icon/${file}${v}`,
        sizes: `${String(size)}x${String(size)}`,
        type: 'image/png',
        purpose,
      });
      const start = `${branding.portalUrl}/`;
      void reply
        .header('Content-Type', 'application/manifest+json; charset=utf-8')
        .header('Cache-Control', 'no-cache');
      return {
        id: start,
        name: branding.name,
        short_name: branding.name,
        start_url: start,
        scope: start,
        display: 'standalone',
        background_color: ICON_BACKGROUND,
        theme_color: branding.themeColor,
        icons:
          branding.image == null
            ? []
            : [
                icon('192.png', 192, 'any'),
                icon('512.png', 512, 'any'),
                icon('512-maskable.png', 512, 'maskable'),
              ],
      };
    },
  );

  app.get(
    '/portal/app-icon/:file',
    {
      schema: {
        tags: ['Settings'],
        summary: 'Get a home screen icon of the driver portal',
        description:
          'The company logo (else the favicon) centered on a white square PNG, for the iOS apple-touch-icon (180) and the web app manifest (192, 512, 512 maskable). Only image data URIs (SVG, PNG, JPEG, WebP) are used; none answers 404 NOT_FOUND. Revalidated by ETag, so a new logo shows on the next install. Public, image/png.',
        operationId: 'getPortalAppIcon',
        security: [],
        params: zodSchema(iconParams),
        response: {
          304: zodSchema(z.null().describe('The icon is unchanged (If-None-Match)')),
          404: errorWith('No company logo', [ERROR_CODES.NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      const { file } = request.params as z.infer<typeof iconParams>;
      const branding = await readBranding();
      if (branding.image == null) {
        await reply.status(404).send({ error: 'No company logo', code: 'NOT_FOUND' });
        return;
      }
      const size = Number(file.split(/[.-]/)[0]);
      if (!(ICON_SIZES as readonly number[]).includes(size)) {
        await reply.status(404).send({ error: 'No company logo', code: 'NOT_FOUND' });
        return;
      }
      const purpose = file.includes('maskable') ? 'maskable' : 'any';
      const etag = `"${versionOf(branding.image)}-${file}"`;
      void reply.header('ETag', etag).header('Cache-Control', 'public, max-age=0, must-revalidate');
      if (request.headers['if-none-match'] === etag) {
        await reply.status(304).send();
        return;
      }
      const png = await renderAppIcon(branding.image, size, purpose);
      await reply.header('Content-Type', 'image/png').send(png);
    },
  );
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';

vi.mock('../lib/site-access.js', async () =>
  (await import('./helpers/site-access-mock.js')).siteAccessMock(),
);
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { resetSiteAccessMock, setMockUserSiteIds } from './helpers/site-access-mock.js';

// DB mock: each awaited query takes the next queued result.
let dbResults: unknown[][] = [];
let dbCallIndex = 0;

function setupDbResults(...results: unknown[][]) {
  dbResults = results;
  dbCallIndex = 0;
}

const calls = vi.hoisted(() => ({ set: [] as unknown[], values: [] as unknown[] }));
const writeAuditMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const previewMock = vi.hoisted(() => vi.fn(() => Promise.resolve(Buffer.from('%PDF-1.3 preview'))));
// pdfkit reads the image (real PNG data is not needed for the route checks).
const rendersMock = vi.hoisted(() => vi.fn((): Buffer | null => Buffer.from('png')));

function makeChain() {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select',
    'from',
    'where',
    'orderBy',
    'groupBy',
    'returning',
    'insert',
    'onConflictDoUpdate',
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain['set'] = vi.fn((value: unknown) => {
    calls.set.push(value);
    return chain;
  });
  chain['values'] = vi.fn((value: unknown) => {
    calls.values.push(value);
    return chain;
  });
  let awaited = false;
  chain['then'] = (resolve?: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
    if (!awaited) {
      awaited = true;
      const r = dbResults[dbCallIndex] ?? [];
      dbCallIndex++;
      return Promise.resolve(r).then(resolve, reject);
    }
    return Promise.resolve([]).then(resolve, reject);
  };
  return chain;
}

vi.mock('../middleware/rbac.js', () => ({
  authorize:
    () =>
    async (
      request: { jwtVerify: () => Promise<void> },
      reply: { status: (code: number) => { send: (body: unknown) => Promise<void> } },
    ) => {
      try {
        await request.jwtVerify();
      } catch {
        await reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  invalidatePermissionCache: vi.fn(),
}));

vi.mock('@evtivity/database', () => {
  const db: Record<string, unknown> = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
  };
  db['transaction'] = vi.fn((cb: (tx: unknown) => unknown) => cb(db));
  return {
    db,
    invoices: { letterheadId: 'invoices.letterheadId' },
    invoiceIssuers: { id: 'invoiceIssuers.id' },
    invoiceSellerSnapshotFromIssuer: (issuer: { name: string }) => ({ name: issuer.name }),
    pdfLetterheads: {
      id: 'pdfLetterheads.id',
      image: 'pdfLetterheads.image',
      issuerId: 'pdfLetterheads.issuerId',
      createdAt: 'pdfLetterheads.createdAt',
    },
    settings: { key: 'settings.key', value: 'settings.value' },
    settingAuditLog: { __table: 'settingAuditLog' },
    writeAudit: writeAuditMock,
  };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNotNull: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@evtivity/services/invoice-letterhead-preview', () => ({
  generatePdfLetterheadPreview: previewMock,
}));

vi.mock('@evtivity/services/invoice-pdf.service', () => ({
  letterheadBackground: rendersMock,
  resolveInvoicePdfLanguage: (language: string | undefined) => language ?? 'en',
}));

import { isNull } from 'drizzle-orm';
import { registerAuth } from '../plugins/auth.js';
import { pdfLetterheadRoutes } from '../routes/pdf-letterheads.js';

const NOW = '2026-11-05T12:00:00.000Z';

/** A PNG header (signature and IHDR) of the given size: enough for the upload checks. */
function pngDataUri(width: number, height: number): string {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return `data:image/png;base64,${header.toString('base64')}`;
}

const A4_PNG = pngDataUri(2480, 3508);

const LAYOUT = {
  addressLeftMm: 22.9,
  addressTopMm: 53.6,
  contentTopMm: 92,
  contentBottomMm: 258,
  marginLeftMm: 15.2,
  marginRightMm: 15.2,
};

/** A version as the routes select it: every column but the image. */
function letterheadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lhd_ri',
    name: 'RHIEM Intermedia 2026',
    imageSha256: 'a'.repeat(64),
    issuerId: null,
    ...LAYOUT,
    createdByUserId: 'test-id',
    createdAt: NOW,
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerAuth(app);
  pdfLetterheadRoutes(app);
  await app.ready();
  return app;
}

describe('PDF letterhead routes', () => {
  let app: FastifyInstance;
  let token: string;
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await buildApp();
    token = app.jwt.sign({ userId: 'test-id', roleId: 'test-role' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    setupDbResults();
    resetSiteAccessMock();
    calls.set.length = 0;
    calls.values.length = 0;
    writeAuditMock.mockClear();
    previewMock.mockClear();
    rendersMock.mockClear();
    vi.mocked(isNull).mockClear();
  });

  describe('GET /pdf-letterheads', () => {
    it('returns 401 without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/pdf-letterheads' });
      expect(res.statusCode).toBe(401);
    });

    it('lists the versions without the image, the current one and their invoices', async () => {
      setupDbResults(
        [letterheadRow(), letterheadRow({ id: 'lhd_old', name: 'Old' })],
        [{ value: 'lhd_ri' }],
        [{ letterheadId: 'lhd_old', count: 12 }],
      );
      const res = await app.inject({ method: 'GET', url: '/pdf-letterheads', headers: auth() });

      expect(res.statusCode).toBe(200);
      const body: Array<Record<string, unknown>> = res.json();
      expect(body[0]).toMatchObject({ id: 'lhd_ri', current: true, invoiceCount: 0, ...LAYOUT });
      expect(body[1]).toMatchObject({ id: 'lhd_old', current: false, invoiceCount: 12 });
      expect(body[0]).not.toHaveProperty('image');
      // Only the company's versions: an invoice issuer lists its own.
      expect(vi.mocked(isNull)).toHaveBeenCalledWith('pdfLetterheads.issuerId');
    });

    it('refuses a site-restricted user with 404', async () => {
      setMockUserSiteIds(['sit_a']);
      const res = await app.inject({ method: 'GET', url: '/pdf-letterheads', headers: auth() });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'PDF_LETTERHEAD_NOT_FOUND' });
    });
  });

  describe('POST /pdf-letterheads', () => {
    const payload = { name: ' RHIEM Intermedia 2026 ', image: A4_PNG, ...LAYOUT };

    it('creates a version with the image hash, the layout and the user', async () => {
      setupDbResults([letterheadRow()], [{ value: '' }]);
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads',
        headers: auth(),
        payload,
      });

      expect(res.statusCode).toBe(201);
      expect(calls.values[0]).toMatchObject({
        name: 'RHIEM Intermedia 2026',
        image: A4_PNG,
        ...LAYOUT,
        createdByUserId: 'test-id',
      });
      expect((calls.values[0] as { imageSha256: string }).imageSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.json()).toMatchObject({ id: 'lhd_ri', current: false, invoiceCount: 0 });
      expect(res.json()).not.toHaveProperty('image');
      expect(writeAuditMock).toHaveBeenCalledTimes(1);
      expect(writeAuditMock).toHaveBeenCalledWith(
        { table: { __table: 'settingAuditLog' }, idColumn: 'setting_key' },
        expect.objectContaining({
          entityId: 'pdfLetterhead:lhd_ri',
          action: 'created',
          after: expect.not.objectContaining({ image: expect.anything() }),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('makes the version current with activate and audits pdf.letterhead', async () => {
      setupDbResults([{ value: 'lhd_old' }], [letterheadRow()]);
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads',
        headers: auth(),
        payload: { ...payload, activate: true },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ current: true });
      expect(calls.values[1]).toEqual({ key: 'pdf.letterhead', value: 'lhd_ri' });
      expect(writeAuditMock).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'pdf.letterhead',
          before: { key: 'pdf.letterhead', value: 'lhd_old' },
          after: { key: 'pdf.letterhead', value: 'lhd_ri' },
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('refuses an image pdfkit cannot read with 400', async () => {
      rendersMock.mockReturnValueOnce(null);
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads',
        headers: auth(),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('readable PNG or SVG') });
      expect(calls.values).toHaveLength(0);
    });

    it.each([
      ['an image that is not A4 portrait', { image: pngDataUri(3508, 2480) }, 'A4 portrait'],
      ['a PNG below 150 dpi', { image: pngDataUri(1000, 1414) }, 'at least 1240 pixels'],
      ['a JPEG', { image: 'data:image/jpeg;base64,/9j/4AAQ' }, 'PNG or SVG'],
      ['a blank name', { name: '  ' }, 'name must be'],
      ['text narrower than 160 mm', { marginLeftMm: 30, marginRightMm: 30 }, 'side margins'],
      ['text area too low', { contentTopMm: 240, contentBottomMm: 260 }, 'contentTopMm'],
    ])('refuses %s with 400', async (_label, override, message) => {
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads',
        headers: auth(),
        payload: { ...payload, ...override },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(res.json()).toMatchObject({ error: expect.stringContaining(message) });
      expect(calls.values).toHaveLength(0);
    });
  });

  describe('GET /pdf-letterheads/:id/image', () => {
    it('returns the stored image', async () => {
      setupDbResults([{ image: A4_PNG }]);
      const res = await app.inject({
        method: 'GET',
        url: '/pdf-letterheads/lhd_ri/image',
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ image: A4_PNG });
    });

    it('returns 404 for an unknown version', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'GET',
        url: '/pdf-letterheads/lhd_missing/image',
        headers: auth(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'PDF_LETTERHEAD_NOT_FOUND' });
    });
  });

  describe('PUT /pdf-letterheads/current', () => {
    it('sets the current version and audits the change', async () => {
      setupDbResults([{ id: 'lhd_ri' }], [{ value: '' }]);
      const res = await app.inject({
        method: 'PUT',
        url: '/pdf-letterheads/current',
        headers: auth(),
        payload: { letterheadId: 'lhd_ri' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ letterheadId: 'lhd_ri' });
      expect(calls.values[0]).toEqual({ key: 'pdf.letterhead', value: 'lhd_ri' });
      expect(writeAuditMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'pdf.letterhead',
          before: { key: 'pdf.letterhead', value: '' },
          after: { key: 'pdf.letterhead', value: 'lhd_ri' },
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('clears it with null', async () => {
      setupDbResults([{ value: 'lhd_ri' }]);
      const res = await app.inject({
        method: 'PUT',
        url: '/pdf-letterheads/current',
        headers: auth(),
        payload: { letterheadId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(calls.values[0]).toEqual({ key: 'pdf.letterhead', value: '' });
    });

    it('does not audit an unchanged value', async () => {
      setupDbResults([{ id: 'lhd_ri' }], [{ value: 'lhd_ri' }]);
      await app.inject({
        method: 'PUT',
        url: '/pdf-letterheads/current',
        headers: auth(),
        payload: { letterheadId: 'lhd_ri' },
      });
      expect(writeAuditMock).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown version', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'PUT',
        url: '/pdf-letterheads/current',
        headers: auth(),
        payload: { letterheadId: 'lhd_missing' },
      });
      expect(res.statusCode).toBe(404);
      // A version of an invoice issuer is never the company's current one.
      expect(vi.mocked(isNull)).toHaveBeenCalledWith('pdfLetterheads.issuerId');
      expect(calls.values).toHaveLength(0);
    });
  });

  describe('POST /pdf-letterheads/preview', () => {
    it('streams the sample invoice PDF on the image and layout', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads/preview',
        headers: auth(),
        payload: { image: A4_PNG, ...LAYOUT, language: 'de' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.body).toContain('%PDF');
      expect(previewMock).toHaveBeenCalledWith(
        expect.objectContaining({ image: A4_PNG, layout: LAYOUT }),
        'de',
        null,
      );
      expect(calls.values).toHaveLength(0);
    });

    it('names the seller of an invoice issuer with issuerId', async () => {
      setupDbResults([{ id: 'iis_rs', name: 'RHIEM Services GmbH' }]);
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads/preview',
        headers: auth(),
        payload: { image: A4_PNG, ...LAYOUT, issuerId: 'iis_rs' },
      });
      expect(res.statusCode).toBe(200);
      expect(previewMock).toHaveBeenCalledWith(expect.anything(), 'en', {
        name: 'RHIEM Services GmbH',
      });
    });

    it('returns 404 for an unknown invoice issuer', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads/preview',
        headers: auth(),
        payload: { image: A4_PNG, ...LAYOUT, issuerId: 'iis_missing' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'INVOICE_ISSUER_NOT_FOUND' });
      expect(previewMock).not.toHaveBeenCalled();
    });

    it('refuses an invalid image with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pdf-letterheads/preview',
        headers: auth(),
        payload: { image: pngDataUri(100, 100), ...LAYOUT },
      });
      expect(res.statusCode).toBe(400);
      expect(previewMock).not.toHaveBeenCalled();
    });
  });
});

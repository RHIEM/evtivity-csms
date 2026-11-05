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

function makeChain() {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select',
    'selectDistinct',
    'from',
    'where',
    'orderBy',
    'groupBy',
    'limit',
    'for',
    'returning',
    'delete',
    'insert',
    'update',
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
    selectDistinct: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
    delete: vi.fn(() => makeChain()),
  };
  db['transaction'] = vi.fn((cb: (tx: unknown) => unknown) => cb(db));
  return {
    db,
    fleets: { id: 'fleets.id', invoiceIssuerId: 'fleets.invoiceIssuerId' },
    invoices: { id: 'invoices.id', issuerId: 'invoices.issuerId' },
    invoiceIssuers: { id: 'invoiceIssuers.id', name: 'invoiceIssuers.name' },
    invoiceIssuerNumberCounters: { issuerId: 'c.issuerId', kind: 'c.kind' },
    settingAuditLog: { __table: 'settingAuditLog' },
    writeAudit: writeAuditMock,
  };
});

vi.mock('drizzle-orm', () => ({
  asc: vi.fn(),
  eq: vi.fn(),
  sql: vi.fn(),
}));

import { registerAuth } from '../plugins/auth.js';
import { invoiceIssuerRoutes } from '../routes/invoice-issuers.js';

const NOW = '2026-11-04T12:00:00.000Z';

function issuerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'iis_rs',
    name: 'RHIEM Services GmbH',
    street: null,
    zip: null,
    city: null,
    state: null,
    country: null,
    taxId: null,
    taxIdLabel: null,
    registrationNumber: null,
    email: null,
    phone: null,
    invoicePrefix: '',
    invoiceWithYear: false,
    invoiceStart: 10000,
    invoiceDigits: 0,
    creditNotePrefix: 'GS-',
    creditNoteWithYear: true,
    creditNoteStart: 1,
    creditNoteDigits: 4,
    pdfLogo: null,
    pdfFooter: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerAuth(app);
  invoiceIssuerRoutes(app);
  await app.ready();
  return app;
}

describe('Invoice issuer routes', () => {
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
  });

  describe('GET /invoice-issuers', () => {
    it('returns 401 without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/invoice-issuers' });
      expect(res.statusCode).toBe(401);
    });

    it('lists the issuers with their locks and fleet counts', async () => {
      setupDbResults(
        [issuerRow(), issuerRow({ id: 'iis_rpp', name: 'RHIEM Packaging & Print GmbH' })],
        [{ issuerId: 'iis_rs', count: 2 }],
        [{ kind: 'invoice' }],
        [],
      );
      const res = await app.inject({ method: 'GET', url: '/invoice-issuers', headers: auth() });

      expect(res.statusCode).toBe(200);
      const body: Array<Record<string, unknown>> = res.json();
      expect(body[0]).toMatchObject({
        id: 'iis_rs',
        invoiceNumberLocked: true,
        creditNoteNumberLocked: false,
        fleetCount: 2,
      });
      expect(body[1]).toMatchObject({
        id: 'iis_rpp',
        invoiceNumberLocked: false,
        fleetCount: 0,
      });
    });

    it('refuses a site-restricted user with 404', async () => {
      setMockUserSiteIds(['sit_a']);
      const res = await app.inject({ method: 'GET', url: '/invoice-issuers', headers: auth() });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'INVOICE_ISSUER_NOT_FOUND' });
    });
  });

  describe('POST /invoice-issuers', () => {
    it('creates an issuer, a blank seller detail stored as null', async () => {
      setupDbResults([issuerRow()], []);
      const res = await app.inject({
        method: 'POST',
        url: '/invoice-issuers',
        headers: auth(),
        payload: { name: ' RHIEM Services GmbH ', city: '  ', invoiceStart: 10000 },
      });

      expect(res.statusCode).toBe(201);
      expect(calls.values[0]).toEqual({
        name: 'RHIEM Services GmbH',
        city: null,
        invoiceStart: 10000,
      });
      expect(res.json()).toMatchObject({ id: 'iis_rs', invoiceNumberLocked: false, fleetCount: 0 });
      expect(writeAuditMock).toHaveBeenCalledWith(
        { table: { __table: 'settingAuditLog' }, idColumn: 'setting_key' },
        expect.objectContaining({
          entityId: 'invoiceIssuer:iis_rs',
          action: 'updated',
          before: null,
          notes: 'Invoice issuer created',
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('refuses a prefix with a slash or a space', async () => {
      for (const invoicePrefix of ['RE/26', 'R S']) {
        const res = await app.inject({
          method: 'POST',
          url: '/invoice-issuers',
          headers: auth(),
          payload: { name: 'X', invoicePrefix },
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('refuses a missing name and out-of-range numbers', async () => {
      for (const payload of [
        { invoicePrefix: 'RS-' },
        { name: 'X', invoiceDigits: 11 },
        { name: 'X', creditNoteStart: -1 },
      ]) {
        const res = await app.inject({
          method: 'POST',
          url: '/invoice-issuers',
          headers: auth(),
          payload,
        });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  describe('PATCH /invoice-issuers/:id', () => {
    it('updates the seller details of an issuer in use', async () => {
      const updated = issuerRow({ city: 'Köln' });
      setupDbResults([issuerRow()], [{ kind: 'invoice' }], [updated], [], [{ kind: 'invoice' }]);
      const res = await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { city: 'Köln', invoiceStart: 10000 },
      });

      expect(res.statusCode).toBe(200);
      expect(calls.set[0]).toMatchObject({ city: 'Köln', invoiceStart: 10000 });
      expect(res.json()).toMatchObject({ city: 'Köln', invoiceNumberLocked: true });
      expect(writeAuditMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'invoiceIssuer:iis_rs',
          action: 'updated',
          before: expect.objectContaining({ city: null }),
          after: expect.objectContaining({ city: 'Köln' }),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('refuses to change a number format the issuer has used', async () => {
      setupDbResults([issuerRow()], [{ kind: 'invoice' }]);
      const res = await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { invoicePrefix: 'RS-' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'INVOICE_ISSUER_NUMBER_FORMAT_LOCKED' });
      expect(calls.set).toHaveLength(0);
      expect(writeAuditMock).not.toHaveBeenCalled();
    });

    it('changes the credit note format while only the invoice range is used', async () => {
      setupDbResults(
        [issuerRow()],
        [{ kind: 'invoice' }],
        [issuerRow({ creditNotePrefix: 'RSG-' })],
        [],
        [{ kind: 'invoice' }],
      );
      const res = await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { creditNotePrefix: 'RSG-' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ creditNotePrefix: 'RSG-' });
    });

    it('returns 404 for an unknown issuer', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_x',
        headers: auth(),
        payload: { city: 'Köln' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'INVOICE_ISSUER_NOT_FOUND' });
    });
  });

  describe('DELETE /invoice-issuers/:id', () => {
    it('deletes an unused issuer', async () => {
      setupDbResults([{ id: 'iis_rs' }], [], [], [], []);
      const res = await app.inject({
        method: 'DELETE',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
      });
      expect(res.statusCode).toBe(204);
      expect(writeAuditMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'invoiceIssuer:iis_rs',
          action: 'deleted',
          after: null,
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('refuses an issuer a fleet uses', async () => {
      setupDbResults([{ id: 'iis_rs' }], [{ id: 'flt_1' }], [], []);
      const res = await app.inject({
        method: 'DELETE',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'INVOICE_ISSUER_IN_USE' });
    });

    it('refuses an issuer that issued a document', async () => {
      setupDbResults([{ id: 'iis_rs' }], [], [{ id: 'inv_1' }], []);
      const res = await app.inject({
        method: 'DELETE',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
      });
      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for an unknown issuer', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'DELETE',
        url: '/invoice-issuers/iis_x',
        headers: auth(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PDF branding', () => {
    const PNG_URI = 'data:image/png;base64,iVBORw0KGgo=';

    it('lists whether an issuer has a logo, never the logo itself', async () => {
      setupDbResults([issuerRow({ pdfLogo: PNG_URI, pdfFooter: '' })], [], []);
      const res = await app.inject({ method: 'GET', url: '/invoice-issuers', headers: auth() });

      const body: Array<Record<string, unknown>> = res.json();
      expect(body[0]).toMatchObject({ hasPdfLogo: true, pdfFooter: '' });
      expect(body[0]).not.toHaveProperty('pdfLogo');
    });

    it('stores the footer normalized', async () => {
      setupDbResults([issuerRow()], [], [issuerRow({ pdfFooter: 'Line 1\nLine 2' })], [], []);
      const res = await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { pdfFooter: 'Line 1  \r\nLine 2\n\n' },
      });

      expect(res.statusCode).toBe(200);
      expect(calls.set[0]).toMatchObject({ pdfFooter: 'Line 1\nLine 2' });
      expect(res.json()).toMatchObject({ pdfFooter: 'Line 1\nLine 2', hasPdfLogo: false });
    });

    it('keeps null (the company footer) and an empty footer (none) apart', async () => {
      setupDbResults([issuerRow()], [], [issuerRow()], [], []);
      await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { pdfFooter: null },
      });
      setupDbResults([issuerRow()], [], [issuerRow({ pdfFooter: '' })], [], []);
      await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { pdfFooter: '' },
      });

      expect(calls.set[0]).toMatchObject({ pdfFooter: null });
      expect(calls.set[1]).toMatchObject({ pdfFooter: '' });
    });

    it('refuses a footer with too many lines with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/invoice-issuers/iis_rs',
        headers: auth(),
        payload: { pdfFooter: '1\n2\n3\n4\n5\n6' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(calls.set).toHaveLength(0);
    });

    it('returns the stored logo', async () => {
      setupDbResults([{ logo: PNG_URI }]);
      const res = await app.inject({
        method: 'GET',
        url: '/invoice-issuers/iis_rs/pdf-logo',
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ logo: PNG_URI });
    });

    it('answers 404 for the logo of an unknown issuer', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'GET',
        url: '/invoice-issuers/iis_x/pdf-logo',
        headers: auth(),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'INVOICE_ISSUER_NOT_FOUND' });
    });

    it('sets the logo and audits it without the image', async () => {
      setupDbResults([issuerRow()], [issuerRow({ pdfLogo: PNG_URI })], [], []);
      const res = await app.inject({
        method: 'PUT',
        url: '/invoice-issuers/iis_rs/pdf-logo',
        headers: auth(),
        payload: { logo: PNG_URI },
      });

      expect(res.statusCode).toBe(200);
      expect(calls.set[0]).toMatchObject({ pdfLogo: PNG_URI });
      expect(res.json()).toMatchObject({ hasPdfLogo: true });
      expect(res.json()).not.toHaveProperty('pdfLogo');
      expect(writeAuditMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'invoiceIssuer:iis_rs',
          before: expect.objectContaining({ hasPdfLogo: false }),
          after: expect.objectContaining({ hasPdfLogo: true }),
          notes: 'PDF logo set',
        }),
        expect.anything(),
        expect.anything(),
      );
      const audit = (writeAuditMock.mock.calls[0] as unknown[])[1] as { after: object };
      expect(audit.after).not.toHaveProperty('pdfLogo');
    });

    it('refuses a logo that is not a PNG or SVG data URI with 400', async () => {
      for (const logo of ['', 'data:text/plain;base64,aGk=', 'data:image/png;base64,aGk=']) {
        const res = await app.inject({
          method: 'PUT',
          url: '/invoice-issuers/iis_rs/pdf-logo',
          headers: auth(),
          payload: { logo },
        });
        expect(res.statusCode).toBe(400);
      }
      expect(calls.set).toHaveLength(0);
    });

    it('removes the logo', async () => {
      setupDbResults([issuerRow({ pdfLogo: PNG_URI })], [issuerRow()], [], []);
      const res = await app.inject({
        method: 'DELETE',
        url: '/invoice-issuers/iis_rs/pdf-logo',
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      expect(calls.set[0]).toMatchObject({ pdfLogo: null });
      expect(res.json()).toMatchObject({ hasPdfLogo: false });
      expect(writeAuditMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ notes: 'PDF logo removed' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('answers 404 when setting the logo of an unknown issuer', async () => {
      setupDbResults([]);
      const res = await app.inject({
        method: 'PUT',
        url: '/invoice-issuers/iis_x/pdf-logo',
        headers: auth(),
        payload: { logo: PNG_URI },
      });

      expect(res.statusCode).toBe(404);
      expect(writeAuditMock).not.toHaveBeenCalled();
    });

    it('refuses a site-restricted user with 404', async () => {
      setMockUserSiteIds(['sit_a']);
      const res = await app.inject({
        method: 'GET',
        url: '/invoice-issuers/iis_rs/pdf-logo',
        headers: auth(),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

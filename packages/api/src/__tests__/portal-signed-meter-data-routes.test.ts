// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// DB mock helpers: each awaited query returns the next result.
let dbResults: unknown[][] = [];
let dbCallIndex = 0;
function setupDbResults(...results: unknown[][]) {
  dbResults = results;
  dbCallIndex = 0;
}
function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'leftJoin']) {
    chain[m] = vi.fn(() => chain);
  }
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

vi.mock('@evtivity/database', async () => ({
  ...(await import('./helpers/conformance-station-mocks.js')).conformanceStationMocks(),
  db: { select: vi.fn(() => makeChain()) },
  chargingSessions: {},
  meterPublicKeys: {},
  signedMeterValues: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));

import { registerAuth } from '../plugins/auth.js';
import { portalSignedMeterDataRoutes } from '../routes/portal/signed-meter-data.js';

const DRIVER_ID = 'drv_000000000001';
const SESSION_ID = 'ses_000000000001';

const KEBA_RECORD =
  'OCMF|{"FV":"1.1","GI":"KEBA_KCP30","GS":"12345678","PG":"T116","RD":[' +
  '{"TM":"2026-09-20T12:56:51,000+0200 I","TX":"B","RV":2866.7280,"RI":"1-b:1.8.0","RU":"kWh"},' +
  '{"TM":"2026-09-21T07:48:48,000+0200 I","TX":"E","RV":2908.2472,"RI":"1-b:1.8.0","RU":"kWh"}' +
  ']}|{"SD":"3046"}';
const KEBA_KEY = '3059301306072a8648ce3d020106082a8648ce3d03010703420004aabb';

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    timestamp: new Date('2026-09-21T05:48:48Z'),
    context: 'Transaction.End',
    encodingMethod: 'OCMF',
    signedData: KEBA_RECORD,
    transactionId: '4',
    inlinePublicKey: null,
    meterPublicKey: KEBA_KEY,
    keyMeterSerial: 'MTR-1',
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerAuth(app);
  await app.register(portalSignedMeterDataRoutes);
  await app.ready();
  return app;
}

describe('Portal signed meter data routes', () => {
  let app: FastifyInstance;
  let driverToken: string;

  beforeAll(async () => {
    app = await buildApp();
    driverToken = app.jwt.sign({ driverId: DRIVER_ID, type: 'driver' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    setupDbResults();
  });

  describe('GET /portal/sessions/:id/signed-meter-data', () => {
    it('returns 401 without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("answers 404 for another driver's or an unknown session", async () => {
      setupDbResults([]);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('SESSION_NOT_FOUND');
    });

    it('lists the records with their OCMF readings', async () => {
      setupDbResults([{ id: SESSION_ID }], [recordRow()]);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.statusCode).toBe(200);
      const [record] = response.json().data;
      expect(record).toMatchObject({
        id: 7,
        context: 'Transaction.End',
        encodingMethod: 'OCMF',
        pagination: 'T116',
        meterSerial: 'MTR-1',
        hasPublicKey: true,
      });
      expect(record.readings).toEqual([
        {
          type: 'B',
          time: '2026-09-20T12:56:51,000+0200 I',
          at: '2026-09-20T10:56:51.000Z',
          value: '2866.7280',
          unit: 'kWh',
          obis: '1-b:1.8.0',
        },
        {
          type: 'E',
          time: '2026-09-21T07:48:48,000+0200 I',
          at: '2026-09-21T05:48:48.000Z',
          value: '2908.2472',
          unit: 'kWh',
          obis: '1-b:1.8.0',
        },
      ]);
    });

    it('returns an empty list for a session without signed data', async () => {
      setupDbResults([{ id: SESSION_ID }], []);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });

    it('passes a record that is not OCMF on without readings', async () => {
      setupDbResults(
        [{ id: SESSION_ID }],
        [recordRow({ signedData: 'EDL40...', encodingMethod: null, meterPublicKey: null })],
      );
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      const [record] = response.json().data;
      expect(record).toMatchObject({
        encodingMethod: null,
        pagination: null,
        hasPublicKey: false,
        readings: [],
      });
    });
  });

  describe('GET /portal/sessions/:id/signed-meter-data/xml', () => {
    it('streams the transparency software XML with the meter key', async () => {
      setupDbResults([{ id: SESSION_ID }], [recordRow()]);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data/xml`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/xml; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="signed-meter-data-${SESSION_ID}.xml"`,
      );
      expect(response.body).toContain('<value transactionId="4" context="Transaction.End">');
      expect(response.body).toContain(`<publicKey encoding="hex">${KEBA_KEY}</publicKey>`);
      expect(response.body).toContain('<signedData format="OCMF" encoding="plain">OCMF|');
    });

    it('prefers the key sent with the value (OCPP 2.x)', async () => {
      setupDbResults([{ id: SESSION_ID }], [recordRow({ inlinePublicKey: 'MFkwEw==' })]);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data/xml`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.body).toContain('<publicKey encoding="base64">MFkwEw==</publicKey>');
    });

    it('answers 404 for a session without signed data', async () => {
      setupDbResults([{ id: SESSION_ID }], []);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data/xml`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.statusCode).toBe(404);
    });

    it("answers 404 for another driver's session", async () => {
      setupDbResults([]);
      const response = await app.inject({
        method: 'GET',
        url: `/portal/sessions/${SESSION_ID}/signed-meter-data/xml`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('SESSION_NOT_FOUND');
    });
  });
});

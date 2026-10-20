// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, chargingSessions, meterPublicKeys, signedMeterValues } from '@evtivity/database';
import { parseOcmf, signedMeterDataXml } from '@evtivity/lib';
import { zodSchema } from '../../lib/zod-schema.js';
import { ID_PARAMS } from '../../lib/id-validation.js';
import { itemResponse, errorWith } from '../../lib/response-schemas.js';
import { ERROR_CODES } from '../../lib/error-codes.generated.js';
import type { DriverJwtPayload } from '../../plugins/auth.js';

// The signed meter data of a driver's session (German calibration law), to
// check the bill with the transparency software. The records are passed on
// as the station signed them; their signature is not verified here.

const sessionParams = z.object({ id: ID_PARAMS.sessionId.describe('Session ID') });

const readingItem = z
  .object({
    type: z.string().nullable().describe('OCMF TX: B (begin), E (end), C, X, L, R, A, T, S'),
    time: z.string().describe('OCMF TM as signed, with UTC offset and time status'),
    at: z.string().nullable().describe('OCMF TM as an ISO 8601 timestamp; null when unreadable'),
    value: z.string().describe('OCMF RV with all signed digits'),
    unit: z.string().nullable().describe('OCMF RU, e.g. kWh'),
    obis: z.string().nullable().describe('OCMF RI, the OBIS code of the reading'),
  })
  .passthrough();

const signedMeterDataItem = z
  .object({
    id: z.number().int().describe('Signed meter value ID'),
    timestamp: z.coerce.date().describe('Timestamp of the sample the record came with'),
    context: z.string().nullable().describe('OCPP context, e.g. Transaction.End'),
    encodingMethod: z.string().nullable().describe('Format of the record, e.g. OCMF'),
    pagination: z.string().nullable().describe('OCMF PG: record number of the meter'),
    meterSerial: z
      .string()
      .nullable()
      .describe('OCMF MS, else the serial the station announced with the meter key'),
    hasPublicKey: z.boolean().describe('The meter key is known and goes into the download'),
    readings: z.array(readingItem).describe('Readings of an OCMF record; empty for other formats'),
  })
  .passthrough();

async function loadRecords(
  driverId: string,
  sessionId: string,
): Promise<Array<{
  id: number;
  timestamp: Date;
  context: string | null;
  encodingMethod: string | null;
  signedData: string;
  transactionId: string | null;
  publicKey: string | null;
  keyMeterSerial: string | null;
}> | null> {
  // Another driver's session answers 404 like an unknown one.
  const [session] = await db
    .select({ id: chargingSessions.id })
    .from(chargingSessions)
    .where(and(eq(chargingSessions.id, sessionId), eq(chargingSessions.driverId, driverId)));
  if (session == null) return null;
  const rows = await db
    .select({
      id: signedMeterValues.id,
      timestamp: signedMeterValues.timestamp,
      context: signedMeterValues.context,
      encodingMethod: signedMeterValues.encodingMethod,
      signedData: signedMeterValues.signedData,
      transactionId: signedMeterValues.transactionId,
      inlinePublicKey: signedMeterValues.publicKey,
      meterPublicKey: meterPublicKeys.publicKey,
      keyMeterSerial: meterPublicKeys.meterSerial,
    })
    .from(signedMeterValues)
    .leftJoin(meterPublicKeys, eq(signedMeterValues.meterPublicKeyId, meterPublicKeys.id))
    .where(eq(signedMeterValues.sessionId, sessionId))
    .orderBy(signedMeterValues.timestamp, signedMeterValues.id);
  return rows.map(({ inlinePublicKey, meterPublicKey, ...row }) => ({
    ...row,
    // OCPP 2.x may send the key with the value; a 1.6 station announces it once.
    publicKey: inlinePublicKey ?? meterPublicKey,
  }));
}

async function sessionNotFound(reply: FastifyReply): Promise<void> {
  await reply.status(404).send({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
}

export function portalSignedMeterDataRoutes(app: FastifyInstance): void {
  app.get(
    '/portal/sessions/:id/signed-meter-data',
    {
      onRequest: [app.authenticateDriver],
      schema: {
        tags: ['Portal Sessions'],
        summary: 'List the signed meter data of a session',
        description:
          'The records the station signed for the session (calibration law), with the readings of OCMF records. Empty when the station signs no meter data.',
        operationId: 'portalListSessionSignedMeterData',
        security: [{ bearerAuth: [] }],
        params: zodSchema(sessionParams),
        response: {
          200: itemResponse(
            z
              .object({ data: z.array(signedMeterDataItem).describe('Records in time order') })
              .passthrough(),
          ),
          404: errorWith('Session not found', [ERROR_CODES.SESSION_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      const { driverId } = request.user as DriverJwtPayload;
      const { id } = request.params as z.infer<typeof sessionParams>;
      const records = await loadRecords(driverId, id);
      if (records == null) {
        await sessionNotFound(reply);
        return;
      }
      return {
        data: records.map((record) => {
          const ocmf = parseOcmf(record.signedData);
          return {
            id: record.id,
            timestamp: record.timestamp,
            context: record.context,
            encodingMethod: record.encodingMethod ?? (ocmf != null ? 'OCMF' : null),
            pagination: ocmf?.pagination ?? null,
            meterSerial: ocmf?.meterSerial ?? record.keyMeterSerial,
            hasPublicKey: record.publicKey != null && record.publicKey !== '',
            readings: (ocmf?.readings ?? []).map((reading) => ({
              type: reading.type,
              time: reading.time,
              at: reading.at?.toISOString() ?? null,
              value: reading.value,
              unit: reading.unit,
              obis: reading.obis,
            })),
          };
        }),
      };
    },
  );

  app.get(
    '/portal/sessions/:id/signed-meter-data/xml',
    {
      onRequest: [app.authenticateDriver],
      schema: {
        tags: ['Portal Sessions'],
        summary: 'Download the signed meter data of a session for the transparency software',
        description:
          'The signed records of the session with the meter key, as the XML file the S.A.F.E. transparency software opens (values.xsd). Streams application/xml as an attachment. A session without signed meter data answers 404 like an unknown one.',
        operationId: 'portalDownloadSessionSignedMeterData',
        security: [{ bearerAuth: [] }],
        params: zodSchema(sessionParams),
        response: { 404: errorWith('Session not found', [ERROR_CODES.SESSION_NOT_FOUND]) },
      },
    },
    async (request, reply) => {
      const { driverId } = request.user as DriverJwtPayload;
      const { id } = request.params as z.infer<typeof sessionParams>;
      const records = await loadRecords(driverId, id);
      if (records == null || records.length === 0) {
        await sessionNotFound(reply);
        return;
      }
      await reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="signed-meter-data-${id}.xml"`)
        .send(signedMeterDataXml(records));
    },
  );
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@evtivity/database';
import { drivers, driverTokens } from '@evtivity/database';
import type { PaymentMode } from '@evtivity/database';
import * as tokenService from './token.service.js';

export async function listDrivers() {
  return db.select().from(drivers).orderBy(desc(drivers.createdAt));
}

export async function getDriver(id: string) {
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, id));
  return driver ?? null;
}

export async function createDriver(data: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}) {
  const [driver] = await db.insert(drivers).values(data).returning();
  return driver;
}

export async function updateDriver(
  id: string,
  data: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    isActive?: boolean;
  },
) {
  const [driver] = await db
    .update(drivers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(drivers.id, id))
    .returning();
  return driver ?? null;
}

export async function getDriverTokens(driverId: string) {
  return db.select().from(driverTokens).where(eq(driverTokens.driverId, driverId));
}

// Both functions delegate to tokenService so audit + driver notification +
// reactive local-auth invalidation always fire, matching every other token
// mutation path. The system actor is used here because callers (legacy seed,
// test fixtures) don't carry a user/driver context. Real interactive flows
// should call tokenService directly with the right actor.
export async function createDriverToken(
  driverId: string,
  data: { idToken: string; tokenType: string },
) {
  return tokenService.createToken(
    { driverId, idToken: data.idToken, tokenType: data.tokenType },
    { type: 'system' },
  );
}

export async function deactivateDriverToken(tokenId: string) {
  return tokenService.updateToken(
    tokenId,
    { isActive: false, revokedReason: 'Deactivated via driver service' },
    { type: 'system' },
  );
}

/**
 * Resolve how a driver pays for charging: driver > fleet > 'card'.
 *
 * A driver-level payment_mode overrides the fleet. fleet_drivers has no unique
 * constraint on driverId, so among the driver's fleets that set a mode the
 * oldest membership wins, mirroring resolveTariffGroup() in tariff.service.ts.
 *
 * The OCPP payment gate (packages/ocpp/src/server/event-projections.ts)
 * inlines the same query; keep both in sync.
 */
export async function resolvePaymentMode(driverId: string): Promise<PaymentMode> {
  const rows = await db.execute<{ payment_mode: PaymentMode }>(sql`
    WITH driver_mode AS (
      SELECT d.payment_mode, 1 AS priority
      FROM drivers d
      WHERE d.id = ${driverId} AND d.payment_mode IS NOT NULL
    ),
    fleet_mode AS (
      SELECT f.payment_mode, 2 AS priority
      FROM fleet_drivers fd
      JOIN fleets f ON f.id = fd.fleet_id
      WHERE fd.driver_id = ${driverId} AND f.payment_mode IS NOT NULL
      ORDER BY fd.created_at ASC
      LIMIT 1
    )
    SELECT payment_mode FROM (
      SELECT payment_mode, priority FROM driver_mode
      UNION ALL SELECT payment_mode, priority FROM fleet_mode
    ) modes
    ORDER BY priority
    LIMIT 1
  `);
  return rows[0]?.payment_mode ?? 'card';
}

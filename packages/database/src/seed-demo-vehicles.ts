// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The color and body type of the demo vehicles, so the 3D site layout shows a
// varied mix of cars. Demo data only: vehicles of the demo drivers
// (`DEMO_DRIVER_EMAIL_SQL`, the reserved example domains). The body type
// follows the model, the color comes from a fixed mix by the vehicle id, so a
// rerun picks the same look.
//
// The vehicle writer is `vehicle.service.ts` in the API, which the database
// package cannot import; this seed writes a demo vehicle only while it has
// neither a color nor a body type, so a rerun, a driver's own choice and an
// operator's change stay. Each write is audited like the service's
// (`vehicle_audit_log`, `updated`). Sessions of a demo driver with exactly
// one vehicle that name no vehicle are linked to it (the layout draws the
// session's vehicle first).

import type postgres from 'postgres';
import type { VehicleBodyType, VehicleColor } from '@evtivity/lib/vehicle-appearance';
import { writeAudit } from './lib/audit.js';
import { vehicleAuditLog } from './schema/audit.js';
import { DEMO_DRIVER_EMAIL_SQL } from './seed-demo-avatars.js';

/** The body type of every demo model (seed.ts EV_MAKES and the fleet depot vehicles). */
export const DEMO_MODEL_BODY_TYPES: Readonly<Record<string, VehicleBodyType>> = {
  'Model 3': 'sedan',
  'Model S': 'sedan',
  'Ioniq 6': 'sedan',
  i4: 'sedan',
  i7: 'sedan',
  EQS: 'sedan',
  EQE: 'sedan',
  'Bolt EV': 'hatchback',
  Leaf: 'hatchback',
  'Kona Electric': 'hatchback',
  'Model Y': 'suv',
  'Model X': 'suv',
  'Bolt EUV': 'suv',
  'Equinox EV': 'suv',
  'Mustang Mach-E': 'suv',
  'Ioniq 5': 'suv',
  EV6: 'suv',
  EV9: 'suv',
  'Niro EV': 'suv',
  iX: 'suv',
  EQB: 'suv',
  'ID.4': 'suv',
  R1S: 'suv',
  Ariya: 'suv',
  'F-150 Lightning': 'pickup_truck',
  'Silverado EV': 'pickup_truck',
  R1T: 'pickup_truck',
  'ID.Buzz': 'van',
  'E-Transit': 'van',
  eSprinter: 'van',
  // The fleet depot demo (seed-demo-layout-plan.ts LAYOUT_DEMO.fleet).
  eM2: 'box_truck',
  'Xcelsior CHARGE NG': 'bus',
  'Low Floor Battery Electric': 'bus',
  'LFSe+': 'bus',
  eCascadia: 'semi_truck',
  'VNR Electric': 'semi_truck',
  Semi: 'semi_truck',
};

// Paint shares close to new car surveys: white, black, grey and silver lead.
const COLOR_MIX: readonly VehicleColor[] = [
  'white',
  'black',
  'grey',
  'white',
  'silver',
  'blue',
  'black',
  'red',
  'grey',
  'white',
  'green',
  'silver',
  'brown_beige',
  'blue',
  'yellow_orange',
  'black',
  'red',
  'other',
];

/** A stable number from a string (the vehicle or driver id). */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** The look of a demo vehicle: the body type of its model, a color from the mix. */
export function demoVehicleLook(
  model: string | null,
  key: string,
): { color: VehicleColor; bodyType: VehicleBodyType } {
  return {
    color: COLOR_MIX[hash(key) % COLOR_MIX.length] ?? 'white',
    bodyType: (model != null ? DEMO_MODEL_BODY_TYPES[model] : undefined) ?? 'sedan',
  };
}

/**
 * Gives every demo driver's vehicle without a color and body type its demo
 * look, and links the demo sessions without a vehicle to the driver's only
 * vehicle. Returns the vehicles written and the sessions linked.
 */
export async function seedDemoVehicleLooks(
  sql: postgres.Sql,
  actorUserId: string | null,
): Promise<{ vehicles: number; sessions: number }> {
  const rows = await sql<Array<{ id: string; model: string | null }>>`
    SELECT v.id, v.model FROM vehicles v JOIN drivers d ON d.id = v.driver_id
    WHERE v.color IS NULL AND v.body_type IS NULL
      AND d.erased_at IS NULL AND d.email IS NOT NULL
      AND ${sql.unsafe(DEMO_DRIVER_EMAIL_SQL.replaceAll('email', 'd.email'))}
    ORDER BY v.id
  `;
  let written = 0;
  for (const row of rows) {
    const look = demoVehicleLook(row.model, row.id);
    const updated = await sql`
      UPDATE vehicles SET color = ${look.color}, body_type = ${look.bodyType}, updated_at = now()
      WHERE id = ${row.id} AND color IS NULL AND body_type IS NULL
      RETURNING id
    `;
    if (updated.length === 0) continue;
    written++;
    await writeAudit(
      { table: vehicleAuditLog, idColumn: 'vehicle_id' },
      {
        entityId: row.id,
        entityIdSnapshot: row.id,
        action: 'updated',
        actor: actorUserId != null ? 'operator' : 'system',
        actorUserId,
        before: { color: null, bodyType: null },
        after: look,
        notes: 'Demo data: vehicle color and body type',
      },
    );
  }
  const linked = await sql`
    UPDATE charging_sessions AS cs SET vehicle_id = sole.id
    FROM (
      SELECT v.driver_id, min(v.id) AS id FROM vehicles v JOIN drivers d ON d.id = v.driver_id
      WHERE d.email IS NOT NULL AND ${sql.unsafe(DEMO_DRIVER_EMAIL_SQL.replaceAll('email', 'd.email'))}
      GROUP BY v.driver_id HAVING count(*) = 1
    ) AS sole
    WHERE cs.vehicle_id IS NULL AND cs.driver_id = sole.driver_id
  `;
  return { vehicles: written, sessions: linked.count };
}

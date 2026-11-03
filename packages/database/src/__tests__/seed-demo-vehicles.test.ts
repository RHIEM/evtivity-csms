// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import { VEHICLE_BODY_TYPES, isVehicleColor } from '@evtivity/lib/vehicle-appearance';
import { DEMO_MODEL_BODY_TYPES, demoVehicleLook } from '../seed-demo-vehicles.js';

describe('demo vehicle looks', () => {
  it('gives each demo model its real body type, a sedan to an unknown one', () => {
    expect(demoVehicleLook('Model 3', 'a').bodyType).toBe('sedan');
    expect(demoVehicleLook('F-150 Lightning', 'a').bodyType).toBe('pickup_truck');
    expect(demoVehicleLook('ID.Buzz', 'a').bodyType).toBe('van');
    expect(demoVehicleLook('Leaf', 'a').bodyType).toBe('hatchback');
    expect(demoVehicleLook('Model Y', 'a').bodyType).toBe('suv');
    expect(demoVehicleLook('Unknown', 'a').bodyType).toBe('sedan');
    expect(demoVehicleLook(null, 'a').bodyType).toBe('sedan');
  });

  it('covers every body type', () => {
    expect(new Set(Object.values(DEMO_MODEL_BODY_TYPES))).toEqual(new Set(VEHICLE_BODY_TYPES));
  });

  it('picks the same color for the same key and a varied mix across keys', () => {
    expect(demoVehicleLook('EV6', 'drv_1').color).toBe(demoVehicleLook('EV6', 'drv_1').color);
    const colors = new Set(
      Array.from({ length: 120 }, (_, i) => demoVehicleLook('EV6', `drv_${String(i)}`).color),
    );
    expect(colors.size).toBeGreaterThanOrEqual(8);
    for (const c of colors) expect(isVehicleColor(c)).toBe(true);
  });
});

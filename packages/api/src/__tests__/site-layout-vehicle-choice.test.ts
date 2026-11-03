// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it, vi } from 'vitest';

vi.mock('@evtivity/database', () => ({
  db: {},
  chargingSessions: {},
  drivers: {},
  vehicles: {},
}));
vi.mock('../services/account-avatar.js', () => ({ withAvatars: vi.fn() }));

import { chooseLayoutVehicle } from '../lib/site-layout-sessions.js';

type Look = {
  id: string;
  driverId: string;
  color: 'red' | 'blue' | 'white' | null;
  bodyType: 'suv' | 'van' | 'sedan' | null;
};

function maps(list: Look[], lastUsed: [string, string][] = []) {
  const byId = new Map(list.map((v) => [v.id, v]));
  const byDriver = new Map<string, Look[]>();
  for (const v of list) byDriver.set(v.driverId, [...(byDriver.get(v.driverId) ?? []), v]);
  return [byId, byDriver, new Map(lastUsed)] as const;
}

describe('chooseLayoutVehicle', () => {
  const red: Look = { id: 'veh_1', driverId: 'drv_1', color: 'red', bodyType: 'suv' };
  const blue: Look = { id: 'veh_2', driverId: 'drv_1', color: 'blue', bodyType: 'van' };

  it("draws the session's own vehicle first", () => {
    const [a, b, c] = maps([red, blue], [['drv_1', 'veh_1']]);
    expect(chooseLayoutVehicle({ vehicleId: 'veh_2', driverId: 'drv_1' }, a, b, c)).toEqual({
      color: 'blue',
      bodyType: 'van',
    });
  });

  it("draws the driver's only vehicle when the session names none", () => {
    const [a, b, c] = maps([red]);
    expect(chooseLayoutVehicle({ vehicleId: null, driverId: 'drv_1' }, a, b, c)).toEqual({
      color: 'red',
      bodyType: 'suv',
    });
  });

  it("draws the driver's most recently used vehicle among several", () => {
    const [a, b, c] = maps([red, blue], [['drv_1', 'veh_2']]);
    expect(chooseLayoutVehicle({ vehicleId: null, driverId: 'drv_1' }, a, b, c)?.color).toBe(
      'blue',
    );
  });

  it('draws none for several vehicles never used, no driver, or a removed vehicle', () => {
    const [a, b, c] = maps([red, blue]);
    expect(chooseLayoutVehicle({ vehicleId: null, driverId: 'drv_1' }, a, b, c)).toBeNull();
    expect(chooseLayoutVehicle({ vehicleId: null, driverId: null }, a, b, c)).toBeNull();
    const [d, e, f] = maps([]);
    expect(chooseLayoutVehicle({ vehicleId: 'veh_9', driverId: 'drv_2' }, d, e, f)).toBeNull();
  });

  it('keeps a vehicle without a color or body type as nulls', () => {
    const plain: Look = { id: 'veh_3', driverId: 'drv_3', color: null, bodyType: null };
    const [a, b, c] = maps([plain]);
    expect(chooseLayoutVehicle({ vehicleId: 'veh_3', driverId: 'drv_3' }, a, b, c)).toEqual({
      color: null,
      bodyType: null,
    });
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VEHICLE_BODY_TYPE,
  DEFAULT_VEHICLE_COLOR,
  VEHICLE_BODY_TYPES,
  VEHICLE_BODY_TYPE_LABELS,
  VEHICLE_COLORS,
  VEHICLE_COLOR_HEX,
  VEHICLE_COLOR_LABELS,
  isVehicleBodyType,
  isVehicleColor,
  vehicleColorHex,
} from '../vehicle-appearance.js';

describe('vehicle appearance', () => {
  it('lists the ten colors and eight body types the database allows', () => {
    expect(VEHICLE_COLORS).toEqual([
      'white',
      'black',
      'silver',
      'grey',
      'blue',
      'red',
      'green',
      'brown_beige',
      'yellow_orange',
      'other',
    ]);
    expect(VEHICLE_BODY_TYPES).toEqual([
      'sedan',
      'hatchback',
      'suv',
      'pickup_truck',
      'van',
      'box_truck',
      'bus',
      'semi_truck',
    ]);
  });

  it('has a label and a paint for every value', () => {
    for (const c of VEHICLE_COLORS) {
      expect(VEHICLE_COLOR_LABELS[c]).toBeTruthy();
      expect(VEHICLE_COLOR_HEX[c]).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const b of VEHICLE_BODY_TYPES) expect(VEHICLE_BODY_TYPE_LABELS[b]).toBeTruthy();
  });

  it('checks values', () => {
    expect(isVehicleColor('blue')).toBe(true);
    expect(isVehicleColor('Blue')).toBe(false);
    expect(isVehicleColor(null)).toBe(false);
    expect(isVehicleBodyType('pickup_truck')).toBe(true);
    expect(isVehicleBodyType('truck')).toBe(false);
  });

  it('paints null and unknown colors in the default grey', () => {
    expect(DEFAULT_VEHICLE_COLOR).toBe('grey');
    expect(DEFAULT_VEHICLE_BODY_TYPE).toBe('sedan');
    expect(vehicleColorHex('red')).toBe(VEHICLE_COLOR_HEX.red);
    expect(vehicleColorHex(null)).toBe(VEHICLE_COLOR_HEX.grey);
    expect(vehicleColorHex('magenta')).toBe(VEHICLE_COLOR_HEX.grey);
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_COLOR_HEX } from '@evtivity/lib/vehicle-appearance';
import {
  CAR_BODY_TYPES,
  LARGE_BODY_TYPES,
  LARGE_VEHICLE_SPECS,
  isLargeBodyType,
  sceneCar,
  vehicleSize,
} from '../site-layout-car';
import type { CarMaterials } from '../site-layout-car-geometry';
import { createVehicleKit } from '../site-layout-vehicle-kit';

function materials(color = '#ff0000'): CarMaterials {
  const m = (name: string, c = '#888888') => {
    const mat = new THREE.MeshStandardMaterial({ color: c });
    mat.name = name;
    return mat;
  };
  return {
    paint: m('paint', color),
    glass: m('glass'),
    tire: m('tire'),
    rim: m('rim'),
    trim: m('trim'),
    headlight: m('headlight'),
    taillight: m('taillight'),
    chargePort: m('chargePort'),
    panel: m('panel', '#eeeeee'),
  };
}

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

describe('large body types', () => {
  it('splits the body types into cars and large vehicles', () => {
    expect([...LARGE_BODY_TYPES]).toEqual(['box_truck', 'bus', 'semi_truck']);
    expect(CAR_BODY_TYPES).toEqual(['sedan', 'hatchback', 'suv', 'pickup_truck', 'van']);
    expect(isLargeBodyType('bus')).toBe(true);
    expect(isLargeBodyType('van')).toBe(false);
  });

  it('draws the default of the spot when the session names no vehicle', () => {
    expect(sceneCar(null, 'bus')).toEqual({ bodyType: 'bus', color: VEHICLE_COLOR_HEX.grey });
    expect(sceneCar({ color: 'red', bodyType: null }, 'semi_truck')).toEqual({
      bodyType: 'semi_truck',
      color: VEHICLE_COLOR_HEX.red,
    });
    // A known vehicle wins over the spot default.
    expect(sceneCar({ color: 'white', bodyType: 'box_truck' }, 'bus').bodyType).toBe('box_truck');
  });

  it('knows the real size of every body type', () => {
    expect(vehicleSize('bus')).toEqual({ length: 12.14, width: 2.55, height: 3.4 });
    expect(vehicleSize('semi_truck').length).toBeCloseTo(21.24, 2);
    expect(vehicleSize('box_truck').length).toBeCloseTo(9.93, 2);
    expect(vehicleSize('sedan').length).toBe(4.7);
  });

  it('places the axles and inlets of the real vehicles', () => {
    const axles = (bodyType: (typeof LARGE_BODY_TYPES)[number]) =>
      LARGE_VEHICLE_SPECS[bodyType].axles.map((a) => a.z);
    // eCitaro: 5.9 m wheelbase. eM2: 270 in. eCascadia 6x4: 190 in to the middle of the tandem.
    const [busFront, busRear] = axles('bus');
    expect(busRear! - busFront!).toBeCloseTo(5.9, 2);
    const [boxFront, boxRear] = axles('box_truck');
    expect(boxRear! - boxFront!).toBeCloseTo(6.86, 2);
    const [steer, drive1, drive2, trailer1, trailer2] = axles('semi_truck');
    expect((drive1! + drive2!) / 2 - steer!).toBeCloseTo(4.83, 2);
    // A 53 ft trailer, its kingpin 36 in from its front, the tandem within 40 ft of the kingpin.
    const trailerFront = LARGE_VEHICLE_SPECS.semi_truck.length - 16.15;
    expect(trailer2! - (trailerFront + 0.91)).toBeLessThan(12.19 + 1e-9);
    expect(trailer1).toBeLessThan(trailer2!);
    // The spec sheets: eCascadia 10 ft 10 in, eM2 11 ft from the nose to the charge inlet.
    expect(LARGE_VEHICLE_SPECS.semi_truck.port.z).toBeCloseTo(3.3, 2);
    expect(LARGE_VEHICLE_SPECS.box_truck.port.z).toBeCloseTo(3.35, 2);
  });
});

describe('large vehicle kits', () => {
  it.each(LARGE_BODY_TYPES)('builds a %s at its real size, nose at z = 0', (bodyType) => {
    const spec = LARGE_VEHICLE_SPECS[bodyType];
    const vehicle = createVehicleKit(bodyType).build(materials());
    vehicle.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vehicle);
    const size = box.getSize(new THREE.Vector3());
    // Mirrors stick out past the body width, at most 0.6 m in all (a truck is about 3.1 m over its mirrors).
    expect(size.x).toBeGreaterThan(spec.width - 0.01);
    expect(size.x).toBeLessThan(spec.width + 0.6);
    expect(size.z).toBeGreaterThan(spec.length - 0.05);
    expect(size.z).toBeLessThan(spec.length + 0.6);
    expect(box.min.z).toBeGreaterThan(-0.6);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.y).toBeGreaterThan(spec.height - 0.1);
    expect(box.max.y).toBeLessThan(spec.height + 0.1);
  });

  it('puts the charge inlet on the left side at its distance from the nose', () => {
    for (const bodyType of LARGE_BODY_TYPES) {
      const kit = createVehicleKit(bodyType);
      const spec = LARGE_VEHICLE_SPECS[bodyType];
      expect(kit.port.x, bodyType).toBeLessThan(0);
      expect(kit.port.z, bodyType).toBe(spec.port.z);
      expect(kit.port.y, bodyType).toBe(spec.port.y);
    }
    // CharIN MCS: the inlet of a truck 2 to 4.8 m behind the front.
    expect(LARGE_VEHICLE_SPECS.semi_truck.port.z).toBeGreaterThanOrEqual(2);
    expect(LARGE_VEHICLE_SPECS.semi_truck.port.z).toBeLessThanOrEqual(4.8);
  });

  it('gives the bus its pantograph contact rails on the roof above the front axle', () => {
    const kit = createVehicleKit('bus');
    const front = LARGE_VEHICLE_SPECS.bus.axles[0]!.z;
    expect(kit.roofContact).toBeDefined();
    expect(kit.roofContact!.z).toBeCloseTo(front, 5);
    expect(kit.roofContact!.y).toBeGreaterThan(3.2);
    expect(createVehicleKit('semi_truck').roofContact).toBeUndefined();
  });

  it('draws dual tires on the drive and trailer axles', () => {
    const tireCount = (bodyType: (typeof LARGE_BODY_TYPES)[number]) =>
      LARGE_VEHICLE_SPECS[bodyType].axles.reduce((n, a) => n + (a.dual ? 4 : 2), 0);
    expect(tireCount('box_truck')).toBe(6);
    expect(tireCount('bus')).toBe(6);
    expect(tireCount('semi_truck')).toBe(18);
  });

  it('shares the kit geometries and tints only the paint (the trailer stays white)', () => {
    const kit = createVehicleKit('semi_truck');
    const red = meshes(kit.build(materials('#ff0000')));
    const blue = meshes(kit.build(materials('#0000ff')));
    expect(red.map((m) => m.geometry)).toEqual(blue.map((m) => m.geometry));
    expect(red.map((m) => (m.material as THREE.Material).name)).toContain('panel');
    const panel = red.find((m) => (m.material as THREE.Material).name === 'panel')!;
    panel.geometry.computeBoundingBox();
    // The trailer van body runs to the back of the vehicle.
    expect(panel.geometry.boundingBox!.max.z).toBeGreaterThan(
      LARGE_VEHICLE_SPECS.semi_truck.length - 0.1,
    );
    const paint = red.find((m) => (m.material as THREE.Material).name === 'paint')!;
    paint.geometry.computeBoundingBox();
    // The paint is the tractor only, in front of the trailer's back.
    expect(paint.geometry.boundingBox!.max.z).toBeLessThan(8);
  });
});

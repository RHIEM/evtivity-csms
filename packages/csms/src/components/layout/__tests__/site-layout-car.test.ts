// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_COLOR_HEX } from '@evtivity/lib/vehicle-appearance';
import { CAR_BODY_TYPES, CAR_PROFILES, carRoofHeight, sceneCar } from '../site-layout-car';
import { createCarKit, type CarMaterials } from '../site-layout-car-geometry';

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
    panel: m('panel'),
  };
}

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

describe('sceneCar', () => {
  it('draws the vehicle body type in its paint', () => {
    expect(sceneCar({ color: 'red', bodyType: 'pickup_truck' })).toEqual({
      bodyType: 'pickup_truck',
      color: VEHICLE_COLOR_HEX.red,
    });
  });

  it('draws a grey sedan without a vehicle, color or known body type', () => {
    const grey = { bodyType: 'sedan', color: VEHICLE_COLOR_HEX.grey };
    expect(sceneCar(null)).toEqual(grey);
    expect(sceneCar(undefined)).toEqual(grey);
    expect(sceneCar({ color: null, bodyType: null })).toEqual(grey);
    expect(sceneCar({ color: 'purple', bodyType: 'tank' })).toEqual(grey);
    expect(sceneCar({ color: 'blue', bodyType: null })).toEqual({
      bodyType: 'sedan',
      color: VEHICLE_COLOR_HEX.blue,
    });
  });
});

describe('car kits', () => {
  it.each(CAR_BODY_TYPES)('builds a %s at its real size, nose at z = 0', (bodyType) => {
    const p = CAR_PROFILES[bodyType];
    const car = createCarKit(bodyType).build(materials());
    car.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(car);
    const size = box.getSize(new THREE.Vector3());
    // The mirrors stick out past the body width.
    expect(size.x).toBeGreaterThan(p.width);
    expect(size.x).toBeLessThan(p.width + 0.35);
    expect(size.z).toBeCloseTo(p.length, 1);
    expect(box.min.z).toBeGreaterThan(-0.05);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.y).toBeCloseTo(carRoofHeight(p), 1);
    expect(carRoofHeight(p)).toBeCloseTo(p.height, 1);
  });

  it('puts the charge port on the front left fender at the port height', () => {
    for (const bodyType of CAR_BODY_TYPES) {
      const { port } = createCarKit(bodyType);
      const p = CAR_PROFILES[bodyType];
      expect(port.x).toBeLessThan(-p.width / 2 + 0.01);
      expect(port.y).toBe(p.portY);
      expect(port.z).toBeLessThan(p.frontAxle);
    }
  });

  it('draws a car as one mesh per material, sharing the geometries of the kit', () => {
    const kit = createCarKit('suv');
    const red = meshes(kit.build(materials('#ff0000')));
    const blue = meshes(kit.build(materials('#0000ff')));
    expect(red.map((m) => (m.material as THREE.Material).name)).toEqual([
      'paint',
      'glass',
      'tire',
      'rim',
      'trim',
      'headlight',
      'taillight',
      'chargePort',
    ]);
    expect(red.map((m) => m.geometry)).toEqual(blue.map((m) => m.geometry));
    expect([...kit.geometries]).toEqual(red.map((m) => m.geometry));
    expect((red[0]!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    expect((blue[0]!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('0000ff');
  });

  it('gives a pickup an open bed behind the cab', () => {
    const car = createCarKit('pickup_truck').build(materials());
    const trim = meshes(car).find((m) => (m.material as THREE.Material).name === 'trim')!;
    trim.geometry.computeBoundingBox();
    expect(trim.geometry.boundingBox!.max.z).toBeGreaterThan(
      CAR_PROFILES.pickup_truck.bed![1] - 0.05,
    );
  });
});

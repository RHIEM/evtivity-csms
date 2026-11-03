// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { TFunction } from 'i18next';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  VehicleAppearanceFields,
  vehicleAppearanceLabel,
  type VehicleAppearance,
} from '../VehicleAppearanceFields';

afterEach(() => {
  cleanup();
});

describe('VehicleAppearanceFields', () => {
  it('lists Not Set and every color and body type', () => {
    render(
      <VehicleAppearanceFields
        idPrefix="v"
        value={{ color: null, bodyType: null }}
        onChange={() => undefined}
      />,
    );
    const color = screen.getByLabelText<HTMLSelectElement>('vehicles.color');
    const body = screen.getByLabelText<HTMLSelectElement>('vehicles.bodyType');
    expect([...color.options].map((o) => o.value)).toEqual([
      '',
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
    expect([...body.options].map((o) => o.textContent)).toEqual([
      'vehicles.notSet',
      'vehicles.bodyTypes.sedan',
      'vehicles.bodyTypes.hatchback',
      'vehicles.bodyTypes.suv',
      'vehicles.bodyTypes.pickup_truck',
      'vehicles.bodyTypes.van',
      'vehicles.bodyTypes.box_truck',
      'vehicles.bodyTypes.bus',
      'vehicles.bodyTypes.semi_truck',
    ]);
  });

  it('reports a choice and Not Set as null', () => {
    const onChange = vi.fn<(next: VehicleAppearance) => void>();
    render(
      <VehicleAppearanceFields
        idPrefix="v"
        value={{ color: 'red', bodyType: 'suv' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>('vehicles.bodyType'), {
      target: { value: 'van' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ color: 'red', bodyType: 'van' });
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>('vehicles.color'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ color: null, bodyType: 'suv' });
  });

  it('labels stored values, n/a when not set', () => {
    const t = ((key: string) => `T:${key}`) as unknown as TFunction;
    expect(vehicleAppearanceLabel(t, 'colors', 'brown_beige')).toBe(
      'T:vehicles.colors.brown_beige',
    );
    expect(vehicleAppearanceLabel(t, 'bodyTypes', 'pickup_truck')).toBe(
      'T:vehicles.bodyTypes.pickup_truck',
    );
    expect(vehicleAppearanceLabel(t, 'colors', null)).toBe('n/a');
  });
});

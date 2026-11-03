// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  VEHICLE_BODY_TYPES,
  VEHICLE_COLORS,
  isVehicleBodyType,
  isVehicleColor,
  type VehicleBodyType,
  type VehicleColor,
} from '@evtivity/lib/vehicle-appearance';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export interface VehicleAppearance {
  color: VehicleColor | null;
  bodyType: VehicleBodyType | null;
}

/** The color and body type selects of the vehicle create and edit forms (empty is Not Set). */
export function VehicleAppearanceFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: VehicleAppearance;
  onChange: (next: VehicleAppearance) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-color`} className="leading-6">
          {t('vehicles.color')}
        </Label>
        <Select
          id={`${idPrefix}-color`}
          value={value.color ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...value, color: isVehicleColor(v) ? v : null });
          }}
        >
          <option value="">{t('vehicles.notSet')}</option>
          {VEHICLE_COLORS.map((c) => (
            <option key={c} value={c}>
              {t(`vehicles.colors.${c}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-body-type`} className="leading-6">
          {t('vehicles.bodyType')}
        </Label>
        <Select
          id={`${idPrefix}-body-type`}
          value={value.bodyType ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...value, bodyType: isVehicleBodyType(v) ? v : null });
          }}
        >
          <option value="">{t('vehicles.notSet')}</option>
          {VEHICLE_BODY_TYPES.map((b) => (
            <option key={b} value={b}>
              {t(`vehicles.bodyTypes.${b}`)}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

/** The label of a stored color or body type, `n/a` when not set. */
export function vehicleAppearanceLabel(
  t: TFunction,
  kind: 'colors' | 'bodyTypes',
  value: string | null | undefined,
): string {
  if (value == null) return 'n/a';
  if (kind === 'colors') return isVehicleColor(value) ? t(`vehicles.colors.${value}`) : value;
  return isVehicleBodyType(value) ? t(`vehicles.bodyTypes.${value}`) : value;
}

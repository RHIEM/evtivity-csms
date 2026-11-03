// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useTranslation } from 'react-i18next';
import {
  VEHICLE_BODY_TYPES,
  VEHICLE_COLORS,
  isVehicleBodyType,
  isVehicleColor,
  type VehicleBodyType,
  type VehicleColor,
} from '@evtivity/lib/vehicle-appearance';
import { Select } from '@/components/ui/select';

export interface VehicleAppearance {
  color: VehicleColor | null;
  bodyType: VehicleBodyType | null;
}

/**
 * The color and body type of a vehicle as two selects (the first option is
 * Not Set). `label` names the vehicle for screen readers on a vehicle card.
 */
export function VehicleAppearanceSelects({
  value,
  onChange,
  disabled,
  label,
}: {
  value: VehicleAppearance;
  onChange: (next: VehicleAppearance) => void;
  disabled?: boolean;
  label?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const named = (field: string): string => (label != null ? `${field}: ${label}` : field);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        aria-label={named(t('vehicles.color'))}
        value={value.color ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ ...value, color: isVehicleColor(v) ? v : null });
        }}
      >
        <option value="">
          {t('vehicles.color')}: {t('vehicles.notSet')}
        </option>
        {VEHICLE_COLORS.map((c) => (
          <option key={c} value={c}>
            {t(`vehicles.colors.${c}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={named(t('vehicles.bodyType'))}
        value={value.bodyType ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ ...value, bodyType: isVehicleBodyType(v) ? v : null });
        }}
      >
        <option value="">
          {t('vehicles.bodyType')}: {t('vehicles.notSet')}
        </option>
        {VEHICLE_BODY_TYPES.map((b) => (
          <option key={b} value={b}>
            {t(`vehicles.bodyTypes.${b}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * How a vehicle looks: its color and body type. Shared by the database CHECK
 * constraints (0480), the API schemas, the CSMS and portal vehicle forms and
 * the 3D site layout, which draws a car of the body type tinted in the color.
 * The mobile app keeps its own copy of the two lists. Browser-safe.
 *
 * The color list follows the groups registration offices and car surveys use
 * (white, black, silver, grey, blue, red, green, brown or beige, yellow or
 * orange); anything else is `other`.
 */

export const VEHICLE_COLORS = [
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
] as const;

export type VehicleColor = (typeof VEHICLE_COLORS)[number];

export const VEHICLE_BODY_TYPES = [
  'sedan',
  'hatchback',
  'suv',
  'pickup_truck',
  'van',
  'box_truck',
  'bus',
  'semi_truck',
] as const;

export type VehicleBodyType = (typeof VEHICLE_BODY_TYPES)[number];

/** English labels, for API docs and server text. The frontends use their locale files. */
export const VEHICLE_COLOR_LABELS: Record<VehicleColor, string> = {
  white: 'White',
  black: 'Black',
  silver: 'Silver',
  grey: 'Grey',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  brown_beige: 'Brown or Beige',
  yellow_orange: 'Yellow or Orange',
  other: 'Other',
};

export const VEHICLE_BODY_TYPE_LABELS: Record<VehicleBodyType, string> = {
  sedan: 'Sedan',
  hatchback: 'Hatchback',
  suv: 'SUV',
  pickup_truck: 'Pickup Truck',
  van: 'Van',
  box_truck: 'Box Truck',
  bus: 'Bus',
  semi_truck: 'Semi Truck',
};

/**
 * A paint color per vehicle color, for swatches and the 3D car body. `other`
 * and an unknown color draw a neutral grey.
 */
export const VEHICLE_COLOR_HEX: Record<VehicleColor, string> = {
  white: '#eef0f2',
  black: '#1c1d20',
  silver: '#b8bcc2',
  grey: '#6c7077',
  blue: '#2f5d9e',
  red: '#b3262e',
  green: '#2f6b45',
  brown_beige: '#9a7b5a',
  yellow_orange: '#e09a1f',
  other: '#8a8d92',
};

/** The body type and color drawn for a session whose vehicle is unknown. */
export const DEFAULT_VEHICLE_BODY_TYPE: VehicleBodyType = 'sedan';
export const DEFAULT_VEHICLE_COLOR: VehicleColor = 'grey';

export function isVehicleColor(value: unknown): value is VehicleColor {
  return typeof value === 'string' && (VEHICLE_COLORS as readonly string[]).includes(value);
}

export function isVehicleBodyType(value: unknown): value is VehicleBodyType {
  return typeof value === 'string' && (VEHICLE_BODY_TYPES as readonly string[]).includes(value);
}

/** The paint of a stored color, the default grey for null or an unknown value. */
export function vehicleColorHex(color: string | null | undefined): string {
  return isVehicleColor(color)
    ? VEHICLE_COLOR_HEX[color]
    : VEHICLE_COLOR_HEX[DEFAULT_VEHICLE_COLOR];
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { z } from 'zod';

// OCPP 1.6 has no message for the public key of a calibration-law meter.
// German stations (e.g. KEBA KC-P30) announce it after boot with
// DataTransfer vendorId "generalConfiguration", messageId
// "setMeterConfiguration" and data
// {"meters":[{"connectorId":1,"meterSerial":"...","type":"SIGNATURE","publicKey":"<DER hex>"}]}.
export const METER_CONFIGURATION_VENDOR_ID = 'generalConfiguration';
export const METER_CONFIGURATION_MESSAGE_ID = 'setMeterConfiguration';

const meterConfigurationSchema = z.object({
  meters: z
    .array(
      z.object({
        connectorId: z.number().int().min(0),
        meterSerial: z.string().max(255).optional(),
        type: z.string().max(50).optional(),
        publicKey: z
          .string()
          .min(1)
          .max(4096)
          .regex(/^[0-9A-Fa-f]+$/),
      }),
    )
    .min(1),
});

export type MeterConfiguration = z.infer<typeof meterConfigurationSchema>;

export function isMeterConfiguration(vendorId: unknown, messageId: unknown): boolean {
  return vendorId === METER_CONFIGURATION_VENDOR_ID && messageId === METER_CONFIGURATION_MESSAGE_ID;
}

// Returns null when data is not valid JSON or does not match the expected shape.
export function parseMeterConfiguration(data: unknown): MeterConfiguration | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const result = meterConfigurationSchema.safeParse(json);
  return result.success ? result.data : null;
}

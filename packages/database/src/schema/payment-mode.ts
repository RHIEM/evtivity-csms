// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { pgEnum } from 'drizzle-orm/pg-core';

// How a driver pays for charging. 'card' is the default Stripe flow
// (payment method + pre-authorization). 'invoice' lets the driver charge on a
// paid tariff without a payment method; sessions are billed later through an
// aggregated invoice.
//
// Kept in its own module because drivers.ts, charging.ts and the fleet table
// all reference it at definition time, and drivers.ts <-> charging.ts import
// each other. A leaf module avoids a TDZ error in that cycle.
export const paymentModeEnum = pgEnum('payment_mode', ['card', 'invoice']);

export type PaymentMode = (typeof paymentModeEnum.enumValues)[number];

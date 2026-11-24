// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  ACCOUNT_INVOICE_RECIPIENTS,
  ACCOUNT_SETTLEMENTS,
  INVOICE_DATE_MODES,
  MEMBER_INVOICE_DELIVERIES,
  fleets,
} from '../schema/drivers.js';

// RHIEM: 'driver_and_contacts' (19 characters) was allowed by a check constraint
// while its column held 16, so saving it failed with a 500 in production.
describe('fleet columns that hold a fixed list of values', () => {
  const columns: Array<[string, PgColumn, readonly string[]]> = [
    ['account_invoice_recipient', fleets.accountInvoiceRecipient, ACCOUNT_INVOICE_RECIPIENTS],
    ['invoice_date_mode', fleets.invoiceDateMode, INVOICE_DATE_MODES],
    ['account_settlement', fleets.accountSettlement, ACCOUNT_SETTLEMENTS],
    ['member_invoice_delivery', fleets.memberInvoiceDelivery, MEMBER_INVOICE_DELIVERIES],
  ];

  it.each(columns)('%s is long enough for every value of its list', (_name, column, values) => {
    const longest = Math.max(...values.map((value) => value.length));
    // The length of a varchar column is not part of the public column type.
    const length = Reflect.get(column, 'length') as number;
    expect(length).toBeGreaterThanOrEqual(longest);
  });
});

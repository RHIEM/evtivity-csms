// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from 'vitest';
import { classifySessionPayment } from '../payment-mode.js';
import type { SessionPaymentFacts } from '../payment-mode.js';

const none: SessionPaymentFacts = {
  isRoaming: false,
  freeVend: false,
  prepaid: false,
  invoice: false,
  driverId: null,
  guestSession: false,
};

describe('classifySessionPayment', () => {
  it('classifies each mode', () => {
    expect(classifySessionPayment({ ...none, isRoaming: true })).toBe('roaming');
    expect(classifySessionPayment({ ...none, freeVend: true })).toBe('free_vend');
    expect(classifySessionPayment({ ...none, prepaid: true })).toBe('prepaid');
    expect(classifySessionPayment({ ...none, invoice: true, driverId: 'drv_1' })).toBe('invoice');
    expect(classifySessionPayment({ ...none, driverId: 'drv_1' })).toBe('card');
    expect(classifySessionPayment({ ...none, guestSession: true })).toBe('guest');
    expect(classifySessionPayment(none)).toBe('anonymous');
  });

  it('applies the precedence roaming, free vend, prepaid, invoice, card, guest', () => {
    const all: SessionPaymentFacts = {
      isRoaming: true,
      freeVend: true,
      prepaid: true,
      invoice: true,
      driverId: 'drv_1',
      guestSession: true,
    };
    expect(classifySessionPayment(all)).toBe('roaming');
    expect(classifySessionPayment({ ...all, isRoaming: false })).toBe('free_vend');
    expect(classifySessionPayment({ ...all, isRoaming: false, freeVend: false })).toBe('prepaid');
    expect(
      classifySessionPayment({ ...all, isRoaming: false, freeVend: false, prepaid: false }),
    ).toBe('invoice');
    expect(
      classifySessionPayment({
        ...all,
        isRoaming: false,
        freeVend: false,
        prepaid: false,
        invoice: false,
      }),
    ).toBe('card');
    expect(
      classifySessionPayment({
        ...all,
        isRoaming: false,
        freeVend: false,
        prepaid: false,
        invoice: false,
        driverId: null,
      }),
    ).toBe('guest');
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { authState } = vi.hoisted(() => ({
  authState: { driver: null as Record<string, unknown> | null },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'de' } }),
}));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(() => Promise.resolve({})), patch: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  useAuth: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      driver: authState.driver,
      hydrate: vi.fn(),
      applyLanguageLocal: vi.fn(),
      applyTimezoneLocal: vi.fn(),
      applyThemeLocal: vi.fn(),
      applyDistanceUnitLocal: vi.fn(),
      theme: 'light',
    }),
}));
vi.mock('@/hooks/use-price-display', () => ({ useCompanyPriceDisplay: () => 'gross' }));
vi.mock('@/lib/avatar', () => ({ useDriverAvatar: () => ({ data: null }) }));
vi.mock('../AvatarEditor', () => ({ AvatarField: () => null }));

import { AccountPersonalInfo } from '../AccountPersonalInfo';

function renderWith(employeeNumber: string | null): void {
  authState.driver = {
    id: 'drv_1',
    firstName: 'Erika',
    lastName: 'Muster',
    email: 'erika@example.com',
    phone: null,
    language: 'de',
    timezone: 'Europe/Berlin',
    themePreference: 'light',
    distanceUnit: 'km',
    priceDisplay: null,
    isActive: true,
    emailVerified: true,
    employeeNumber,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountPersonalInfo />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('AccountPersonalInfo employee number', () => {
  it('shows the employee number read-only', () => {
    renderWith('4711');
    const input = screen.getByLabelText<HTMLInputElement>('profile.employeeNumber');
    expect(input.value).toBe('4711');
    expect(input.disabled).toBe(true);
    expect(screen.getByText('profile.employeeNumberHelp')).toBeTruthy();
  });

  it('leaves the field out without an employee number', () => {
    renderWith(null);
    expect(screen.queryByLabelText('profile.employeeNumber')).toBeNull();
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const { perms } = vi.hoisted(() => {
  // jsdom has no matchMedia; the theme store reads it on import.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
  return { perms: { list: ['settings.system:read'] as string[] } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn().mockResolvedValue({}) } };
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    useAuth: (select: (s: { permissions: string[] }) => unknown) =>
      select({ permissions: perms.list }),
    useHasAllSiteAccess: () => true,
  };
});

vi.mock('@/hooks/use-qr-icon', () => ({ useQrIcon: () => ({ svgDataUri: undefined }) }));
vi.mock('@/components/SystemInfoDialog', () => ({ SystemInfoDialog: () => null }));
vi.mock('@/components/settings/SecurityRecaptchaSettings', () => ({
  SecurityRecaptchaSettings: () => <div data-testid="recaptcha-panel" />,
}));
vi.mock('@/components/settings/InvoiceIssuerSettings', () => ({
  InvoiceIssuerSettings: () => <div data-testid="invoice-issuers-panel" />,
}));
vi.mock('@/components/settings/SecurityMfaSettings', () => ({
  SecurityMfaSettings: () => <div data-testid="mfa-panel" />,
}));
vi.mock('@/components/settings/SecuritySsoSettings', () => ({
  SecuritySsoSettings: () => <div data-testid="sso-panel" />,
}));
vi.mock('@/components/settings/SecurityPasswordSessionSettings', () => ({
  SecurityPasswordSessionSettings: ({ canWrite }: { canWrite: boolean }) => (
    <div data-testid="passwords-panel" data-can-write={String(canWrite)} />
  ),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

import { Settings } from '../Settings';

afterEach(() => {
  cleanup();
  perms.list = ['settings.system:read'];
});

function renderAt(url: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings invoice issuers tab', () => {
  it('opens the issuers in their own tab from its deep link', () => {
    renderAt('/settings?tab=invoiceIssuers');
    expect(screen.getByRole('tab', { name: 'settings.invoiceIssuers.tab' })).toBeTruthy();
    expect(screen.getByTestId('invoice-issuers-panel')).toBeTruthy();
  });

  it('keeps the issuers out of the company tab', () => {
    renderAt('/settings?tab=company');
    expect(screen.queryByTestId('invoice-issuers-panel')).toBeNull();
  });

  it('hides the tab without settings.system:read', () => {
    perms.list = ['settings.security:read'];
    renderAt('/settings');
    expect(screen.queryByRole('tab', { name: 'settings.invoiceIssuers.tab' })).toBeNull();
  });
});

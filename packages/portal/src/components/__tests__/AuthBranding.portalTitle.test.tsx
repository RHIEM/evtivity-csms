// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars?.name != null ? `${key}:${vars.name}` : key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/lib/version', () => ({ APP_VERSION: 'test' }));
vi.mock('@/lib/api', () => ({ api: { get: getMock } }));
vi.mock('@/components/ui/language-select', () => ({ LanguageSelect: () => null }));

import { AuthBranding, AuthFooter, useAuthBranding } from '../AuthBranding';

function Page(): React.JSX.Element {
  const { companyName, companyLogo, branding } = useAuthBranding();
  return (
    <>
      <AuthBranding companyName={companyName} companyLogo={companyLogo} />
      <AuthFooter companyName={companyName} branding={branding} />
    </>
  );
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('portal title', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    getMock.mockReset();
  });

  it('shows the portal title in the header and the company name in the footer', async () => {
    getMock.mockResolvedValue({
      name: 'RHIEM Packaging & Print GmbH',
      portalTitle: 'RHIEM EV',
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'RHIEM EV' })).toBeTruthy();
    await waitFor(() => {
      expect(document.title).toBe('RHIEM EV');
    });
    expect(
      screen.getByText(/authFooter.allRightsReserved:RHIEM Packaging & Print GmbH/),
    ).toBeTruthy();
  });

  it('uses the company name everywhere while no portal title is set', async () => {
    getMock.mockResolvedValue({ name: 'Acme Charging', portalTitle: '' });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Acme Charging' })).toBeTruthy();
    expect(screen.getByText(/authFooter.allRightsReserved:Acme Charging/)).toBeTruthy();
  });
});

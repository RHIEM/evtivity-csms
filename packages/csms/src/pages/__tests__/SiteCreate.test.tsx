// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

// The theme store reads the color scheme on import; jsdom has no matchMedia.
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
});

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: postMock, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getApiErrorFieldDetails: () => ({}),
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/components/GoogleMapPicker', () => ({ GoogleMapPicker: () => null }));

import { SiteCreate } from '../SiteCreate';

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SiteCreate />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SiteCreate site type', () => {
  it('sends a parking lot by default', async () => {
    postMock.mockResolvedValue({ id: 'sit_1' });
    renderPage();
    const select = screen.getByLabelText('sites.layoutSettings.siteType');
    expect((select as HTMLSelectElement).value).toBe('parking_lot');
    fireEvent.change(screen.getByLabelText('common.name'), { target: { value: 'Harbor' } });
    fireEvent.submit(screen.getByLabelText('common.name').closest('form') as HTMLFormElement);
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/v1/sites',
        expect.objectContaining({ name: 'Harbor', siteType: 'parking_lot' }),
      );
    });
  });

  it('sends the chosen site type', async () => {
    postMock.mockResolvedValue({ id: 'sit_2' });
    renderPage();
    fireEvent.change(screen.getByLabelText('common.name'), { target: { value: 'Main Street' } });
    fireEvent.change(screen.getByLabelText('sites.layoutSettings.siteType'), {
      target: { value: 'curbside' },
    });
    fireEvent.submit(screen.getByLabelText('common.name').closest('form') as HTMLFormElement);
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/v1/sites',
        expect.objectContaining({ siteType: 'curbside' }),
      );
    });
  });
});

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { put, canWrite } = vi.hoisted(() => ({
  put: vi.fn(() => Promise.resolve({})),
  canWrite: { value: true },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/lib/api', () => ({ api: { put } }));

vi.mock('@/lib/auth', () => ({
  useHasCompanyWidePermission: () => canWrite.value,
}));

import { InvoiceExternalInvoicingSettings } from '../InvoiceExternalInvoicingSettings';

beforeEach(() => {
  canWrite.value = true;
  put.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderWith(settings: Record<string, unknown> | undefined): void {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <InvoiceExternalInvoicingSettings settings={settings} />
    </QueryClientProvider>,
  );
}

describe('InvoiceExternalInvoicingSettings', () => {
  it('is off unless the setting is true', () => {
    renderWith({ 'invoice.externalInvoicing': 'true' });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    cleanup();
    renderWith({ 'invoice.externalInvoicing': true });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('saves the switch', async () => {
    renderWith({});
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/v1/settings/invoice.externalInvoicing', { value: true });
    });
    expect(await screen.findByText('settings.externalInvoicingSaved')).toBeTruthy();
  });

  it('shows the value read-only without write access', () => {
    canWrite.value = false;
    renderWith({ 'invoice.externalInvoicing': true });
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });
});

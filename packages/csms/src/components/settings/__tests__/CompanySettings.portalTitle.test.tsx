// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

// RHIEM: Settings > Company sets the portal title apart from the company name.

const { put } = vi.hoisted(() => ({ put: vi.fn(() => Promise.resolve({})) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => Promise.resolve({})), put, post: vi.fn(), delete: vi.fn() },
  getApiErrorFieldDetails: () => ({}),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { CompanySettings } from '../CompanySettings';

function mount(settings: Record<string, unknown>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CompanySettings settings={settings} svgDataUri={null} hasIcon={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function savedValue(key: string): unknown {
  const call = put.mock.calls.find((c) => (c as unknown[])[0] === `/v1/settings/${key}`) as
    | [string, { value: unknown }]
    | undefined;
  return call?.[1].value;
}

beforeEach(() => {
  put.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('Company settings portal title', () => {
  it('shows the stored portal title next to the company name', () => {
    mount({ 'company.name': 'RHIEM Packaging & Print GmbH', 'company.portalTitle': 'RHIEM EV' });
    expect(screen.getByLabelText('settings.companyName')).toHaveProperty(
      'value',
      'RHIEM Packaging & Print GmbH',
    );
    expect(screen.getByLabelText('settings.portalTitle')).toHaveProperty('value', 'RHIEM EV');
  });

  it('leaves the portal title empty when none is stored', () => {
    mount({ 'company.name': 'Acme' });
    expect(screen.getByLabelText('settings.portalTitle')).toHaveProperty('value', '');
  });

  it('saves the trimmed portal title with the company settings', async () => {
    mount({ 'company.name': 'Acme' });
    fireEvent.change(screen.getByLabelText('settings.portalTitle'), {
      target: { value: '  RHIEM EV ' },
    });
    const save = screen.getAllByRole('button', { name: 'common.save' })[0];
    if (save == null) throw new Error('no Save button');
    fireEvent.click(save);
    await waitFor(() => {
      expect(savedValue('company.portalTitle')).toBe('RHIEM EV');
    });
    expect(savedValue('company.name')).toBe('Acme');
  });
});

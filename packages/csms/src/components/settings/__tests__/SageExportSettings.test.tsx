// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAGE_EXPORT_SETTING_KEYS } from '@evtivity/lib/sage-export';

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

import { SageExportSettings } from '../SageExportSettings';

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
      <SageExportSettings settings={settings} />
    </QueryClientProvider>,
  );
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
}

describe('SageExportSettings', () => {
  it('shows the stored values', () => {
    renderWith({ 'sage.mandant': '100', 'sage.taxCodes': '19=3, 7=2' });
    expect(screen.getByLabelText(/settings.sageExportMandant/)).toHaveProperty('value', '100');
    expect(screen.getByLabelText(/settings.sageExportTaxCodes/)).toHaveProperty(
      'value',
      '19=3, 7=2',
    );
  });

  // The settings table returns a text such as "1" as a number; the field must still show it.
  it('shows a Mandant and an account that came back as numbers', () => {
    renderWith({ 'sage.mandant': 1, 'sage.revenueAccount': 84030 });
    expect(screen.getByLabelText(/settings.sageExportMandant/)).toHaveProperty('value', '1');
    expect(screen.getByLabelText(/settings.sageExportRevenueAccount( \*)?$/)).toHaveProperty(
      'value',
      '84030',
    );
  });

  it('saves every setting trimmed, empty ones included', async () => {
    renderWith({});
    fireEvent.change(screen.getByLabelText(/settings.sageExportMandant/), {
      target: { value: '  100 ' },
    });
    save();
    await waitFor(() => {
      expect(put).toHaveBeenCalledTimes(SAGE_EXPORT_SETTING_KEYS.length);
    });
    expect(put).toHaveBeenCalledWith('/v1/settings/sage.mandant', { value: '100' });
    expect(await screen.findByText('settings.sageExportSaved')).toBeTruthy();
  });

  it('refuses malformed tax codes and saves nothing', async () => {
    renderWith({});
    fireEvent.change(screen.getByLabelText(/settings.sageExportTaxCodes/), {
      target: { value: '19' },
    });
    save();
    expect(await screen.findByText('settings.sageExportInvalid')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('disables the fields and hides Save without company-wide write access', () => {
    canWrite.value = false;
    renderWith({});
    expect(screen.getByLabelText(/settings.sageExportMandant/)).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });
});

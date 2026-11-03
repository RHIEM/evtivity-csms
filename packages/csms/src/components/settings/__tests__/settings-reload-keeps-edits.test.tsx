// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const { put, get } = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { put, get } }));

vi.mock('@/hooks/use-company-currency', () => ({
  useCompanyCurrency: () => ({ currency: 'USD', isError: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/use-company-tax-basis', () => ({ useCompanyTaxBasis: () => 'net' }));
vi.mock('@/components/wysiwyg-editor', () => ({
  WysiwygEditor: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea
      data-testid="wysiwyg"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  ),
}));

import { MarketingSettings } from '../MarketingSettings';
import { SustainabilitySettings } from '../SustainabilitySettings';
import { PrepaidSettings } from '../PrepaidSettings';
import { FleetCreditReservationSettings } from '../FleetCreditReservationSettings';
import { ReservationSettings } from '../ReservationSettings';
import { SecurityRecaptchaSettings } from '../SecurityRecaptchaSettings';
import { ContentSettings } from '../ContentSettings';

type Settings = Record<string, unknown>;
type Card = React.ComponentType<{ settings: Settings | undefined }>;

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ success: true });
  get.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderCard(Card: Card, settings: Settings) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Card settings={settings} />
    </QueryClientProvider>,
  );
  return {
    reload: (next: Settings) => {
      view.rerender(
        <QueryClientProvider client={client}>
          <Card settings={next} />
        </QueryClientProvider>,
      );
    },
  };
}

function field(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function type(id: string, value: string): void {
  fireEvent.change(field(id), { target: { value } });
}

async function save(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => {
    expect(put).toHaveBeenCalled();
  });
  // Let the per-call onSuccess run.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeNull();
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Case {
  name: string;
  Card: Card;
  id: string;
  stored: (value: number) => Settings;
  shown: (value: number) => string;
  typed: string;
  /** The stored value of `typed` and how the card shows it after the save. */
  savedStored: number;
}

const cases: Case[] = [
  {
    name: 'Marketing',
    Card: MarketingSettings,
    id: 'gtag-portal',
    stored: (n) => ({ 'marketing.gtagPortal': `G-${String(n)}`, 'marketing.gtagCsms': '' }),
    shown: (n) => `G-${String(n)}`,
    typed: 'G-7',
    savedStored: 7,
  },
  {
    name: 'Sustainability',
    Card: SustainabilitySettings,
    id: 'avg-mpg',
    stored: (n) => ({ 'sustainability.avgMpg': n }),
    shown: (n) => String(n),
    typed: '30.0',
    // Stored as the number 30, shown as "30".
    savedStored: 30,
  },
  {
    name: 'Prepaid',
    Card: PrepaidSettings,
    id: 'prepaid-low-credit-threshold',
    stored: (n) => ({ 'prepaid.lowCreditThresholdCents': n }),
    shown: (n) => (n / 100).toFixed(2),
    typed: '1.5',
    savedStored: 150,
  },
  {
    name: 'Fleet credit reservation',
    Card: FleetCreditReservationSettings,
    id: 'fleet-credit-reservation',
    stored: (n) => ({ 'fleet.creditReservationCents': n }),
    shown: (n) => (n / 100).toFixed(2),
    typed: '12.5',
    savedStored: 1250,
  },
  {
    name: 'Reservation',
    Card: ReservationSettings,
    id: 'reservation-buffer-minutes',
    stored: (n) => ({ 'reservation.bufferMinutes': n }),
    shown: (n) => String(n),
    typed: '020',
    savedStored: 20,
  },
  {
    name: 'reCAPTCHA',
    Card: SecurityRecaptchaSettings,
    id: 'recaptcha-site-key',
    stored: (n) => ({ 'security.recaptcha.siteKey': `site-${String(n)}` }),
    shown: (n) => `site-${String(n)}`,
    typed: ' site-9 ',
    // The server trims what it stores.
    savedStored: 9,
  },
];

describe.each(cases)('$name settings card on a settings reload', (c) => {
  it('keeps unsaved edits while dirty', () => {
    const { reload } = renderCard(c.Card, c.stored(10));
    type(c.id, c.typed);
    reload(c.stored(40));
    expect(field(c.id).value).toBe(c.typed);
  });

  it('takes the new stored values while clean', () => {
    const { reload } = renderCard(c.Card, c.stored(10));
    expect(field(c.id).value).toBe(c.shown(10));
    reload(c.stored(40));
    expect(field(c.id).value).toBe(c.shown(40));
  });

  it('takes the stored form of its own save, then follows later reloads', async () => {
    const { reload } = renderCard(c.Card, c.stored(10));
    type(c.id, c.typed);
    await save();
    reload(c.stored(c.savedStored));
    expect(field(c.id).value).toBe(c.shown(c.savedStored));
    reload(c.stored(40));
    expect(field(c.id).value).toBe(c.shown(40));
  });
});

describe('Content settings on a reload of the document', () => {
  function renderContent() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ContentSettings />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    return client;
  }

  async function reloadPrivacy(client: QueryClient, html: string): Promise<void> {
    get.mockResolvedValue({ html });
    await client.refetchQueries({ queryKey: ['settings', 'content.privacyPolicy', 'en'] });
  }

  it('keeps unsaved text while dirty and takes new text while clean', async () => {
    get.mockResolvedValue({ html: '<p>v1</p>' });
    const client = renderContent();
    const editor = await screen.findByTestId('wysiwyg');
    await waitFor(() => {
      expect((editor as HTMLTextAreaElement).value).toBe('<p>v1</p>');
    });
    await reloadPrivacy(client, '<p>v2</p>');
    await waitFor(() => {
      expect((editor as HTMLTextAreaElement).value).toBe('<p>v2</p>');
    });
    fireEvent.change(editor, { target: { value: '<p>mine</p>' } });
    await reloadPrivacy(client, '<p>v3</p>');
    expect((editor as HTMLTextAreaElement).value).toBe('<p>mine</p>');
  });
});

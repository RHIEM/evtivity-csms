// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A settings refetch replaces a card's values only while the card is clean:
// unsaved edits survive it, and after the card's own save the next reload
// takes the stored values (useLoadedValues).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const { get, put, post, del, templates } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(() => Promise.resolve({})),
  post: vi.fn(() => Promise.resolve({ rendered: '' })),
  del: vi.fn(() => Promise.resolve({})),
  templates: { body: 'Welcome' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/lib/api', () => ({
  api: { get, put, post, delete: del },
  getApiErrorFieldDetails: () => ({}),
}));

vi.mock('@/lib/auth', () => ({
  useHasCompanyWidePermission: () => true,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/settings/WebhookSigningSecret', () => ({
  WebhookSigningSecret: () => null,
}));

import { CompanySettings } from '../CompanySettings';
import { InvoiceSettings } from '../InvoiceSettings';
import { InvoicePaymentSettings } from '../InvoicePaymentSettings';
import { InvoiceSellerSettings } from '../InvoiceSellerSettings';
import { NotificationSettings } from '../NotificationSettings';
import { StationMessageSettings } from '../StationMessageSettings';

type Settings = Record<string, unknown>;

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  put.mockClear();
  templates.body = 'Welcome';
  get.mockImplementation((path: string) => {
    if (path === '/v1/station-message-templates') {
      return Promise.resolve({
        data: [
          {
            state: 'available',
            language: 'en',
            body: templates.body,
            updatedAt: null,
            updatedBy: null,
          },
        ],
      });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
});

function mount(Card: (props: { settings: Settings }) => React.JSX.Element, settings: Settings) {
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Card settings={settings} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return {
    reload: (next: Settings): void => {
      view.rerender(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Card settings={next} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    },
  };
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label);
}

function type(label: string, value: string): void {
  fireEvent.change(field(label), { target: { value } });
}

function clickSave(): void {
  const first = screen.getAllByRole('button', { name: 'common.save' })[0];
  if (first == null) throw new Error('no Save button');
  fireEvent.click(first);
}

interface Case {
  name: string;
  Card: (props: { settings: Settings }) => React.JSX.Element;
  key: string;
  label: string;
  /** What the user types, and the stored form of it the server answers with. */
  typed: string;
  stored: string;
  save?: () => void;
}

const Company = ({ settings }: { settings: Settings }): React.JSX.Element => (
  <CompanySettings settings={settings} svgDataUri={null} hasIcon={false} />
);

const CASES: Case[] = [
  {
    name: 'Company',
    Card: Company,
    key: 'company.name',
    label: 'settings.companyName',
    typed: 'Acme ',
    stored: 'Acme',
  },
  {
    name: 'Invoice settings',
    Card: InvoiceSettings,
    key: 'invoice.paymentTermsDays',
    label: 'settings.invoicePaymentTermsDays',
    typed: '045',
    stored: '45',
  },
  {
    name: 'Invoice payment',
    Card: InvoicePaymentSettings,
    key: 'company.bankAccountHolder',
    label: 'settings.invoicePaymentHolder',
    typed: ' Acme GmbH ',
    stored: 'Acme GmbH',
  },
  {
    name: 'Invoice seller',
    Card: InvoiceSellerSettings,
    key: 'company.taxId',
    label: 'settings.invoiceSellerTaxId',
    typed: ' DE123 ',
    stored: 'DE123',
  },
  {
    name: 'Notifications SMTP',
    Card: NotificationSettings,
    key: 'smtp.host',
    label: 'settings.smtpHost',
    typed: ' smtp.example.com',
    stored: 'smtp.example.com',
  },
  {
    name: 'Station messages',
    Card: StationMessageSettings,
    key: 'stationMessage.brandLine',
    label: 'messages.brandLine',
    typed: 'Acme  ',
    stored: 'Acme',
  },
];

function storedValue(c: Case, value: string): unknown {
  return c.key === 'invoice.paymentTermsDays' ? Number(value) : value;
}

describe.each(CASES)('$name card on a settings reload', (c) => {
  it('keeps an unsaved edit', () => {
    const view = mount(c.Card, { [c.key]: storedValue(c, '30') });
    type(c.label, c.typed);
    view.reload({ [c.key]: storedValue(c, '31'), 'other.key': 1 });
    expect(field(c.label).value).toBe(c.typed);
  });

  it('takes the new values while clean', () => {
    const view = mount(c.Card, { [c.key]: storedValue(c, '30') });
    view.reload({ [c.key]: storedValue(c, '31') });
    expect(field(c.label).value).toBe('31');
  });

  it('takes the stored form of its own save on the next reload', async () => {
    const view = mount(c.Card, { [c.key]: storedValue(c, '30') });
    type(c.label, c.typed);
    clickSave();
    await waitFor(() => {
      expect(put).toHaveBeenCalled();
    });
    // Let the save settle so its onSuccess marks the saved values.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    view.reload({ [c.key]: storedValue(c, c.stored) });
    expect(field(c.label).value).toBe(c.stored);
    // Clean again: a later reload replaces the values.
    view.reload({ [c.key]: storedValue(c, '32') });
    expect(field(c.label).value).toBe('32');
  });
});

describe('Station message template draft on a templates reload', () => {
  async function mountTemplates(): Promise<void> {
    mount(StationMessageSettings, {});
    await waitFor(() => {
      expect(field('messages.bodyLabel').value).toBe('Welcome');
    });
  }

  async function refetchTemplates(body: string): Promise<void> {
    templates.body = body;
    await client.invalidateQueries({ queryKey: ['station-message-templates'] });
  }

  it('keeps an unsaved draft', async () => {
    await mountTemplates();
    type('messages.bodyLabel', 'My draft');
    await refetchTemplates('Changed elsewhere');
    expect(field('messages.bodyLabel').value).toBe('My draft');
  });

  it('takes the reloaded template while clean', async () => {
    await mountTemplates();
    await refetchTemplates('Changed elsewhere');
    await waitFor(() => {
      expect(field('messages.bodyLabel').value).toBe('Changed elsewhere');
    });
  });

  it('takes the stored template after its own save', async () => {
    await mountTemplates();
    type('messages.bodyLabel', 'Hello  ');
    const saves = screen.getAllByRole('button', { name: 'common.save' });
    const templateSave = saves[saves.length - 1];
    if (templateSave == null) throw new Error('no template Save button');
    fireEvent.click(templateSave);
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/v1/station-message-templates/available?language=en', {
        body: 'Hello  ',
      });
    });
    await refetchTemplates('Hello');
    await waitFor(() => {
      expect(field('messages.bodyLabel').value).toBe('Hello');
    });
  });
});

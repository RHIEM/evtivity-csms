// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { get, post, patch, put, del, toast, canWrite } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(() => Promise.resolve({})),
  patch: vi.fn(() => Promise.resolve({})),
  put: vi.fn(() => Promise.resolve({})),
  del: vi.fn(() => Promise.resolve(undefined)),
  toast: vi.fn(),
  canWrite: { value: true },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { number?: string }) =>
      opts?.number != null ? `${key} ${opts.number}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/lib/api', () => ({ api: { get, post, patch, put, delete: del } }));
vi.mock('@/lib/auth', () => ({ useHasCompanyWidePermission: () => canWrite.value }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

import { InvoiceIssuerSettings, exampleNumber } from '../InvoiceIssuerSettings';
import type { InvoiceIssuer } from '../InvoiceIssuerSettings';

function issuer(overrides: Partial<InvoiceIssuer> = {}): InvoiceIssuer {
  return {
    id: 'iis_rs',
    name: 'RHIEM Services GmbH',
    street: 'Musterweg 1',
    zip: '12345',
    city: 'Musterstadt',
    state: null,
    country: 'DE',
    taxId: null,
    taxIdLabel: null,
    registrationNumber: null,
    email: null,
    phone: null,
    invoicePrefix: '',
    invoiceWithYear: false,
    invoiceStart: 10000,
    invoiceDigits: 0,
    creditNotePrefix: 'GS-',
    creditNoteWithYear: true,
    creditNoteStart: 1,
    creditNoteDigits: 4,
    pdfFooter: null,
    hasPdfLogo: false,
    invoiceNumberLocked: false,
    creditNoteNumberLocked: false,
    fleetCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  canWrite.value = true;
  get.mockReset();
  post.mockClear();
  patch.mockClear();
  put.mockClear();
  del.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderWith(issuers: InvoiceIssuer[]): void {
  get.mockResolvedValue(issuers);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvoiceIssuerSettings />
    </QueryClientProvider>,
  );
}

describe('exampleNumber', () => {
  it('prints the first number of the format in the given year', () => {
    expect(exampleNumber({ prefix: 'RPP-', withYear: true, start: 1, digits: 4 }, 2026)).toBe(
      'RPP-260001',
    );
    expect(exampleNumber({ prefix: '', withYear: false, start: 10000, digits: 0 }, 2026)).toBe(
      '10000',
    );
  });
});

describe('InvoiceIssuerSettings', () => {
  it('lists the issuers with their first numbers and fleet count', async () => {
    renderWith([issuer({ fleetCount: 2 })]);
    const row = (await screen.findByText('RHIEM Services GmbH')).closest('tr') as HTMLElement;
    expect(within(row).getByText('10000')).toBeTruthy();
    expect(within(row).getByText(/^GS-\d{2}0001$/)).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    renderWith([]);
    expect(await screen.findByText('settings.invoiceIssuers.empty')).toBeTruthy();
  });

  it('creates an issuer with its address and number formats', async () => {
    renderWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'settings.invoiceIssuers.add' }));
    fireEvent.change(screen.getByLabelText('settings.invoiceIssuers.name'), {
      target: { value: ' RHIEM Packaging & Print GmbH ' },
    });
    fireEvent.change(screen.getByLabelText('settings.invoiceIssuers.city'), {
      target: { value: 'Musterstadt' },
    });
    const invoice = screen.getByTestId('issuer-invoice-format');
    fireEvent.change(within(invoice).getByLabelText('settings.invoiceIssuers.prefix'), {
      target: { value: 'RPP-' },
    });
    fireEvent.change(within(invoice).getByLabelText('settings.invoiceIssuers.digits'), {
      target: { value: '4' },
    });
    fireEvent.click(within(invoice).getByLabelText('settings.invoiceIssuers.withYear'));
    expect(screen.getByTestId('issuer-invoice-example').textContent).toMatch(
      /^settings\.invoiceIssuers\.example RPP-\d{2}0001$/,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/v1/invoice-issuers',
        expect.objectContaining({
          name: 'RHIEM Packaging & Print GmbH',
          city: 'Musterstadt',
          street: null,
          invoicePrefix: 'RPP-',
          invoiceWithYear: true,
          invoiceStart: 1,
          invoiceDigits: 4,
          creditNotePrefix: '',
        }),
      );
    });
  });

  it('refuses a blank name and an invalid prefix', () => {
    renderWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'settings.invoiceIssuers.add' }));
    const invoice = screen.getByTestId('issuer-invoice-format');
    fireEvent.change(within(invoice).getByLabelText('settings.invoiceIssuers.prefix'), {
      target: { value: 'RE/26' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(screen.getByText('settings.invoiceIssuers.nameRequired')).toBeTruthy();
    expect(screen.getByTestId('issuer-invoice-example').textContent).toBe(
      'settings.invoiceIssuers.formatInvalid',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps a used number format read-only and does not send it', async () => {
    renderWith([issuer({ invoiceNumberLocked: true, fleetCount: 1 })]);
    fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }));
    const invoice = screen.getByTestId('issuer-invoice-format');
    expect(within(invoice).getByText('settings.invoiceIssuers.formatLocked')).toBeTruthy();
    expect(within(invoice).getByLabelText('settings.invoiceIssuers.prefix')).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(screen.getByLabelText('settings.invoiceIssuers.city'), {
      target: { value: 'Köln' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalled();
    });
    const body = (patch.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(body['city']).toBe('Köln');
    expect(body).not.toHaveProperty('invoicePrefix');
    expect(body).toHaveProperty('creditNotePrefix', 'GS-');
  });

  it('deletes an unused issuer and cannot delete one in use', async () => {
    renderWith([issuer(), issuer({ id: 'iis_used', name: 'Used GmbH', fleetCount: 1 })]);
    const usedRow = (await screen.findByText('Used GmbH')).closest('tr') as HTMLElement;
    expect(within(usedRow).getByRole('button', { name: 'common.delete' })).toHaveProperty(
      'disabled',
      true,
    );
    const row = screen.getByText('RHIEM Services GmbH').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'common.delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(del).toHaveBeenCalledWith('/v1/invoice-issuers/iis_rs');
    });
  });

  it('shows the list without edit actions to a reader', async () => {
    canWrite.value = false;
    renderWith([issuer()]);
    expect(await screen.findByText('RHIEM Services GmbH')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'settings.invoiceIssuers.add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.edit' })).toBeNull();
  });

  describe('PDF logo and footer', () => {
    const PNG_URI = 'data:image/png;base64,iVBORw0KGgo=';

    function renderWithLogo(list: InvoiceIssuer[], logo: string | null): void {
      get.mockImplementation((url: string) =>
        Promise.resolve(url.endsWith('/pdf-logo') ? { logo } : list),
      );
      render(
        <QueryClientProvider client={new QueryClient()}>
          <InvoiceIssuerSettings />
        </QueryClientProvider>,
      );
    }

    it("takes the company's footer for a new issuer and offers the logo after creating it", async () => {
      renderWith([]);
      fireEvent.click(screen.getByRole('button', { name: 'settings.invoiceIssuers.add' }));
      expect(screen.getByText('settings.invoiceIssuers.logoAfterCreate')).toBeTruthy();
      expect(screen.getByText('settings.invoiceIssuers.footerHelpCompany')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('settings.invoiceIssuers.name'), {
        target: { value: 'RHIEM Intermedia GmbH' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          '/v1/invoice-issuers',
          expect.objectContaining({ pdfFooter: null }),
        );
      });
    });

    it('saves an own footer, an empty one meaning no footer', async () => {
      renderWith([issuer()]);
      fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }));
      fireEvent.click(screen.getByLabelText('settings.invoiceIssuers.ownFooter'));
      fireEvent.change(screen.getByLabelText('settings.pdfFooter'), {
        target: { value: 'RHIEM Services GmbH\r\nHRB 1  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(patch).toHaveBeenCalledWith(
          '/v1/invoice-issuers/iis_rs',
          expect.objectContaining({ pdfFooter: 'RHIEM Services GmbH\nHRB 1' }),
        );
      });
      cleanup();
      patch.mockClear();

      renderWith([issuer({ pdfFooter: '' })]);
      fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }));
      expect(screen.getByLabelText('settings.invoiceIssuers.ownFooter')).toHaveProperty(
        'checked',
        true,
      );
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(patch).toHaveBeenCalledWith(
          '/v1/invoice-issuers/iis_rs',
          expect.objectContaining({ pdfFooter: '' }),
        );
      });
    });

    it('refuses a footer with too many lines', () => {
      renderWith([]);
      fireEvent.click(screen.getByRole('button', { name: 'settings.invoiceIssuers.add' }));
      fireEvent.change(screen.getByLabelText('settings.invoiceIssuers.name'), {
        target: { value: 'X' },
      });
      fireEvent.click(screen.getByLabelText('settings.invoiceIssuers.ownFooter'));
      fireEvent.change(screen.getByLabelText('settings.pdfFooter'), {
        target: { value: '1\n2\n3\n4\n5\n6' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      expect(screen.getByText('settings.pdfFooterInvalid')).toBeTruthy();
      expect(post).not.toHaveBeenCalled();
    });

    it('shows the company logo without an own one and uploads a logo', async () => {
      renderWithLogo([issuer()], null);
      fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }));
      expect(await screen.findByText('settings.invoiceIssuers.logoCompany')).toBeTruthy();
      const input = screen
        .getByTestId('issuer-branding')
        .querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
        type: 'image/png',
      });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(put).toHaveBeenCalledWith('/v1/invoice-issuers/iis_rs/pdf-logo', {
          logo: expect.stringMatching(/^data:image\/png;base64,/) as unknown,
        });
      });
    });

    it('previews an own logo and removes it', async () => {
      renderWithLogo([issuer({ hasPdfLogo: true })], PNG_URI);
      fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }));
      expect((await screen.findByTestId('issuer-logo-preview')).getAttribute('src')).toBe(PNG_URI);
      fireEvent.click(screen.getByRole('button', { name: 'settings.invoiceIssuers.logoRemove' }));

      await waitFor(() => {
        expect(del).toHaveBeenCalledWith('/v1/invoice-issuers/iis_rs/pdf-logo');
      });
      expect(await screen.findByText('settings.invoiceIssuers.logoCompany')).toBeTruthy();
    });
  });
});

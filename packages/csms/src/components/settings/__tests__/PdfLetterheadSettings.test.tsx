// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { get, put, post, postForBlob, canWrite } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(() => Promise.resolve({})),
  post: vi.fn(() => Promise.resolve({})),
  postForBlob: vi.fn(() => Promise.resolve(new Blob(['%PDF']))),
  canWrite: { value: true },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'de' } }),
}));

vi.mock('@/lib/api', () => ({ api: { get, put, post }, postForBlob }));

vi.mock('@/lib/auth', () => ({
  useHasCompanyWidePermission: () => canWrite.value,
}));

vi.mock('@/lib/timezone', () => ({
  useUserTimezone: () => 'UTC',
  formatDate: (value: string) => value.slice(0, 10),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { PdfLetterheadSettings } from '../PdfLetterheadSettings';
import type { PdfLetterheadVersion } from '../PdfLetterheadSettings';

const LAYOUT = {
  addressLeftMm: 22.9,
  addressTopMm: 53.6,
  contentTopMm: 92,
  contentBottomMm: 258,
  marginLeftMm: 15.2,
  marginRightMm: 15.2,
};

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

function version(overrides: Partial<PdfLetterheadVersion> = {}): PdfLetterheadVersion {
  return {
    id: 'lhd_ri',
    name: 'RHIEM Intermedia 2026',
    createdAt: '2026-11-05T12:00:00.000Z',
    current: true,
    invoiceCount: 3,
    ...LAYOUT,
    ...overrides,
  };
}

function setVersions(versions: PdfLetterheadVersion[]): void {
  get.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/image') ? { image: IMAGE } : versions),
  );
}

beforeEach(() => {
  canWrite.value = true;
  get.mockReset();
  put.mockClear();
  post.mockClear();
  postForBlob.mockClear();
  setVersions([version(), version({ id: 'lhd_old', name: 'Old', current: false })]);
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSettings(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PdfLetterheadSettings />
    </QueryClientProvider>,
  );
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('PdfLetterheadSettings', () => {
  it('lists the versions and selects the current one', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-letterhead-version')).toHaveLength(2);
    });
    expect(screen.getByLabelText('settings.pdfLetterheadCurrent')).toHaveProperty(
      'value',
      'lhd_ri',
    );
    expect(screen.getByText('settings.pdfLetterheadCurrentBadge')).toBeTruthy();
  });

  it('sets another version current, or none', async () => {
    renderSettings();
    const select = await screen.findByLabelText('settings.pdfLetterheadCurrent');
    fireEvent.change(select, { target: { value: 'lhd_old' } });
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/v1/pdf-letterheads/current', { letterheadId: 'lhd_old' });
    });
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/v1/pdf-letterheads/current', { letterheadId: null });
    });
  });

  it('creates a version from an uploaded image and the layout', async () => {
    renderSettings();
    fireEvent.click(await screen.findByText('settings.pdfLetterheadNewVersion'));
    fireEvent.change(screen.getByLabelText('settings.pdfLetterheadName'), {
      target: { value: 'Services 2026' },
    });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'rs.png', {
      type: 'image/png',
    });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await screen.findByTestId('pdf-letterhead-thumbnail');
    fireEvent.change(screen.getByLabelText('settings.pdfLetterheadContentTop'), {
      target: { value: '112' },
    });
    fireEvent.click(screen.getByLabelText('settings.pdfLetterheadActivate'));
    fireEvent.click(screen.getByText('settings.pdfLetterheadCreate'));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/v1/pdf-letterheads',
        expect.objectContaining({
          name: 'Services 2026',
          image: expect.stringMatching(/^data:image\/png;base64,/) as unknown,
          addressLeftMm: 25,
          contentTopMm: 112,
          activate: true,
        }),
      );
    });
  });

  it('flags a layout the API would refuse and keeps create disabled', async () => {
    renderSettings();
    fireEvent.click(await screen.findByText('settings.pdfLetterheadNewVersion'));
    fireEvent.change(screen.getByLabelText('settings.pdfLetterheadMarginLeft'), {
      target: { value: '40' },
    });
    expect(screen.getByText('settings.pdfLetterheadLayoutInvalid')).toBeTruthy();
    expect(screen.getByText('settings.pdfLetterheadCreate').closest('button')?.disabled).toBe(true);
  });

  it('previews a stored version with its image and layout in the UI language', async () => {
    renderSettings();
    const [first] = await screen.findAllByText('settings.pdfLetterheadPreview');
    if (first != null) fireEvent.click(first);
    await waitFor(() => {
      expect(postForBlob).toHaveBeenCalledWith('/v1/pdf-letterheads/preview', {
        image: IMAGE,
        ...LAYOUT,
        language: 'de',
      });
    });
    expect(get).toHaveBeenCalledWith('/v1/pdf-letterheads/lhd_ri/image');
    const frame = await screen.findByTestId('pdf-letterhead-preview');
    expect(frame.getAttribute('src')).toBe('blob:preview');
  });

  it('starts a new version from a stored one', async () => {
    renderSettings();
    const [first] = await screen.findAllByText('settings.pdfLetterheadUseAsTemplate');
    if (first != null) fireEvent.click(first);
    await screen.findByTestId('pdf-letterhead-thumbnail');
    expect(screen.getByLabelText('settings.pdfLetterheadName')).toHaveProperty(
      'value',
      'RHIEM Intermedia 2026',
    );
    expect(screen.getByLabelText('settings.pdfLetterheadAddressTop')).toHaveProperty(
      'value',
      '53.6',
    );
  });

  it('only lists and previews without settings write access', async () => {
    canWrite.value = false;
    renderSettings();
    await screen.findAllByTestId('pdf-letterhead-version');
    expect(screen.getByLabelText('settings.pdfLetterheadCurrent').hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.queryByText('settings.pdfLetterheadNewVersion')).toBeNull();
    expect(screen.queryByText('settings.pdfLetterheadUseAsTemplate')).toBeNull();
    expect(screen.getAllByText('settings.pdfLetterheadPreview')).toHaveLength(2);
  });
});

describe('PdfLetterheadSettings of an invoice issuer', () => {
  const ISSUER = { id: 'iis_rs', name: 'RHIEM Services GmbH' };

  function renderIssuer(): void {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PdfLetterheadSettings issuer={ISSUER} />
      </QueryClientProvider>,
    );
  }

  it("lists the issuer's own versions, the company letterhead as the alternative", async () => {
    renderIssuer();
    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-letterhead-version')).toHaveLength(2);
    });
    expect(get).toHaveBeenCalledWith('/v1/invoice-issuers/iis_rs/letterheads');
    expect(screen.getByText('settings.invoiceIssuers.letterheadDescription')).toBeTruthy();
    expect(screen.getByText('settings.invoiceIssuers.letterheadCompany')).toBeTruthy();
    // Rendered inside the issuer's dialog, without its own card title.
    expect(screen.queryByText('settings.pdfLetterhead')).toBeNull();
  });

  it("sets the issuer's current version, or the company's", async () => {
    renderIssuer();
    const select = await screen.findByLabelText('settings.pdfLetterheadCurrent');
    fireEvent.change(select, { target: { value: 'lhd_old' } });
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/v1/invoice-issuers/iis_rs/letterhead', {
        letterheadId: 'lhd_old',
      });
    });
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/v1/invoice-issuers/iis_rs/letterhead', {
        letterheadId: null,
      });
    });
  });

  it('creates a version of the issuer', async () => {
    renderIssuer();
    fireEvent.click(await screen.findByText('settings.pdfLetterheadNewVersion'));
    fireEvent.change(screen.getByLabelText('settings.pdfLetterheadName'), {
      target: { value: 'Services 2026' },
    });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'rs.png', {
      type: 'image/png',
    });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await screen.findByTestId('pdf-letterhead-thumbnail');
    fireEvent.click(screen.getByText('settings.pdfLetterheadCreate'));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/v1/invoice-issuers/iis_rs/letterheads',
        expect.objectContaining({ name: 'Services 2026', activate: false }),
      );
    });
  });

  it("previews a version with the issuer's seller", async () => {
    renderIssuer();
    const [first] = await screen.findAllByText('settings.pdfLetterheadPreview');
    if (first != null) fireEvent.click(first);
    await waitFor(() => {
      expect(postForBlob).toHaveBeenCalledWith('/v1/pdf-letterheads/preview', {
        image: IMAGE,
        ...LAYOUT,
        language: 'de',
        issuerId: 'iis_rs',
      });
    });
  });
});

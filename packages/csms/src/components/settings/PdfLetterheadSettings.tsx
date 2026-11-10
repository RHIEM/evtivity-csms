// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileText } from 'lucide-react';
import {
  DEFAULT_PDF_LETTERHEAD_LAYOUT,
  MAX_PDF_LETTERHEAD_BYTES,
  MAX_PDF_LETTERHEAD_NAME_LENGTH,
  MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM,
  MIN_PDF_LETTERHEAD_PNG_WIDTH,
  MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM,
  PDF_LETTERHEAD_LAYOUT_KEYS,
  PDF_LETTERHEAD_LAYOUT_RANGES,
  normalizePdfLetterheadLayout,
} from '@evtivity/lib/pdf-letterhead';
import type { PdfLetterheadLayout } from '@evtivity/lib/pdf-letterhead';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, postForBlob } from '@/lib/api';
import { useHasCompanyWidePermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/error-message';
import { formatDate, useUserTimezone } from '@/lib/timezone';

const IMAGE_TYPES = ['image/png', 'image/svg+xml'];
const MAX_IMAGE_KB = MAX_PDF_LETTERHEAD_BYTES / 1024;

/** The query of an invoice issuer's own letterhead versions. */
export const issuerLetterheadsQueryKey = (issuerId: string) =>
  ['invoice-issuers', issuerId, 'letterheads'] as const;

/** A version as GET /v1/pdf-letterheads lists it (without the image). */
export interface PdfLetterheadVersion extends PdfLetterheadLayout {
  id: string;
  name: string;
  createdAt: string;
  current: boolean;
  invoiceCount: number;
}

type LayoutInput = Record<keyof PdfLetterheadLayout, string>;

interface DraftVersion {
  name: string;
  image: string | null;
  layout: LayoutInput;
  activate: boolean;
}

function layoutInput(layout: PdfLetterheadLayout): LayoutInput {
  const input = {} as LayoutInput;
  for (const key of PDF_LETTERHEAD_LAYOUT_KEYS) input[key] = String(layout[key]);
  return input;
}

function emptyDraft(): DraftVersion {
  return {
    name: '',
    image: null,
    layout: layoutInput(DEFAULT_PDF_LETTERHEAD_LAYOUT),
    activate: false,
  };
}

/** The draft layout as numbers, validated like the API (null when invalid). */
function parsedLayout(input: LayoutInput): PdfLetterheadLayout | null {
  const raw: Record<string, number> = {};
  for (const key of PDF_LETTERHEAD_LAYOUT_KEYS) {
    const value = input[key].trim().replace(',', '.');
    raw[key] = value === '' ? Number.NaN : Number(value);
  }
  return normalizePdfLetterheadLayout(raw);
}

/** The layout values of a stored version, without its other fields. */
function layoutOfVersion(version: PdfLetterheadVersion): PdfLetterheadLayout {
  const layout = {} as PdfLetterheadLayout;
  for (const key of PDF_LETTERHEAD_LAYOUT_KEYS) layout[key] = version[key];
  return layout;
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read the file'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The PDF letterhead: versions of an A4 image drawn as the background of the
 * first page of invoices and credit notes, with the free areas in mm. A
 * version never changes; a new image or layout is a new version, and the
 * current one applies to documents issued from then on. Users without
 * `settings.system:write` or all-site access see the versions but cannot
 * change them.
 *
 * With an invoice issuer it manages the issuer's own versions instead (GET
 * and POST /v1/invoice-issuers/:id/letterheads, PUT .../letterhead): without a
 * current one, its documents take the company's. Rendered then without its
 * card, inside a dialog.
 */
export function PdfLetterheadSettings({
  issuer,
}: {
  issuer?: { id: string; name: string };
} = {}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const timezone = useUserTimezone();
  const canWrite = useHasCompanyWidePermission('settings.system:write');
  const [draft, setDraft] = useState<DraftVersion>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  // The sample PDF shown in a dialog (an object URL of the rendered PDF).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const queryKey = issuer != null ? issuerLetterheadsQueryKey(issuer.id) : ['pdf-letterheads'];
  const versionsPath =
    issuer != null ? `/v1/invoice-issuers/${issuer.id}/letterheads` : '/v1/pdf-letterheads';

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey });
    // The issuer list carries its current version (letterheadId).
    if (issuer != null) void queryClient.invalidateQueries({ queryKey: ['invoice-issuers'] });
  };

  const { data: versions, error } = useQuery({
    queryKey,
    queryFn: () => api.get<PdfLetterheadVersion[]>(versionsPath),
  });
  const current = versions?.find((version) => version.current) ?? null;

  const toastError = (err: unknown): void => {
    toast({
      title: getErrorMessage(err, t, 'settings.pdfLetterheadSaveFailed'),
      variant: 'destructive',
    });
  };

  const currentMutation = useMutation({
    mutationFn: (letterheadId: string | null) =>
      issuer != null
        ? api.put(`/v1/invoice-issuers/${issuer.id}/letterhead`, { letterheadId })
        : api.put('/v1/pdf-letterheads/current', { letterheadId }),
    onSuccess: () => {
      invalidate();
      toast({ title: t('settings.pdfLetterheadCurrentSaved'), variant: 'success' });
    },
    onError: toastError,
  });

  const layout = parsedLayout(draft.layout);
  const name = draft.name.trim();
  const canCreate = draft.image != null && layout != null && name !== '';

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(versionsPath, {
        name,
        image: draft.image,
        ...layout,
        activate: draft.activate,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: t('settings.pdfLetterheadCreated'), variant: 'success' });
      setDraft(emptyDraft());
      setShowForm(false);
    },
    onError: toastError,
  });

  async function handleImageFiles(files: File[]): Promise<void> {
    const file = files[0];
    if (file == null) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast({ title: t('settings.pdfLetterheadInvalidType'), variant: 'destructive' });
      return;
    }
    if (file.size > MAX_PDF_LETTERHEAD_BYTES) {
      toast({
        title: t('settings.pdfLetterheadTooLarge', { maxKb: MAX_IMAGE_KB }),
        variant: 'destructive',
      });
      return;
    }
    try {
      const image = await readAsDataUri(file);
      setDraft((d) => ({ ...d, image }));
    } catch (err) {
      toastError(err);
    }
  }

  function closePreview(): void {
    if (previewUrl != null) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  /** Renders the sample invoice on the image and layout and shows it in the dialog. */
  async function showPreview(image: string, previewLayout: PdfLetterheadLayout): Promise<void> {
    const pdf = await postForBlob('/v1/pdf-letterheads/preview', {
      image,
      ...previewLayout,
      language: i18n.language,
      ...(issuer != null ? { issuerId: issuer.id } : {}),
    });
    closePreview();
    setPreviewUrl(URL.createObjectURL(pdf));
  }

  function preview(image: string, previewLayout: PdfLetterheadLayout): void {
    showPreview(image, previewLayout).catch(toastError);
  }

  async function imageOf(version: PdfLetterheadVersion): Promise<string> {
    const { image } = await api.get<{ image: string }>(`/v1/pdf-letterheads/${version.id}/image`);
    return image;
  }

  function previewVersion(version: PdfLetterheadVersion): void {
    imageOf(version)
      .then((image) => showPreview(image, layoutOfVersion(version)))
      .catch(toastError);
  }

  /** A new version that starts from this one: same image and layout, to adjust. */
  function startFromVersion(version: PdfLetterheadVersion): void {
    imageOf(version)
      .then((image) => {
        setDraft({
          name: version.name,
          image,
          layout: layoutInput(layoutOfVersion(version)),
          activate: false,
        });
        setShowForm(true);
      })
      .catch(toastError);
  }

  const layoutLabels: Record<keyof PdfLetterheadLayout, string> = {
    addressLeftMm: t('settings.pdfLetterheadAddressLeft'),
    addressTopMm: t('settings.pdfLetterheadAddressTop'),
    contentTopMm: t('settings.pdfLetterheadContentTop'),
    contentBottomMm: t('settings.pdfLetterheadContentBottom'),
    marginLeftMm: t('settings.pdfLetterheadMarginLeft'),
    marginRightMm: t('settings.pdfLetterheadMarginRight'),
  };

  const content = (
    <>
      <p className="text-sm text-muted-foreground">
        {t(
          issuer != null
            ? 'settings.invoiceIssuers.letterheadDescription'
            : 'settings.pdfLetterheadDescription',
        )}
      </p>

      {error != null && (
        <p className="text-sm text-destructive">
          {getErrorMessage(error, t, 'settings.pdfLetterheadLoadFailed')}
        </p>
      )}

      {versions != null && (
        <div className="space-y-2">
          <Label htmlFor="pdf-letterhead-current" className="leading-6">
            {t('settings.pdfLetterheadCurrent')}
          </Label>
          <Select
            id="pdf-letterhead-current"
            className="max-w-md"
            value={current?.id ?? ''}
            disabled={!canWrite || currentMutation.isPending}
            onChange={(e) => {
              currentMutation.mutate(e.target.value === '' ? null : e.target.value);
            }}
          >
            <option value="">
              {t(
                issuer != null
                  ? 'settings.invoiceIssuers.letterheadCompany'
                  : 'settings.pdfLetterheadNone',
              )}
            </option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(
              issuer != null
                ? 'settings.invoiceIssuers.letterheadCurrentHelp'
                : 'settings.pdfLetterheadCurrentHelp',
            )}
          </p>
        </div>
      )}

      {versions != null && versions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.pdfLetterheadName')}</TableHead>
              <TableHead>{t('settings.pdfLetterheadCreatedAt')}</TableHead>
              <TableHead className="text-right">
                {t('settings.pdfLetterheadInvoiceCount')}
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((version) => (
              <TableRow key={version.id} data-testid="pdf-letterhead-version">
                <TableCell>
                  <span className="mr-2">{version.name}</span>
                  {version.current && (
                    <Badge variant="success">{t('settings.pdfLetterheadCurrentBadge')}</Badge>
                  )}
                </TableCell>
                <TableCell>{formatDate(version.createdAt, timezone)}</TableCell>
                <TableCell className="text-right">{version.invoiceCount}</TableCell>
                <TableCell className="space-x-2 text-right whitespace-nowrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      previewVersion(version);
                    }}
                  >
                    <FileText className="h-4 w-4" />
                    {t('settings.pdfLetterheadPreview')}
                  </Button>
                  {canWrite && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        startFromVersion(version);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      {t('settings.pdfLetterheadUseAsTemplate')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {versions != null && versions.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('settings.pdfLetterheadNoVersions')}</p>
      )}

      {canWrite && !showForm && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(emptyDraft());
            setShowForm(true);
          }}
        >
          {t('settings.pdfLetterheadNewVersion')}
        </Button>
      )}

      {canWrite && showForm && (
        <form
          className="space-y-4 rounded-md border p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) createMutation.mutate();
          }}
        >
          <h3 className="font-medium">{t('settings.pdfLetterheadNewVersion')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings.pdfLetterheadVersionHelp')}</p>

          <div className="space-y-2">
            <Label htmlFor="pdf-letterhead-name">{t('settings.pdfLetterheadName')}</Label>
            <Input
              id="pdf-letterhead-name"
              className="max-w-md"
              maxLength={MAX_PDF_LETTERHEAD_NAME_LENGTH}
              value={draft.name}
              onChange={(e) => {
                setDraft((d) => ({ ...d, name: e.target.value }));
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('settings.pdfLetterheadImage')}</Label>
            <div className="flex flex-wrap items-start gap-4">
              {draft.image != null && (
                <img
                  src={draft.image}
                  alt={t('settings.pdfLetterheadImage')}
                  data-testid="pdf-letterhead-thumbnail"
                  className="h-56 w-auto rounded border bg-white object-contain"
                />
              )}
              <FileUploadButton
                variant="outline"
                size="sm"
                accept=".png,.svg,image/png,image/svg+xml"
                onFiles={(files) => {
                  void handleImageFiles(files);
                }}
              >
                {t('settings.pdfLetterheadUpload')}
              </FileUploadButton>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.pdfLetterheadImageHelp', {
                maxKb: MAX_IMAGE_KB,
                minWidth: MIN_PDF_LETTERHEAD_PNG_WIDTH,
              })}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
            {PDF_LETTERHEAD_LAYOUT_KEYS.map((key) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`pdf-letterhead-${key}`}>{layoutLabels[key]}</Label>
                <Input
                  id={`pdf-letterhead-${key}`}
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={PDF_LETTERHEAD_LAYOUT_RANGES[key].min}
                  max={PDF_LETTERHEAD_LAYOUT_RANGES[key].max}
                  value={draft.layout[key]}
                  aria-invalid={layout == null}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((d) => ({ ...d, layout: { ...d.layout, [key]: value } }));
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.pdfLetterheadLayoutHelp')}</p>
          {layout == null && (
            <p className="text-sm text-destructive">
              {t('settings.pdfLetterheadLayoutInvalid', {
                minText: MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM,
                minWidth: MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM,
              })}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="pdf-letterhead-activate"
              checked={draft.activate}
              onChange={(e) => {
                const activate = e.target.checked;
                setDraft((d) => ({ ...d, activate }));
              }}
            />
            <Label htmlFor="pdf-letterhead-activate">{t('settings.pdfLetterheadActivate')}</Label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={draft.image == null || layout == null}
              onClick={() => {
                if (draft.image != null && layout != null) preview(draft.image, layout);
              }}
            >
              <FileText className="h-4 w-4" />
              {t('settings.pdfLetterheadPreview')}
            </Button>
            <Button type="submit" disabled={!canCreate || createMutation.isPending}>
              {t('settings.pdfLetterheadCreate')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </>
  );

  const previewDialog = (
    <Dialog
      open={previewUrl != null}
      onOpenChange={(open) => {
        if (!open) closePreview();
      }}
    >
      <DialogContent className="flex h-[90vh] max-w-[95vw] flex-col md:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('settings.pdfLetterheadPreview')}</DialogTitle>
        </DialogHeader>
        {previewUrl != null && (
          <iframe
            src={previewUrl}
            title={t('settings.pdfLetterheadPreview')}
            data-testid="pdf-letterhead-preview"
            className="min-h-0 w-full flex-1 rounded border"
          />
        )}
      </DialogContent>
    </Dialog>
  );

  if (issuer != null) {
    return (
      <div className="space-y-6" data-testid="issuer-letterhead">
        {content}
        {previewDialog}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.pdfLetterhead')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">{content}</CardContent>
      {previewDialog}
    </Card>
  );
}

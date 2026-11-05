// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ParseKeys } from 'i18next';
import { FileText, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  MAX_INVOICE_NUMBER_DIGITS,
  MAX_INVOICE_NUMBER_PREFIX_LENGTH,
  MAX_INVOICE_NUMBER_START,
  formatInvoiceNumber,
  isValidInvoiceNumberPrefix,
} from '@evtivity/lib/invoice-issuer';
import type { InvoiceNumberFormat } from '@evtivity/lib/invoice-issuer';
import {
  MAX_PDF_FOOTER_LENGTH,
  MAX_PDF_FOOTER_LINES,
  MAX_PDF_LOGO_BYTES,
  normalizePdfFooter,
} from '@evtivity/lib/pdf-branding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CreateButton } from '@/components/create-button';
import { SaveButton } from '@/components/save-button';
import {
  PdfLetterheadSettings,
  issuerLetterheadsQueryKey,
} from '@/components/settings/PdfLetterheadSettings';
import type { PdfLetterheadVersion } from '@/components/settings/PdfLetterheadSettings';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHasCompanyWidePermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/error-message';

/** An invoice issuer as GET /v1/invoice-issuers returns it. */
export interface InvoiceIssuer {
  id: string;
  name: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  taxId: string | null;
  taxIdLabel: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  invoicePrefix: string;
  invoiceWithYear: boolean;
  invoiceStart: number;
  invoiceDigits: number;
  creditNotePrefix: string;
  creditNoteWithYear: boolean;
  creditNoteStart: number;
  creditNoteDigits: number;
  /** Footer of its PDFs: null takes the company's, '' draws none. */
  pdfFooter: string | null;
  /** It has its own PDF logo (GET .../pdf-logo); otherwise its PDFs show the company's. */
  hasPdfLogo: boolean;
  /** The current version of its own PDF letterhead; null: the company's. */
  letterheadId: string | null;
  invoiceNumberLocked: boolean;
  creditNoteNumberLocked: boolean;
  fleetCount: number;
}

export const INVOICE_ISSUERS_QUERY_KEY = ['invoice-issuers'] as const;

const TEXT_FIELDS = [
  { key: 'street', label: 'settings.invoiceIssuers.street', max: 255 },
  { key: 'zip', label: 'settings.invoiceIssuers.zip', max: 20 },
  { key: 'city', label: 'settings.invoiceIssuers.city', max: 100 },
  { key: 'state', label: 'settings.invoiceIssuers.state', max: 100 },
  { key: 'country', label: 'settings.invoiceIssuers.country', max: 100 },
  { key: 'taxId', label: 'settings.invoiceSellerTaxId', max: 64 },
  { key: 'taxIdLabel', label: 'settings.invoiceSellerTaxIdLabel', max: 40 },
  { key: 'registrationNumber', label: 'settings.invoiceSellerRegistrationNumber', max: 100 },
  { key: 'email', label: 'settings.invoiceSellerEmail', max: 254 },
  { key: 'phone', label: 'settings.invoiceSellerPhone', max: 40 },
] as const satisfies ReadonlyArray<{ key: keyof InvoiceIssuer; label: ParseKeys; max: number }>;

type TextKey = (typeof TEXT_FIELDS)[number]['key'];

/** The number format of one kind as the form edits it (numbers as text). */
interface FormatValues {
  prefix: string;
  withYear: boolean;
  start: string;
  digits: string;
}

interface FormValues {
  name: string;
  text: Record<TextKey, string>;
  invoice: FormatValues;
  creditNote: FormatValues;
  /** Own footer (else the company's); an empty one draws none. */
  ownFooter: boolean;
  footer: string;
}

const LOGO_TYPES = ['image/png', 'image/svg+xml'];
const MAX_LOGO_KB = MAX_PDF_LOGO_BYTES / 1024;

const issuerLogoQueryKey = (id: string) => ['invoice-issuers', id, 'pdf-logo'] as const;

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

const EMPTY_FORMAT: FormatValues = { prefix: '', withYear: false, start: '1', digits: '0' };

function emptyForm(): FormValues {
  const text = {} as Record<TextKey, string>;
  for (const field of TEXT_FIELDS) text[field.key] = '';
  return {
    name: '',
    text,
    invoice: { ...EMPTY_FORMAT },
    creditNote: { ...EMPTY_FORMAT },
    ownFooter: false,
    footer: '',
  };
}

function formOf(issuer: InvoiceIssuer): FormValues {
  const text = {} as Record<TextKey, string>;
  for (const field of TEXT_FIELDS) text[field.key] = issuer[field.key] ?? '';
  return {
    name: issuer.name,
    text,
    invoice: {
      prefix: issuer.invoicePrefix,
      withYear: issuer.invoiceWithYear,
      start: String(issuer.invoiceStart),
      digits: String(issuer.invoiceDigits),
    },
    creditNote: {
      prefix: issuer.creditNotePrefix,
      withYear: issuer.creditNoteWithYear,
      start: String(issuer.creditNoteStart),
      digits: String(issuer.creditNoteDigits),
    },
    ownFooter: issuer.pdfFooter != null,
    footer: issuer.pdfFooter ?? '',
  };
}

function wholeNumber(value: string, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed <= max ? parsed : null;
}

/** The format when every field is valid, else null. */
function parsedFormat(values: FormatValues): InvoiceNumberFormat | null {
  const start = wholeNumber(values.start, MAX_INVOICE_NUMBER_START);
  const digits = wholeNumber(values.digits, MAX_INVOICE_NUMBER_DIGITS);
  if (start == null || digits == null || !isValidInvoiceNumberPrefix(values.prefix)) return null;
  return { prefix: values.prefix, withYear: values.withYear, start, digits };
}

/** The first number of the format this year, e.g. "RI-2600001". */
export function exampleNumber(
  format: InvoiceNumberFormat,
  year = new Date().getFullYear(),
): string {
  return formatInvoiceNumber(format, format.start, year);
}

function issuerFormat(issuer: InvoiceIssuer, kind: 'invoice' | 'creditNote'): InvoiceNumberFormat {
  return kind === 'invoice'
    ? {
        prefix: issuer.invoicePrefix,
        withYear: issuer.invoiceWithYear,
        start: issuer.invoiceStart,
        digits: issuer.invoiceDigits,
      }
    : {
        prefix: issuer.creditNotePrefix,
        withYear: issuer.creditNoteWithYear,
        start: issuer.creditNoteStart,
        digits: issuer.creditNoteDigits,
      };
}

interface FormatFieldsProps {
  kind: 'invoice' | 'creditNote';
  values: FormatValues;
  locked: boolean;
  submitted: boolean;
  onChange: (next: FormatValues) => void;
}

function FormatFields({ kind, values, locked, submitted, onChange }: FormatFieldsProps) {
  const { t } = useTranslation();
  const format = parsedFormat(values);
  const id = (field: string): string => `issuer-${kind}-${field}`;
  return (
    <fieldset className="space-y-3 rounded-md border p-3" data-testid={`issuer-${kind}-format`}>
      <legend className="px-1 text-sm font-medium">
        {t(
          kind === 'invoice'
            ? 'settings.invoiceIssuers.invoiceNumbers'
            : 'settings.invoiceIssuers.creditNoteNumbers',
        )}
      </legend>
      {locked && (
        <p className="text-xs text-muted-foreground">{t('settings.invoiceIssuers.formatLocked')}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={id('prefix')}>{t('settings.invoiceIssuers.prefix')}</Label>
          <Input
            id={id('prefix')}
            value={values.prefix}
            maxLength={MAX_INVOICE_NUMBER_PREFIX_LENGTH}
            disabled={locked}
            aria-invalid={submitted && !isValidInvoiceNumberPrefix(values.prefix)}
            onChange={(e) => {
              onChange({ ...values, prefix: e.target.value });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('start')}>{t('settings.invoiceIssuers.start')}</Label>
          <Input
            id={id('start')}
            inputMode="numeric"
            value={values.start}
            disabled={locked}
            aria-invalid={submitted && wholeNumber(values.start, MAX_INVOICE_NUMBER_START) == null}
            onChange={(e) => {
              onChange({ ...values, start: e.target.value });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('digits')}>{t('settings.invoiceIssuers.digits')}</Label>
          <Input
            id={id('digits')}
            inputMode="numeric"
            value={values.digits}
            disabled={locked}
            aria-invalid={
              submitted && wholeNumber(values.digits, MAX_INVOICE_NUMBER_DIGITS) == null
            }
            onChange={(e) => {
              onChange({ ...values, digits: e.target.value });
            }}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm" htmlFor={id('year')}>
        <Checkbox
          id={id('year')}
          checked={values.withYear}
          disabled={locked}
          onChange={(e) => {
            onChange({ ...values, withYear: e.target.checked });
          }}
        />
        {t('settings.invoiceIssuers.withYear')}
      </label>
      <p className="text-xs text-muted-foreground" data-testid={`issuer-${kind}-example`}>
        {format != null
          ? t('settings.invoiceIssuers.example', { number: exampleNumber(format) })
          : t('settings.invoiceIssuers.formatInvalid', {
              max: MAX_INVOICE_NUMBER_PREFIX_LENGTH,
            })}
      </p>
    </fieldset>
  );
}

interface BrandingFieldsProps {
  issuer: InvoiceIssuer | null;
  ownFooter: boolean;
  footer: string;
  submitted: boolean;
  onFooterChange: (ownFooter: boolean, footer: string) => void;
}

/**
 * The issuer's own PDF logo and footer, both optional: without them its PDFs
 * show the company's (pdf.logo, pdf.footer). The logo is saved right away
 * (PUT/DELETE .../pdf-logo), so it needs a saved issuer; the footer is saved
 * with the form.
 */
function BrandingFields({
  issuer,
  ownFooter,
  footer,
  submitted,
  onFooterChange,
}: BrandingFieldsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = issuer?.id;

  const { data: logoData } = useQuery({
    queryKey: issuerLogoQueryKey(id ?? ''),
    queryFn: () => api.get<{ logo: string | null }>(`/v1/invoice-issuers/${id ?? ''}/pdf-logo`),
    enabled: id != null,
  });
  const logo = logoData?.logo ?? null;

  const logoMutation = useMutation({
    mutationFn: (value: string | null) =>
      value != null
        ? api.put<InvoiceIssuer>(`/v1/invoice-issuers/${id ?? ''}/pdf-logo`, { logo: value })
        : api.delete<InvoiceIssuer>(`/v1/invoice-issuers/${id ?? ''}/pdf-logo`),
    onSuccess: (_issuer, value) => {
      queryClient.setQueryData(issuerLogoQueryKey(id ?? ''), { logo: value });
      void queryClient.invalidateQueries({ queryKey: INVOICE_ISSUERS_QUERY_KEY, exact: true });
      toast({
        title: t(
          value != null
            ? 'settings.invoiceIssuers.logoSaved'
            : 'settings.invoiceIssuers.logoRemoved',
        ),
        variant: 'success',
      });
    },
    onError: (err: unknown) => {
      toast({
        title: getErrorMessage(err, t, 'settings.pdfBrandingSaveFailed'),
        variant: 'destructive',
      });
    },
  });

  async function handleLogoFiles(files: File[]): Promise<void> {
    const file = files[0];
    if (file == null) return;
    if (!LOGO_TYPES.includes(file.type)) {
      toast({ title: t('settings.pdfLogoInvalidType'), variant: 'destructive' });
      return;
    }
    if (file.size > MAX_PDF_LOGO_BYTES) {
      toast({
        title: t('settings.pdfLogoTooLarge', { maxKb: MAX_LOGO_KB }),
        variant: 'destructive',
      });
      return;
    }
    try {
      logoMutation.mutate(await readAsDataUri(file));
    } catch (err) {
      toast({
        title: getErrorMessage(err, t, 'settings.pdfBrandingSaveFailed'),
        variant: 'destructive',
      });
    }
  }

  const footerInvalid = ownFooter && normalizePdfFooter(footer) == null;

  return (
    <fieldset className="space-y-4 rounded-md border p-3" data-testid="issuer-branding">
      <legend className="px-1 text-sm font-medium">{t('settings.invoiceIssuers.branding')}</legend>
      <p className="text-xs text-muted-foreground">{t('settings.invoiceIssuers.brandingHelp')}</p>

      <div className="space-y-2">
        <Label className="leading-6">{t('settings.pdfLogo')}</Label>
        {id == null ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.invoiceIssuers.logoAfterCreate')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-48 items-center justify-center rounded border bg-white p-2">
              {logo != null ? (
                <img
                  src={logo}
                  alt={t('settings.pdfLogo')}
                  className="max-h-full max-w-full object-contain"
                  data-testid="issuer-logo-preview"
                />
              ) : (
                <span className="text-center text-xs text-muted-foreground">
                  {t('settings.invoiceIssuers.logoCompany')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FileUploadButton
                variant="outline"
                size="sm"
                accept=".png,.svg,image/png,image/svg+xml"
                disabled={logoMutation.isPending}
                onFiles={(files) => {
                  void handleLogoFiles(files);
                }}
              >
                {t('settings.pdfLogoUpload')}
              </FileUploadButton>
              {logo != null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logoMutation.isPending}
                  onClick={() => {
                    logoMutation.mutate(null);
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t('settings.invoiceIssuers.logoRemove')}
                </Button>
              )}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t('settings.pdfLogoHelp', { maxKb: MAX_LOGO_KB })}
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm" htmlFor="issuer-own-footer">
          <Checkbox
            id="issuer-own-footer"
            checked={ownFooter}
            onChange={(e) => {
              onFooterChange(e.target.checked, footer);
            }}
          />
          {t('settings.invoiceIssuers.ownFooter')}
        </label>
        {ownFooter && (
          <>
            <Textarea
              id="issuer-footer"
              aria-label={t('settings.pdfFooter')}
              rows={MAX_PDF_FOOTER_LINES}
              maxLength={MAX_PDF_FOOTER_LENGTH}
              value={footer}
              aria-invalid={submitted && footerInvalid}
              onChange={(e) => {
                onFooterChange(true, e.target.value);
              }}
            />
            {submitted && footerInvalid && (
              <p className="text-sm text-destructive">
                {t('settings.pdfFooterInvalid', {
                  maxLines: MAX_PDF_FOOTER_LINES,
                  maxLength: MAX_PDF_FOOTER_LENGTH,
                })}
              </p>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            ownFooter
              ? 'settings.invoiceIssuers.footerHelpOwn'
              : 'settings.invoiceIssuers.footerHelpCompany',
          )}
        </p>
      </div>
    </fieldset>
  );
}

interface LetterheadFieldProps {
  issuerId: string | undefined;
  onManage: () => void;
}

/**
 * The issuer's own PDF letterhead: the version its new invoices and credit
 * notes keep, or the company's. Managed in its own dialog
 * (PdfLetterheadSettings), so it needs a saved issuer.
 */
function LetterheadField({ issuerId, onManage }: LetterheadFieldProps) {
  const { t } = useTranslation();
  const { data: versions } = useQuery({
    queryKey: issuerLetterheadsQueryKey(issuerId ?? ''),
    queryFn: () =>
      api.get<PdfLetterheadVersion[]>(`/v1/invoice-issuers/${issuerId ?? ''}/letterheads`),
    enabled: issuerId != null,
  });
  const current = versions?.find((version) => version.current) ?? null;

  return (
    <fieldset className="space-y-2 rounded-md border p-3" data-testid="issuer-letterhead-field">
      <legend className="px-1 text-sm font-medium">
        {t('settings.invoiceIssuers.letterhead')}
      </legend>
      {issuerId == null ? (
        <p className="text-xs text-muted-foreground">
          {t('settings.invoiceIssuers.letterheadAfterCreate')}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {current != null
              ? t('settings.invoiceIssuers.letterheadOwn', { name: current.name })
              : t('settings.invoiceIssuers.letterheadUsesCompany')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onManage}>
            <FileText className="h-4 w-4" />
            {t('settings.invoiceIssuers.letterheadManage')}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('settings.invoiceIssuers.letterheadHint')}</p>
    </fieldset>
  );
}

/**
 * The invoice issuers: sellers other than the company that a fleet's invoices
 * can be issued under (fleet billing profile), each with its own number range
 * for invoices and credit notes. A range's format is locked once the issuer
 * issued a document of that kind; an issuer in use cannot be deleted. Users
 * without `settings.system:write` or all-site access see the list only.
 */
export function InvoiceIssuerSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = useHasCompanyWidePermission('settings.system:write');
  const [editing, setEditing] = useState<InvoiceIssuer | 'new' | null>(null);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [submitted, setSubmitted] = useState(false);
  const [deleting, setDeleting] = useState<InvoiceIssuer | null>(null);
  // The issuer whose own letterhead versions are managed in their dialog.
  const [letterheadOf, setLetterheadOf] = useState<InvoiceIssuer | null>(null);

  const { data: issuers = [] } = useQuery({
    queryKey: INVOICE_ISSUERS_QUERY_KEY,
    queryFn: () => api.get<InvoiceIssuer[]>('/v1/invoice-issuers'),
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing != null && editing !== 'new'
        ? api.patch<InvoiceIssuer>(`/v1/invoice-issuers/${editing.id}`, body)
        : api.post<InvoiceIssuer>('/v1/invoice-issuers', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVOICE_ISSUERS_QUERY_KEY });
      setEditing(null);
      toast({ title: t('settings.invoiceIssuers.saved'), variant: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/invoice-issuers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVOICE_ISSUERS_QUERY_KEY });
      setDeleting(null);
      toast({ title: t('settings.invoiceIssuers.deleted'), variant: 'success' });
    },
    onError: (err: unknown) => {
      setDeleting(null);
      toast({ title: getErrorMessage(err, t), variant: 'destructive' });
    },
  });

  function open(target: InvoiceIssuer | 'new'): void {
    saveMutation.reset();
    setSubmitted(false);
    setValues(target === 'new' ? emptyForm() : formOf(target));
    setEditing(target);
  }

  const invoiceFormat = parsedFormat(values.invoice);
  const creditNoteFormat = parsedFormat(values.creditNote);
  const nameInvalid = values.name.trim() === '';
  const footer = values.ownFooter ? normalizePdfFooter(values.footer) : null;
  const footerInvalid = values.ownFooter && footer == null;
  const invalid = nameInvalid || invoiceFormat == null || creditNoteFormat == null || footerInvalid;
  const current = editing != null && editing !== 'new' ? editing : null;

  function submit(): void {
    setSubmitted(true);
    if (invalid) return;
    const body: Record<string, unknown> = { name: values.name.trim() };
    for (const field of TEXT_FIELDS) {
      const trimmed = values.text[field.key].trim();
      body[field.key] = trimmed === '' ? null : trimmed;
    }
    if (current?.invoiceNumberLocked !== true) {
      body['invoicePrefix'] = invoiceFormat.prefix;
      body['invoiceWithYear'] = invoiceFormat.withYear;
      body['invoiceStart'] = invoiceFormat.start;
      body['invoiceDigits'] = invoiceFormat.digits;
    }
    if (current?.creditNoteNumberLocked !== true) {
      body['creditNotePrefix'] = creditNoteFormat.prefix;
      body['creditNoteWithYear'] = creditNoteFormat.withYear;
      body['creditNoteStart'] = creditNoteFormat.start;
      body['creditNoteDigits'] = creditNoteFormat.digits;
    }
    body['pdfFooter'] = footer;
    saveMutation.mutate(body);
  }

  return (
    <Card data-testid="invoice-issuers">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('settings.invoiceIssuers.title')}</CardTitle>
        {canWrite && (
          <CreateButton
            label={t('settings.invoiceIssuers.add')}
            onClick={() => {
              open('new');
            }}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('settings.invoiceIssuers.description')}</p>
        {issuers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.invoiceIssuers.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.invoiceIssuers.name')}</TableHead>
                <TableHead>{t('settings.invoiceIssuers.invoiceNumbers')}</TableHead>
                <TableHead>{t('settings.invoiceIssuers.creditNoteNumbers')}</TableHead>
                <TableHead>{t('settings.invoiceIssuers.fleets')}</TableHead>
                {canWrite && <TableHead className="text-right">{t('common.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {issuers.map((issuer) => {
                const inUse =
                  issuer.fleetCount > 0 ||
                  issuer.invoiceNumberLocked ||
                  issuer.creditNoteNumberLocked;
                return (
                  <TableRow key={issuer.id}>
                    <TableCell className="font-medium">{issuer.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {exampleNumber(issuerFormat(issuer, 'invoice'))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {exampleNumber(issuerFormat(issuer, 'creditNote'))}
                    </TableCell>
                    <TableCell>{issuer.fleetCount}</TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.edit')}
                          onClick={() => {
                            open(issuer);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.delete')}
                          disabled={inUse}
                          title={inUse ? t('settings.invoiceIssuers.inUse') : undefined}
                          onClick={() => {
                            setDeleting(issuer);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={editing != null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t(current != null ? 'settings.invoiceIssuers.edit' : 'settings.invoiceIssuers.add')}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="issuer-name">{t('settings.invoiceIssuers.name')}</Label>
              <Input
                id="issuer-name"
                value={values.name}
                maxLength={255}
                aria-invalid={submitted && nameInvalid}
                onChange={(e) => {
                  setValues((prev) => ({ ...prev, name: e.target.value }));
                }}
              />
              {submitted && nameInvalid && (
                <p className="text-sm text-destructive">
                  {t('settings.invoiceIssuers.nameRequired')}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`issuer-${field.key}`}>{t(field.label)}</Label>
                  <Input
                    id={`issuer-${field.key}`}
                    type={field.key === 'email' ? 'email' : 'text'}
                    value={values.text[field.key]}
                    maxLength={field.max}
                    onChange={(e) => {
                      const next = e.target.value;
                      setValues((prev) => ({ ...prev, text: { ...prev.text, [field.key]: next } }));
                    }}
                  />
                </div>
              ))}
            </div>
            <FormatFields
              kind="invoice"
              values={values.invoice}
              locked={current?.invoiceNumberLocked === true}
              submitted={submitted}
              onChange={(next) => {
                setValues((prev) => ({ ...prev, invoice: next }));
              }}
            />
            <FormatFields
              kind="creditNote"
              values={values.creditNote}
              locked={current?.creditNoteNumberLocked === true}
              submitted={submitted}
              onChange={(next) => {
                setValues((prev) => ({ ...prev, creditNote: next }));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.invoiceIssuers.numbersHelp')}
            </p>
            <BrandingFields
              issuer={current}
              ownFooter={values.ownFooter}
              footer={values.footer}
              submitted={submitted}
              onFooterChange={(ownFooter, footerText) => {
                setValues((prev) => ({ ...prev, ownFooter, footer: footerText }));
              }}
            />
            <LetterheadField
              issuerId={current?.id}
              onManage={() => {
                if (current != null) setLetterheadOf(current);
              }}
            />
            {saveMutation.isError && (
              <p className="text-sm text-destructive">
                {getErrorMessage(saveMutation.error, t, 'settings.invoiceIssuers.saveFailed')}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setEditing(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <SaveButton isPending={saveMutation.isPending} />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={letterheadOf != null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setLetterheadOf(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto md:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t('settings.invoiceIssuers.letterheadTitle', { name: letterheadOf?.name ?? '' })}
            </DialogTitle>
          </DialogHeader>
          {letterheadOf != null && (
            <PdfLetterheadSettings issuer={{ id: letterheadOf.id, name: letterheadOf.name }} />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleting(null);
        }}
        title={t('settings.invoiceIssuers.delete')}
        description={t('settings.invoiceIssuers.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting != null) deleteMutation.mutate(deleting.id);
        }}
      />
    </Card>
  );
}

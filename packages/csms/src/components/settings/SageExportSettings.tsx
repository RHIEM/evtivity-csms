// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ParseKeys } from 'i18next';
import {
  SAGE_BOOKING_DATE_KEY,
  SAGE_DEBTOR_PREFIX_KEY,
  SAGE_EXPORT_DEFAULTS,
  SAGE_EXPORT_MAX_LENGTHS,
  SAGE_EXPORT_SETTING_KEYS,
  SAGE_FILE_NAME_KEY,
  SAGE_MANDANT_KEY,
  SAGE_OP_NUMBER_KEY,
  SAGE_PAYMENT_TERMS_KEY,
  SAGE_POSTING_TEXT_KEY,
  SAGE_REVENUE_ACCOUNT_KEY,
  SAGE_REVENUE_ACCOUNT_PREFIX_KEY,
  SAGE_TAX_CODES_KEY,
  SAGE_TAX_KIND_KEY,
  normalizeSageExportSetting,
} from '@evtivity/lib/sage-export';
import type { SageExportSettingKey } from '@evtivity/lib/sage-export';
import { SaveButton } from '@/components/save-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useHasCompanyWidePermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/error-message';
import { useLoadedValues } from '@/hooks/use-loaded-values';

type SageValues = Record<SageExportSettingKey, string>;

interface TextField {
  key: SageExportSettingKey;
  id: string;
  label: ParseKeys;
  help?: ParseKeys;
  /** Needed for the export to run: no default. */
  required?: boolean;
}

interface ChoiceField {
  key: SageExportSettingKey;
  id: string;
  label: ParseKeys;
  options: Array<{ value: string; label: ParseKeys }>;
}

const TEXT_FIELDS: TextField[] = [
  {
    key: SAGE_MANDANT_KEY,
    id: 'sage-mandant',
    label: 'settings.sageExportMandant',
    help: 'settings.sageExportMandantHelp',
    required: true,
  },
  {
    key: SAGE_FILE_NAME_KEY,
    id: 'sage-file-name',
    label: 'settings.sageExportFileName',
    help: 'settings.sageExportFileNameHelp',
  },
  {
    key: SAGE_DEBTOR_PREFIX_KEY,
    id: 'sage-debtor-prefix',
    label: 'settings.sageExportDebtorPrefix',
    help: 'settings.sageExportDebtorPrefixHelp',
  },
  {
    key: SAGE_REVENUE_ACCOUNT_PREFIX_KEY,
    id: 'sage-revenue-account-prefix',
    label: 'settings.sageExportRevenueAccountPrefix',
    help: 'settings.sageExportRevenueAccountPrefixHelp',
  },
  {
    key: SAGE_REVENUE_ACCOUNT_KEY,
    id: 'sage-revenue-account',
    label: 'settings.sageExportRevenueAccount',
    help: 'settings.sageExportRevenueAccountHelp',
    required: true,
  },
  {
    key: SAGE_TAX_KIND_KEY,
    id: 'sage-tax-kind',
    label: 'settings.sageExportTaxKind',
    help: 'settings.sageExportTaxKindHelp',
  },
  {
    key: SAGE_TAX_CODES_KEY,
    id: 'sage-tax-codes',
    label: 'settings.sageExportTaxCodes',
    help: 'settings.sageExportTaxCodesHelp',
    required: true,
  },
  {
    key: SAGE_PAYMENT_TERMS_KEY,
    id: 'sage-payment-terms',
    label: 'settings.sageExportPaymentTerms',
    help: 'settings.sageExportPaymentTermsHelp',
    required: true,
  },
  {
    key: SAGE_POSTING_TEXT_KEY,
    id: 'sage-posting-text',
    label: 'settings.sageExportPostingText',
    help: 'settings.sageExportPostingTextHelp',
  },
];

const CHOICE_FIELDS: ChoiceField[] = [
  {
    key: SAGE_BOOKING_DATE_KEY,
    id: 'sage-booking-date',
    label: 'settings.sageExportBookingDate',
    options: [
      { value: 'invoiceDate', label: 'settings.sageExportBookingDateInvoice' },
      { value: 'periodEnd', label: 'settings.sageExportBookingDatePeriodEnd' },
    ],
  },
  {
    key: SAGE_OP_NUMBER_KEY,
    id: 'sage-op-number',
    label: 'settings.sageExportOpNumber',
    options: [
      { value: 'empty', label: 'settings.sageExportOpNumberEmpty' },
      { value: 'invoiceNumber', label: 'settings.sageExportOpNumberInvoice' },
    ],
  },
];

function storedValues(settings: Record<string, unknown> | undefined): SageValues {
  const values = {} as SageValues;
  for (const key of SAGE_EXPORT_SETTING_KEYS) {
    const stored = settings?.[key];
    values[key] = typeof stored === 'string' ? stored : '';
  }
  return values;
}

interface Props {
  settings: Record<string, unknown> | undefined;
}

/**
 * RHIEM: the settings of the Sage export (report type "Sage invoice export"):
 * the accounts, tax codes, payment terms and texts of the RAB file. Users
 * without `settings.system:write` or all-site access see the values but cannot
 * change them.
 */
export function SageExportSettings({ settings }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = useHasCompanyWidePermission('settings.system:write');
  const [submitted, setSubmitted] = useState(false);
  const loaded = useMemo(() => storedValues(settings), [settings]);
  const [values, setValues, takeNextLoad] = useLoadedValues<SageValues>(loaded, () => {
    setSubmitted(false);
  });

  const mutation = useMutation({
    mutationFn: async (next: SageValues) => {
      for (const key of SAGE_EXPORT_SETTING_KEYS) {
        await api.put(`/v1/settings/${key}`, { value: next[key] });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const normalized = {} as Record<SageExportSettingKey, string | null>;
  for (const key of SAGE_EXPORT_SETTING_KEYS) {
    normalized[key] = normalizeSageExportSetting(key, values[key]);
  }
  const invalid = SAGE_EXPORT_SETTING_KEYS.some((key) => normalized[key] == null);

  function errorFor(key: SageExportSettingKey): string | null {
    if (!submitted || normalized[key] != null) return null;
    return t('settings.sageExportInvalid', { max: SAGE_EXPORT_MAX_LENGTHS[key] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.sageExport')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (!canWrite || invalid) return;
            const next = {} as SageValues;
            for (const key of SAGE_EXPORT_SETTING_KEYS) next[key] = normalized[key] ?? '';
            const sent = values;
            mutation.mutate(next, {
              onSuccess: () => {
                takeNextLoad(sent);
              },
            });
          }}
          noValidate
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">{t('settings.sageExportDescription')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 items-start">
            {TEXT_FIELDS.map((field) => {
              const error = errorFor(field.key);
              return (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.id} className="leading-6">
                    {t(field.label)}
                    {field.required === true ? ' *' : ''}
                  </Label>
                  <Input
                    id={field.id}
                    maxLength={SAGE_EXPORT_MAX_LENGTHS[field.key]}
                    placeholder={SAGE_EXPORT_DEFAULTS[field.key]}
                    value={values[field.key]}
                    disabled={!canWrite}
                    aria-invalid={error != null}
                    onChange={(e) => {
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }));
                    }}
                  />
                  {error != null && <p className="text-sm text-destructive">{error}</p>}
                  {field.help != null && (
                    <p className="text-xs text-muted-foreground">{t(field.help)}</p>
                  )}
                </div>
              );
            })}
            {CHOICE_FIELDS.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.id} className="leading-6">
                  {t(field.label)}
                </Label>
                <Select
                  id={field.id}
                  value={
                    values[field.key] === ''
                      ? (SAGE_EXPORT_DEFAULTS[field.key] ?? '')
                      : values[field.key]
                  }
                  disabled={!canWrite}
                  onChange={(e) => {
                    setValues((prev) => ({ ...prev, [field.key]: e.target.value }));
                  }}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>

          {canWrite && <SaveButton isPending={mutation.isPending} />}
          {mutation.isSuccess && (
            <p className="text-sm text-success">{t('settings.sageExportSaved')}</p>
          )}
          {mutation.isError && (
            <p className="text-sm text-destructive">
              {getErrorMessage(mutation.error, t, 'settings.sageExportSaveFailed')}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { INVOICE_EXTERNAL_INVOICING_KEY } from '@evtivity/lib/invoice-payment';
import { SaveButton } from '@/components/save-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ConfirmToggle } from '@/components/ui/confirm-toggle';
import { api } from '@/lib/api';
import { useHasCompanyWidePermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/error-message';
import { useLoadedValues } from '@/hooks/use-loaded-values';

interface Props {
  settings: Record<string, unknown> | undefined;
}

/**
 * The external invoicing switch (`invoice.externalInvoicing`): member
 * invoices are issued as paid and stay internal, and each driver gets a
 * session report instead (email and portal). Users without
 * `settings.system:write` or all-site access see the value but cannot change it.
 */
export function InvoiceExternalInvoicingSettings({ settings }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = useHasCompanyWidePermission('settings.system:write');
  const loaded = useMemo(
    () => ({ enabled: settings?.[INVOICE_EXTERNAL_INVOICING_KEY] === true }),
    [settings],
  );
  const [form, setForm, takeNextLoad] = useLoadedValues(loaded);

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await api.put(`/v1/settings/${INVOICE_EXTERNAL_INVOICING_KEY}`, { value: enabled });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.externalInvoicing')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canWrite) return;
            const sent = form;
            mutation.mutate(form.enabled, {
              onSuccess: () => {
                takeNextLoad(sent);
              },
            });
          }}
          noValidate
          className="space-y-4"
        >
          <div className="flex items-start gap-3">
            <ConfirmToggle
              id="invoice-external-invoicing"
              label={t('settings.externalInvoicingToggle')}
              checked={form.enabled}
              disabled={!canWrite}
              onCheckedChange={(checked) => {
                setForm({ enabled: checked });
              }}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="invoice-external-invoicing">
                {t('settings.externalInvoicingToggle')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('settings.externalInvoicingHelp')}</p>
            </div>
          </div>

          {canWrite && <SaveButton isPending={mutation.isPending} />}
          {mutation.isSuccess && (
            <p className="text-sm text-success">{t('settings.externalInvoicingSaved')}</p>
          )}
          {mutation.isError && (
            <p className="text-sm text-destructive">
              {getErrorMessage(mutation.error, t, 'settings.externalInvoicingSaveFailed')}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

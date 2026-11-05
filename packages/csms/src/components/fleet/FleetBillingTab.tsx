// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { TabPanel } from '@/components/ui/tab-panel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, getApiErrorCode } from '@/lib/api';
import { useHasPermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/error-message';
import { formatDateTime, useUserTimezone } from '@/lib/timezone';

/** Who the account invoices of a fleet go to: the fleet, or each member driver. */
export type AccountInvoiceRecipient = 'fleet' | 'member';

export interface FleetBillingTabProps {
  fleet: {
    id: string;
    accountBillingEnabled?: boolean;
    accountInvoiceRecipient?: AccountInvoiceRecipient;
  };
}

/**
 * When a 409 FLEET_BILLING_OLD_PODS_CONNECTED found no older process connected
 * now but one seen recently: the time the change is allowed from
 * (`details.allowedFrom`). Null for any other error.
 */
export function oldProcessAllowedFrom(err: unknown): string | null {
  if (!(err instanceof ApiError) || getApiErrorCode(err) !== 'FLEET_BILLING_OLD_PODS_CONNECTED') {
    return null;
  }
  const details = (err.body as { details?: unknown } | null)?.details;
  if (details == null || typeof details !== 'object') return null;
  const { oldConnections, allowedFrom } = details as {
    oldConnections?: unknown;
    allowedFrom?: unknown;
  };
  if (oldConnections !== 0 || typeof allowedFrom !== 'string') return null;
  return Number.isNaN(Date.parse(allowedFrom)) ? null : allowedFrom;
}

/** The change a confirm dialog asks for. */
type PendingChange =
  | { kind: 'enabled'; value: boolean }
  | { kind: 'recipient'; value: AccountInvoiceRecipient };

interface FleetBillingChange {
  /** fleets:write and payments:write, as the API. */
  canWrite: boolean;
  isPending: boolean;
  /** Opens the confirmation of a change. */
  request: (change: PendingChange) => void;
  /** The confirm dialog and the inline refusal of an older release. */
  ui: React.JSX.Element;
}

/**
 * A change of charge on account or of the invoice recipient
 * (PATCH /v1/fleets/:id/billing) after a confirm dialog. The API refuses a
 * change older processes cannot follow (409 FLEET_BILLING_OLD_PODS_CONNECTED),
 * or cannot confirm the upgrade because the worker's version check is stale
 * (409 FLEET_BILLING_VERSION_CHECK_STALE); `ui` shows either inline. When no
 * older process is connected but one ran until recently, it names the time the
 * change is allowed from, in the user's time zone and language. Any other
 * refusal is a toast.
 */
function useFleetBillingChange(fleetId: string): FleetBillingChange {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Fleet billing changes money: fleets:write and payments:write, as the API.
  const canWriteFleets = useHasPermission('fleets:write');
  const canWritePayments = useHasPermission('payments:write');
  const timezone = useUserTimezone();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (change: PendingChange) =>
      api.patch(
        `/v1/fleets/${fleetId}/billing`,
        change.kind === 'enabled'
          ? { accountBillingEnabled: change.value }
          : { accountInvoiceRecipient: change.value },
      ),
    onSuccess: () => {
      toast({ title: t('fleets.billing.updated'), variant: 'success' });
      setUpgradeError(null);
      void queryClient.invalidateQueries({ queryKey: ['fleets', fleetId] });
      setPending(null);
    },
    onError: (err) => {
      const code = getApiErrorCode(err);
      if (
        code === 'FLEET_BILLING_OLD_PODS_CONNECTED' ||
        code === 'FLEET_BILLING_VERSION_CHECK_STALE'
      ) {
        const allowedFrom = oldProcessAllowedFrom(err);
        setUpgradeError(
          allowedFrom != null
            ? t('fleets.billing.oldProcessRecent', {
                time: formatDateTime(allowedFrom, timezone),
              })
            : getErrorMessage(err, t),
        );
      } else {
        toast({
          title: t('fleets.billing.updateFailed'),
          description: getErrorMessage(err, t),
          variant: 'destructive',
        });
      }
      setPending(null);
    },
  });

  const dialog =
    pending == null
      ? null
      : pending.kind === 'enabled'
        ? {
            title: pending.value
              ? t('fleets.billing.enableTitle')
              : t('fleets.billing.disableTitle'),
            description: pending.value
              ? t('fleets.billing.enableConfirm')
              : t('fleets.billing.disableConfirm'),
            confirmLabel: pending.value ? t('fleets.billing.enable') : t('fleets.billing.disable'),
          }
        : {
            title:
              pending.value === 'member'
                ? t('fleets.billing.recipientTitleMember')
                : t('fleets.billing.recipientTitleFleet'),
            description:
              pending.value === 'member'
                ? t('fleets.billing.recipientConfirmMember')
                : t('fleets.billing.recipientConfirmFleet'),
            confirmLabel: t('fleets.billing.recipientChange'),
          };

  return {
    canWrite: canWriteFleets && canWritePayments,
    isPending: mutation.isPending,
    request: setPending,
    ui: (
      <>
        {upgradeError != null && (
          <p className="text-destructive" role="alert" data-testid="fleet-billing-upgrade-error">
            {upgradeError}
          </p>
        )}
        <ConfirmDialog
          open={pending != null}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          title={dialog?.title ?? ''}
          description={dialog?.description ?? ''}
          confirmLabel={dialog?.confirmLabel ?? ''}
          variant="default"
          isPending={mutation.isPending}
          onConfirm={() => {
            if (pending != null) mutation.mutate(pending);
            return false;
          }}
        />
      </>
    ),
  };
}

/**
 * Who the account invoices of the fleet go to: one fleet invoice, or one
 * invoice per member driver. Saved right away after a confirmation; it leads
 * the invoice recipient group of the billing profile (FleetBillingProfileCard).
 */
export function FleetInvoiceRecipientField({ fleet }: FleetBillingTabProps): React.JSX.Element {
  const { t } = useTranslation();
  const change = useFleetBillingChange(fleet.id);
  const recipient: AccountInvoiceRecipient = fleet.accountInvoiceRecipient ?? 'fleet';
  return (
    <div className="space-y-2" data-testid="fleet-invoice-recipient-field">
      <Label htmlFor="fleet-invoice-recipient">{t('fleets.billing.invoiceTo')}</Label>
      <Select
        id="fleet-invoice-recipient"
        className="sm:max-w-xs"
        value={recipient}
        disabled={!change.canWrite || change.isPending}
        onChange={(event) => {
          const value = event.target.value as AccountInvoiceRecipient;
          if (value !== recipient) change.request({ kind: 'recipient', value });
        }}
      >
        <option value="fleet">{t('fleets.billing.recipientFleet')}</option>
        <option value="member">{t('fleets.billing.recipientMember')}</option>
      </Select>
      <p className="text-xs text-muted-foreground">
        {recipient === 'member'
          ? t('fleets.billing.recipientHelpMember')
          : t('fleets.billing.recipientHelpFleet')}
      </p>
      {change.ui}
    </div>
  );
}

/**
 * Charge on account for the fleet: the members' sessions are billed on
 * account. Who the account invoices go to is the first field of the billing
 * profile (FleetInvoiceRecipientField).
 */
export function FleetBillingTab({ fleet }: FleetBillingTabProps): React.JSX.Element {
  const { t } = useTranslation();
  const change = useFleetBillingChange(fleet.id);
  const enabled = fleet.accountBillingEnabled === true;

  return (
    <TabPanel
      data-testid="fleet-billing"
      title={t('fleets.billingTab')}
      description={t('fleets.billing.description')}
      bodyClassName="space-y-4 text-sm"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Toggle
            id="fleet-account-billing"
            checked={enabled}
            disabled={!change.canWrite || change.isPending}
            aria-label={t('fleets.billing.chargeOnAccount')}
            onCheckedChange={() => {
              change.request({ kind: 'enabled', value: !enabled });
            }}
          />
          <Label htmlFor="fleet-account-billing">{t('fleets.billing.chargeOnAccount')}</Label>
          <Badge variant={enabled ? 'success' : 'outline'}>
            {enabled ? t('fleets.billing.on') : t('fleets.billing.off')}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          {enabled ? t('fleets.billing.helpOn') : t('fleets.billing.helpOff')}
        </p>
      </div>
      {change.ui}
    </TabPanel>
  );
}

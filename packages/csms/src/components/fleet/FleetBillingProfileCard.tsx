// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { TabPanel } from '@/components/ui/tab-panel';
import { CancelButton } from '@/components/cancel-button';
import { EditButton } from '@/components/edit-button';
import { SaveButton } from '@/components/save-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { LanguageSelect, LANGUAGES } from '@/components/ui/language-select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHasPermission } from '@/lib/auth';
import { getErrorMessage } from '@/lib/error-message';
import {
  INVOICE_ISSUERS_QUERY_KEY,
  type InvoiceIssuer,
} from '@/components/settings/InvoiceIssuerSettings';
import { FleetInvoiceRecipientField, type AccountInvoiceRecipient } from './FleetBillingTab';

/** The fleet billing profile as the API returns it on the fleet. */
export interface FleetBillingProfile {
  billingContactEmails: string[];
  billingLegalName: string | null;
  billingStreet: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  billingCountry: string | null;
  billingTaxId: string | null;
  invoiceLanguage: string;
  paymentTermsDays: number | null;
  autoInvoice: boolean;
  invoiceDateMode: InvoiceDateMode;
  /** The invoice issuer of the fleet's invoices; null: the company. */
  invoiceIssuerId: string | null;
  /** payment: paid through EVtivity; external: settled outside it (e.g. payroll). */
  accountSettlement: AccountSettlement;
  /** Printed on externally settled invoices instead of the payment block. */
  settlementNote: string | null;
  /** Who the member invoices are emailed to: the driver, the billing contacts or nobody. */
  memberInvoiceDelivery: MemberInvoiceDelivery;
}

/** The date of the fleet's account invoices: the issue day or the last day of the billed month. */
export type InvoiceDateMode = 'run_date' | 'period_end';

/** How the fleet's account invoices are settled. */
export type AccountSettlement = 'payment' | 'external';

/** Who a fleet's member invoices are emailed to; none keeps them in the CSMS. */
export type MemberInvoiceDelivery = 'driver' | 'billing_contacts' | 'driver_and_contacts' | 'none';

export interface FleetBillingProfileCardProps {
  fleet: {
    id: string;
    name: string;
    accountBillingEnabled?: boolean;
    accountInvoiceRecipient?: AccountInvoiceRecipient;
  } & Partial<FleetBillingProfile>;
}

function memberInvoiceDeliveryOf(value: string | undefined): MemberInvoiceDelivery {
  return value === 'billing_contacts' || value === 'driver_and_contacts' || value === 'none'
    ? value
    : 'driver';
}

/** The two delivery checkboxes of a member invoice delivery. */
export function memberDeliveryFlags(delivery: MemberInvoiceDelivery): {
  toDriver: boolean;
  toContacts: boolean;
} {
  return {
    toDriver: delivery === 'driver' || delivery === 'driver_and_contacts',
    toContacts: delivery === 'billing_contacts' || delivery === 'driver_and_contacts',
  };
}

/** The member invoice delivery of the two checkboxes. */
export function memberDeliveryOfFlags(
  toDriver: boolean,
  toContacts: boolean,
): MemberInvoiceDelivery {
  if (toDriver && toContacts) return 'driver_and_contacts';
  if (toDriver) return 'driver';
  return toContacts ? 'billing_contacts' : 'none';
}

/**
 * Whether the fleet's invoices are emailed to its billing contacts: the fleet
 * invoice, or member invoices delivered to the contacts (as the API's
 * fleetBillingContactsUsed). Only then the contacts field is shown.
 */
export function billingContactsUsed(
  recipient: AccountInvoiceRecipient,
  delivery: MemberInvoiceDelivery,
): boolean {
  return recipient !== 'member' || memberDeliveryFlags(delivery).toContacts;
}

const MEMBER_DELIVERY_HELP = {
  driver: 'fleets.billingProfile.memberDeliveryHelpDriver',
  billing_contacts: 'fleets.billingProfile.memberDeliveryHelpContacts',
  driver_and_contacts: 'fleets.billingProfile.memberDeliveryHelpBoth',
  none: 'fleets.billingProfile.memberDeliveryHelpNone',
} as const;

const MEMBER_DELIVERY_LABEL = {
  driver: 'fleets.billingProfile.memberDeliveryDriver',
  billing_contacts: 'fleets.billingProfile.memberDeliveryContacts',
  driver_and_contacts: 'fleets.billingProfile.memberDeliveryBoth',
  none: 'fleets.billingProfile.memberDeliveryNone',
} as const;

export const MAX_BILLING_CONTACTS = 10;
const MAX_PAYMENT_TERMS_DAYS = 365;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  contacts: string;
  legalName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  taxId: string;
  language: string;
  paymentTerms: string;
  autoInvoice: boolean;
  invoiceDateMode: InvoiceDateMode;
  /** '' for the company. */
  invoiceIssuerId: string;
  accountSettlement: AccountSettlement;
  settlementNote: string;
  memberInvoiceDelivery: MemberInvoiceDelivery;
}

/** Splits the contacts field (one per line, or comma or semicolon separated). */
export function parseContactEmails(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((e) => e.trim())
    .filter((e) => e !== '');
}

function toForm(fleet: FleetBillingProfileCardProps['fleet']): FormState {
  return {
    contacts: (fleet.billingContactEmails ?? []).join('\n'),
    legalName: fleet.billingLegalName ?? '',
    street: fleet.billingStreet ?? '',
    city: fleet.billingCity ?? '',
    state: fleet.billingState ?? '',
    zip: fleet.billingZip ?? '',
    country: fleet.billingCountry ?? '',
    taxId: fleet.billingTaxId ?? '',
    language: fleet.invoiceLanguage ?? 'en',
    paymentTerms: fleet.paymentTermsDays == null ? '' : String(fleet.paymentTermsDays),
    autoInvoice: fleet.autoInvoice === true,
    invoiceDateMode: fleet.invoiceDateMode === 'period_end' ? 'period_end' : 'run_date',
    invoiceIssuerId: fleet.invoiceIssuerId ?? '',
    accountSettlement: fleet.accountSettlement === 'external' ? 'external' : 'payment',
    settlementNote: fleet.settlementNote ?? '',
    memberInvoiceDelivery: memberInvoiceDeliveryOf(fleet.memberInvoiceDelivery),
  };
}

const textOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * Fleet billing profile in two groups. Invoice recipient: who the invoices go
 * to (FleetInvoiceRecipientField, saved right away) and only the fields that
 * apply to it: for the fleet invoice the bill-to block, its language and the
 * email addresses; for member invoices where they are emailed (the driver,
 * fixed addresses or nobody) and the addresses when they apply. Issue: issuer,
 * invoice date, settlement, payment terms (not for an external settlement) and
 * the monthly run. Hidden fields keep their values.
 */
export function FleetBillingProfileCard({
  fleet,
}: FleetBillingProfileCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Fleet billing changes money: fleets:write and payments:write, as the API.
  const canWriteFleets = useHasPermission('fleets:write');
  const canWritePayments = useHasPermission('payments:write');
  const canWrite = canWriteFleets && canWritePayments;
  const [editing, setEditing] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm(fleet));
  // The issuers need settings.system:read; without it only the company is offered.
  const { data: issuers = [] } = useQuery({
    queryKey: INVOICE_ISSUERS_QUERY_KEY,
    queryFn: () => api.get<InvoiceIssuer[]>('/v1/invoice-issuers'),
    retry: false,
  });
  const issuerName = (id: string | null | undefined): string =>
    id == null || id === ''
      ? t('fleets.billingProfile.issuerCompany')
      : (issuers.find((issuer) => issuer.id === id)?.name ?? id);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/v1/fleets/${fleet.id}/billing-profile`, body),
    onSuccess: () => {
      toast({ title: t('fleets.billingProfile.updated'), variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['fleets', fleet.id] });
      setEditing(false);
      setHasSubmitted(false);
    },
    onError: (err) => {
      toast({
        title: t('fleets.billingProfile.updateFailed'),
        description: getErrorMessage(err, t),
        variant: 'destructive',
      });
    },
  });

  const recipient: AccountInvoiceRecipient = fleet.accountInvoiceRecipient ?? 'fleet';
  const contacts = parseContactEmails(form.contacts);
  const contactsUsed = billingContactsUsed(recipient, form.memberInvoiceDelivery);
  const errors: Partial<Record<'contacts' | 'paymentTerms', string>> = {};
  if (contacts.some((e) => !EMAIL_PATTERN.test(e))) {
    errors.contacts = t('fleets.billingProfile.contactsInvalid');
  } else if (contacts.length > MAX_BILLING_CONTACTS) {
    errors.contacts = t('fleets.billingProfile.contactsTooMany', { max: MAX_BILLING_CONTACTS });
  } else if (form.autoInvoice && contactsUsed && contacts.length === 0) {
    errors.contacts = t('errors.FLEET_BILLING_CONTACT_REQUIRED');
  }
  const terms = form.paymentTerms.trim();
  if (terms !== '' && (!/^\d+$/.test(terms) || Number(terms) > MAX_PAYMENT_TERMS_DAYS)) {
    errors.paymentTerms = t('fleets.billingProfile.paymentTermsInvalid', {
      max: MAX_PAYMENT_TERMS_DAYS,
    });
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit(): void {
    setForm(toForm(fleet));
    setHasSubmitted(false);
    setEditing(true);
  }

  function handleSave(e: React.SyntheticEvent): void {
    e.preventDefault();
    setHasSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate({
      billingContactEmails: contacts,
      billingLegalName: textOrNull(form.legalName),
      billingStreet: textOrNull(form.street),
      billingCity: textOrNull(form.city),
      billingState: textOrNull(form.state),
      billingZip: textOrNull(form.zip),
      billingCountry: textOrNull(form.country),
      billingTaxId: textOrNull(form.taxId),
      invoiceLanguage: form.language,
      paymentTermsDays: terms === '' ? null : Number(terms),
      invoiceIssuerId: form.invoiceIssuerId === '' ? null : form.invoiceIssuerId,
      accountSettlement: form.accountSettlement,
      settlementNote: textOrNull(form.settlementNote),
      memberInvoiceDelivery: form.memberInvoiceDelivery,
      autoInvoice: form.autoInvoice,
      invoiceDateMode: form.invoiceDateMode,
    });
  }

  const textField = (
    key: 'legalName' | 'street' | 'city' | 'state' | 'zip' | 'country' | 'taxId',
    label: string,
    maxLength: number,
  ): React.JSX.Element => (
    <div className="space-y-2">
      <Label htmlFor={`billing-${key}`}>{label}</Label>
      <Input
        id={`billing-${key}`}
        value={form[key]}
        maxLength={maxLength}
        onChange={(e) => {
          set(key, e.target.value);
        }}
      />
    </div>
  );

  const languageLabel =
    LANGUAGES.find((l) => l.code === (fleet.invoiceLanguage ?? 'en'))?.label ?? 'English';
  const address = [
    fleet.billingStreet,
    [fleet.billingZip, fleet.billingCity].filter((v) => v != null && v !== '').join(' '),
    fleet.billingState,
    fleet.billingCountry,
  ].filter((v) => v != null && v !== '');
  const savedContacts = fleet.billingContactEmails ?? [];
  const savedDelivery = memberInvoiceDeliveryOf(fleet.memberInvoiceDelivery);
  const savedContactsUsed = billingContactsUsed(recipient, savedDelivery);
  const external = fleet.accountSettlement === 'external';

  const groupTitle = (key: 'groupRecipient' | 'groupIssue') => (
    <h3 className="text-sm font-semibold">{t(`fleets.billingProfile.${key}`)}</h3>
  );

  const contactsField = (
    <div className="space-y-2 md:col-span-2">
      <Label htmlFor="billing-contacts">{t('fleets.billingProfile.contacts')}</Label>
      <Textarea
        id="billing-contacts"
        value={form.contacts}
        onChange={(e) => {
          set('contacts', e.target.value);
        }}
        className={hasSubmitted && errors.contacts != null ? 'border-destructive' : undefined}
      />
      <p className="text-xs text-muted-foreground">{t('fleets.billingProfile.contactsHelp')}</p>
      {hasSubmitted && errors.contacts != null ? (
        <p className="text-sm text-destructive">{errors.contacts}</p>
      ) : (
        contacts.length === 0 && (
          <p className="text-sm text-warning" data-testid="billing-contacts-missing">
            {t('fleets.billingProfile.contactsMissing')}
          </p>
        )
      )}
    </div>
  );

  return (
    <TabPanel
      data-testid="fleet-billing-profile"
      title={t('fleets.billingProfile.title')}
      description={t('fleets.billingProfile.description')}
      actions={
        canWrite && !editing ? (
          <EditButton label={t('common.edit')} onClick={startEdit} />
        ) : undefined
      }
      bodyClassName="space-y-6 text-sm"
    >
      <section className="space-y-4" data-testid="billing-group-recipient">
        {groupTitle('groupRecipient')}
        <FleetInvoiceRecipientField fleet={fleet} />
        {editing ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {recipient === 'fleet' ? (
              <>
                {textField('legalName', t('fleets.billingProfile.legalName'), 255)}
                {textField('taxId', t('fleets.billingProfile.taxId'), 50)}
                {textField('street', t('fleets.billingProfile.street'), 255)}
                {textField('city', t('fleets.billingProfile.city'), 100)}
                {textField('state', t('fleets.billingProfile.state'), 100)}
                {textField('zip', t('fleets.billingProfile.zip'), 20)}
                {textField('country', t('fleets.billingProfile.country'), 100)}
                <div className="space-y-2">
                  <Label htmlFor="billing-language">
                    {t('fleets.billingProfile.invoiceLanguage')}
                  </Label>
                  <LanguageSelect
                    id="billing-language"
                    value={form.language}
                    onChange={(v) => {
                      set('language', v);
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground md:col-span-2">
                  {t('fleets.billingProfile.memberBillTo')}
                </p>
                <fieldset className="space-y-2 md:col-span-2" data-testid="billing-member-delivery">
                  <legend className="text-sm font-medium">
                    {t('fleets.billingProfile.memberDelivery')}
                  </legend>
                  {(['toDriver', 'toContacts'] as const).map((flag) => {
                    const flags = memberDeliveryFlags(form.memberInvoiceDelivery);
                    return (
                      <label
                        key={flag}
                        className="flex items-center gap-2 text-sm"
                        htmlFor={`billing-member-delivery-${flag}`}
                      >
                        <Checkbox
                          id={`billing-member-delivery-${flag}`}
                          checked={flags[flag]}
                          onChange={(e) => {
                            const next = { ...flags, [flag]: e.target.checked };
                            set(
                              'memberInvoiceDelivery',
                              memberDeliveryOfFlags(next.toDriver, next.toContacts),
                            );
                          }}
                        />
                        {t(
                          flag === 'toDriver'
                            ? 'fleets.billingProfile.memberDeliveryToDriver'
                            : 'fleets.billingProfile.memberDeliveryToContacts',
                        )}
                      </label>
                    );
                  })}
                  <p
                    className={
                      form.memberInvoiceDelivery === 'none'
                        ? 'text-xs text-warning'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {t(MEMBER_DELIVERY_HELP[form.memberInvoiceDelivery])}
                  </p>
                </fieldset>
              </>
            )}
            {contactsUsed && contactsField}
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {recipient === 'fleet' ? (
              <>
                <div>
                  <dt className="text-muted-foreground">{t('fleets.billingProfile.billTo')}</dt>
                  <dd className="font-medium">
                    <div>{fleet.billingLegalName ?? fleet.name}</div>
                    {address.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('fleets.billingProfile.taxId')}</dt>
                  <dd className="font-medium">{fleet.billingTaxId ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('fleets.billingProfile.invoiceLanguage')}
                  </dt>
                  <dd className="font-medium">{languageLabel}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="text-muted-foreground">{t('fleets.billingProfile.billTo')}</dt>
                  <dd className="font-medium">{t('fleets.billingProfile.memberBillTo')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('fleets.billingProfile.memberDelivery')}
                  </dt>
                  <dd className="font-medium" data-testid="fleet-billing-member-delivery">
                    {t(MEMBER_DELIVERY_LABEL[savedDelivery])}
                  </dd>
                </div>
              </>
            )}
            {savedContactsUsed && (
              <div className="md:col-span-2">
                <dt className="text-muted-foreground">{t('fleets.billingProfile.contacts')}</dt>
                <dd className="font-medium break-all">
                  {savedContacts.length > 0 ? (
                    savedContacts.join(', ')
                  ) : (
                    <span className="text-warning">
                      {t('fleets.billingProfile.contactsMissing')}
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section className="space-y-4" data-testid="billing-group-issue">
        {groupTitle('groupIssue')}
        {editing ? (
          <form onSubmit={handleSave} noValidate className="space-y-4" id="billing-profile-form">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="billing-issuer">{t('fleets.billingProfile.issuer')}</Label>
                <Select
                  id="billing-issuer"
                  value={form.invoiceIssuerId}
                  onChange={(e) => {
                    set('invoiceIssuerId', e.target.value);
                  }}
                >
                  <option value="">{t('fleets.billingProfile.issuerCompany')}</option>
                  {issuers.map((issuer) => (
                    <option key={issuer.id} value={issuer.id}>
                      {issuer.name}
                    </option>
                  ))}
                  {form.invoiceIssuerId !== '' &&
                    !issuers.some((issuer) => issuer.id === form.invoiceIssuerId) && (
                      <option value={form.invoiceIssuerId}>{form.invoiceIssuerId}</option>
                    )}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('fleets.billingProfile.issuerHelp')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-invoice-date">
                  {t('fleets.billingProfile.invoiceDate')}
                </Label>
                <Select
                  id="billing-invoice-date"
                  value={form.invoiceDateMode}
                  onChange={(e) => {
                    set(
                      'invoiceDateMode',
                      e.target.value === 'period_end' ? 'period_end' : 'run_date',
                    );
                  }}
                >
                  <option value="run_date">{t('fleets.billingProfile.invoiceDateRunDate')}</option>
                  <option value="period_end">
                    {t('fleets.billingProfile.invoiceDatePeriodEnd')}
                  </option>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('fleets.billingProfile.invoiceDateHelp')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-settlement">{t('fleets.billingProfile.settlement')}</Label>
                <Select
                  id="billing-settlement"
                  value={form.accountSettlement}
                  onChange={(e) => {
                    set(
                      'accountSettlement',
                      e.target.value === 'external' ? 'external' : 'payment',
                    );
                  }}
                >
                  <option value="payment">{t('fleets.billingProfile.settlementPayment')}</option>
                  <option value="external">{t('fleets.billingProfile.settlementExternal')}</option>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('fleets.billingProfile.settlementHelp')}
                </p>
              </div>
              {form.accountSettlement === 'payment' && (
                <div className="space-y-2">
                  <Label htmlFor="billing-terms">{t('fleets.billingProfile.paymentTerms')}</Label>
                  <Input
                    id="billing-terms"
                    inputMode="numeric"
                    value={form.paymentTerms}
                    placeholder={t('fleets.billingProfile.paymentTermsDefault')}
                    className={
                      hasSubmitted && errors.paymentTerms != null ? 'border-destructive' : ''
                    }
                    onChange={(e) => {
                      set('paymentTerms', e.target.value);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('fleets.billingProfile.paymentTermsHelp')}
                  </p>
                  {hasSubmitted && errors.paymentTerms != null && (
                    <p className="text-sm text-destructive">{errors.paymentTerms}</p>
                  )}
                </div>
              )}
              {form.accountSettlement === 'external' && (
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="billing-settlement-note">
                    {t('fleets.billingProfile.settlementNote')}
                  </Label>
                  <Textarea
                    id="billing-settlement-note"
                    value={form.settlementNote}
                    maxLength={500}
                    placeholder={t('fleets.billingProfile.settlementNotePlaceholder')}
                    onChange={(e) => {
                      set('settlementNote', e.target.value);
                    }}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Toggle
                  id="billing-auto-invoice"
                  checked={form.autoInvoice}
                  aria-label={t('fleets.billingProfile.autoInvoice')}
                  onCheckedChange={(checked) => {
                    set('autoInvoice', checked);
                  }}
                />
                <Label htmlFor="billing-auto-invoice">
                  {t('fleets.billingProfile.autoInvoice')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('fleets.billingProfile.autoInvoiceHelp')}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <CancelButton
                onClick={() => {
                  setEditing(false);
                }}
              />
              <SaveButton isPending={mutation.isPending} />
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('fleets.billingProfile.issuer')}</dt>
              <dd className="font-medium" data-testid="fleet-billing-issuer">
                {issuerName(fleet.invoiceIssuerId)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('fleets.billingProfile.invoiceDate')}</dt>
              <dd className="font-medium">
                {fleet.invoiceDateMode === 'period_end'
                  ? t('fleets.billingProfile.invoiceDatePeriodEnd')
                  : t('fleets.billingProfile.invoiceDateRunDate')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('fleets.billingProfile.settlement')}</dt>
              <dd className="font-medium" data-testid="fleet-billing-settlement">
                {external
                  ? t('fleets.billingProfile.settlementExternal')
                  : t('fleets.billingProfile.settlementPayment')}
                {external && (
                  <div className="font-normal text-muted-foreground">
                    {fleet.settlementNote ?? t('fleets.billingProfile.settlementNoteDefault')}
                  </div>
                )}
              </dd>
            </div>
            {!external && (
              <div>
                <dt className="text-muted-foreground">{t('fleets.billingProfile.paymentTerms')}</dt>
                <dd className="font-medium">
                  {fleet.paymentTermsDays == null
                    ? t('fleets.billingProfile.paymentTermsDefault')
                    : String(fleet.paymentTermsDays)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">{t('fleets.billingProfile.autoInvoice')}</dt>
              <dd>
                <Badge variant={fleet.autoInvoice === true ? 'success' : 'outline'}>
                  {fleet.autoInvoice === true ? t('fleets.billing.on') : t('fleets.billing.off')}
                </Badge>
              </dd>
            </div>
          </dl>
        )}
      </section>
    </TabPanel>
  );
}

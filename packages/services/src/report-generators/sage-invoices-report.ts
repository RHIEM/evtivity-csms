// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  db,
  drivers,
  getSystemTimezone,
  invoiceLineItems,
  invoices,
  settings,
} from '@evtivity/database';
import { SAGE_EXPORT_SETTING_KEYS, sageExportConfig, taxBreakdownWithGross } from '@evtivity/lib';
import type { SageExportConfig } from '@evtivity/lib';
import type { UiLanguage } from '@evtivity/lib/languages';
import type { ReportGeneratorResult } from '../report-registry.js';
import type { ReportSiteScope } from '../report-scope.js';
import { buildRabCsv, type RabRow } from './rab-csv.js';

/**
 * RHIEM: the Sage export. One line per invoice and tax rate of the member
 * invoices (and their credit notes) issued in the period, in the layout of the
 * RAB import of Sage/OfficeLine (rab-csv.ts). The debtor number of the driver is
 * the debit account. The export stops with the list of what is missing rather
 * than writing a file that leaves invoices out: an incomplete file that Sage
 * reads is worse than a second run.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LISTED = 15;

interface Filters {
  dateFrom: string;
  dateTo: string;
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function parseFilters(raw: Record<string, unknown>): Filters | null {
  const dateFrom = isoDate(raw['dateFrom']);
  const dateTo = isoDate(raw['dateTo']);
  if (dateFrom == null || dateTo == null || dateFrom > dateTo) return null;
  return { dateFrom, dateTo };
}

/** Why the filters cannot produce the export, or null when they can. */
export function sageInvoicesFiltersError(filters: Record<string, unknown>): string | null {
  return parseFilters(filters) == null
    ? 'The Sage export needs a date range (dateFrom and dateTo, YYYY-MM-DD, dateFrom not after dateTo)'
    : null;
}

const MESSAGES = {
  de: {
    notConfigured: (keys: string[]) =>
      `Der Sage-Export ist nicht eingerichtet. Es fehlen Einstellungen: ${keys.join(', ')} (Einstellungen > Unternehmen > Sage-Export).`,
    allSites:
      'Den Sage-Export dürfen nur Benutzer mit Zugriff auf alle Standorte erzeugen, weil Rechnungen keinem Standort zugeordnet sind.',
    noDebtor: (numbers: string) => `Ohne Debitorennummer des Fahrers: ${numbers}.`,
    noTaxCode: (rates: string) =>
      `Ohne Steuercode in den Einstellungen (Sage-Export, Steuercodes): Steuersatz ${rates} %.`,
    noEmployee: (numbers: string) =>
      `Ohne Personalnummer des Fahrers (der Buchungstext verlangt sie): ${numbers}.`,
    noLines: (numbers: string) => `Ohne Rechnungszeilen: ${numbers}.`,
    stopped:
      'Der Sage-Export wurde nicht erzeugt, damit keine unvollständige Datei in Sage gelangt. Bitte beheben und erneut erzeugen.',
  },
  en: {
    notConfigured: (keys: string[]) =>
      `The Sage export is not set up. Missing settings: ${keys.join(', ')} (Settings > Company > Sage export).`,
    allSites:
      'Only users with access to all sites may create the Sage export, because invoices belong to no site.',
    noDebtor: (numbers: string) => `Without the driver's debtor number: ${numbers}.`,
    noTaxCode: (rates: string) =>
      `Without a tax code in the settings (Sage export, tax codes): tax rate ${rates} %.`,
    noEmployee: (numbers: string) =>
      `Without the driver's employee number (the posting text needs it): ${numbers}.`,
    noLines: (numbers: string) => `Without invoice lines: ${numbers}.`,
    stopped:
      'The Sage export was not created, so that no incomplete file reaches Sage. Fix this and create it again.',
  },
} as const;

function messagesFor(language: UiLanguage): (typeof MESSAGES)['de' | 'en'] {
  return language === 'de' ? MESSAGES.de : MESSAGES.en;
}

function listed(values: readonly string[]): string {
  const shown = values.slice(0, MAX_LISTED).join(', ');
  return values.length > MAX_LISTED ? `${shown} … (+${String(values.length - MAX_LISTED)})` : shown;
}

/** The tax rate as a percentage for the tax code lookup: 0.19 is 19, 0.095 is 9.5. */
function ratePercent(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

async function loadConfig(): Promise<{
  config: SageExportConfig;
  missing: string[];
}> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...SAGE_EXPORT_SETTING_KEYS]));
  const stored: Record<string, unknown> = {};
  for (const row of rows) stored[row.key] = row.value;
  return sageExportConfig(stored);
}

/** Fills the placeholders of the posting text; month and year are those of the billed month. */
function postingText(
  template: string,
  invoiceNumber: string,
  monthSource: string,
  employeeNumber: string,
): string {
  return template
    .replaceAll('{month}', monthSource.slice(5, 7))
    .replaceAll('{year}', monthSource.slice(0, 4))
    .replaceAll('{invoiceNumber}', invoiceNumber)
    .replaceAll('{employeeNumber}', employeeNumber);
}

/** yyyyMMddHHmmss of `now` in the system timezone. */
function fileTimestamp(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(now)
    .replace(/\D/g, '');
}

export async function generateSageInvoicesReport(
  rawFilters: Record<string, unknown>,
  _format: string,
  language: UiLanguage,
  siteIds: ReportSiteScope,
): Promise<ReportGeneratorResult> {
  const messages = messagesFor(language);
  const filters = parseFilters(rawFilters);
  if (filters == null) throw new Error(sageInvoicesFiltersError(rawFilters) ?? 'Invalid filters');
  if (siteIds != null) throw new Error(messages.allSites);

  const { config, missing } = await loadConfig();
  if (missing.length > 0) throw new Error(messages.notConfigured(missing));

  const tz = await getSystemTimezone();
  const issuedDate = sql`(${invoices.issuedAt} AT TIME ZONE ${tz})::date`;
  const invoiceRows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      issuedDate: sql<string>`${issuedDate}::text`,
      periodStart: invoices.periodStart,
      periodEnd: invoices.periodEnd,
      currency: invoices.currency,
      debtorNumber: drivers.debtorNumber,
      employeeNumber: drivers.employeeNumber,
    })
    .from(invoices)
    .leftJoin(drivers, eq(drivers.id, invoices.driverId))
    .where(
      and(
        inArray(invoices.kind, ['invoice', 'credit_note']),
        inArray(invoices.status, ['issued', 'paid', 'credited']),
        // Member invoices: billed to a driver through a fleet.
        isNotNull(invoices.fleetId),
        isNotNull(invoices.driverId),
        isNotNull(invoices.issuedAt),
        sql`${issuedDate} >= ${filters.dateFrom}::date`,
        sql`${issuedDate} <= ${filters.dateTo}::date`,
      ),
    )
    .orderBy(asc(invoices.issuedAt), asc(invoices.invoiceNumber));

  const lineRows =
    invoiceRows.length === 0
      ? []
      : await db
          .select({
            invoiceId: invoiceLineItems.invoiceId,
            taxRate: invoiceLineItems.taxRate,
            netCents: invoiceLineItems.totalCents,
            taxCents: invoiceLineItems.taxCents,
          })
          .from(invoiceLineItems)
          .where(
            inArray(
              invoiceLineItems.invoiceId,
              invoiceRows.map((row) => row.id),
            ),
          );
  const linesByInvoice = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const list = linesByInvoice.get(line.invoiceId) ?? [];
    list.push(line);
    linesByInvoice.set(line.invoiceId, list);
  }

  const withoutDebtor: string[] = [];
  const withoutEmployee: string[] = [];
  const withoutLines: string[] = [];
  const withoutTaxCode = new Set<number>();
  const rows: RabRow[] = [];
  const serviceMonths: string[] = [];
  const needsEmployeeNumber = config.postingText.includes('{employeeNumber}');
  for (const invoice of invoiceRows) {
    const debtorNumber = invoice.debtorNumber?.trim() ?? '';
    if (debtorNumber === '') withoutDebtor.push(invoice.invoiceNumber);
    const employeeNumber = invoice.employeeNumber?.trim() ?? '';
    if (needsEmployeeNumber && employeeNumber === '') withoutEmployee.push(invoice.invoiceNumber);
    const lines = linesByInvoice.get(invoice.id) ?? [];
    if (lines.length === 0) {
      withoutLines.push(invoice.invoiceNumber);
      continue;
    }
    const breakdown = taxBreakdownWithGross(
      lines.map((line) => ({
        taxRate: Number(line.taxRate),
        netCents: line.netCents,
        taxCents: line.taxCents,
      })),
    );
    for (const rate of breakdown) {
      const taxCode = config.taxCodes.get(ratePercent(rate.taxRate));
      if (taxCode == null) {
        withoutTaxCode.add(ratePercent(rate.taxRate));
        continue;
      }
      const monthSource = invoice.periodStart ?? invoice.issuedDate;
      serviceMonths.push(monthSource);
      rows.push({
        postingDate:
          config.bookingDate === 'periodEnd' && invoice.periodEnd != null
            ? invoice.periodEnd
            : invoice.issuedDate,
        documentDate: invoice.issuedDate,
        documentNumber: invoice.invoiceNumber,
        opNumber: config.opNumber === 'invoiceNumber' ? invoice.invoiceNumber : '',
        postingText: postingText(
          config.postingText,
          invoice.invoiceNumber,
          monthSource,
          employeeNumber,
        ),
        debitAccount: `${config.debtorPrefix}${debtorNumber}`,
        creditAccount: `${config.revenueAccountPrefix}${config.revenueAccount}`,
        grossCents: rate.grossCents,
        currency: invoice.currency,
        taxKind: config.taxKind,
        taxCode,
        taxCents: rate.taxCents,
        paymentTerms: config.paymentTerms,
      });
    }
  }

  const problems: string[] = [];
  if (withoutDebtor.length > 0) problems.push(messages.noDebtor(listed(withoutDebtor)));
  if (withoutTaxCode.size > 0) {
    problems.push(messages.noTaxCode([...withoutTaxCode].map(String).join(', ')));
  }
  if (withoutEmployee.length > 0) problems.push(messages.noEmployee(listed(withoutEmployee)));
  if (withoutLines.length > 0) problems.push(messages.noLines(listed(withoutLines)));
  if (problems.length > 0) throw new Error(`${problems.join(' ')} ${messages.stopped}`);

  // The billed month of the file: the earliest of its lines (the period filter when it has none).
  const fileMonth = serviceMonths.sort()[0] ?? filters.dateFrom;
  const fileName = config.fileName
    .replaceAll('{mandant}', config.mandant)
    .replaceAll('{timestamp}', fileTimestamp(new Date(), tz))
    .replaceAll('{month}', fileMonth.slice(5, 7))
    .replaceAll('{year}', fileMonth.slice(0, 4));
  return { data: Buffer.from(buildRabCsv(rows), 'utf8'), fileName };
}

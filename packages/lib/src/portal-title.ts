// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * RHIEM: the product name the driver portal and every email show
 * (Settings > Company > Portal title), apart from the company name that
 * stands on invoices, in the portal footer and in the address block of emails.
 * Unset, it falls back to the company name.
 */
import { settingText } from './setting-text.js';

export const COMPANY_PORTAL_TITLE_KEY = 'company.portalTitle';
export const PORTAL_TITLE_MAX_LENGTH = 100;

/** The product name: the portal title when set, else the company name, else the default. */
export function resolvePortalTitle(
  portalTitle: unknown,
  companyName: unknown,
  fallback = 'EVtivity',
): string {
  for (const value of [portalTitle, companyName]) {
    const text = settingText(value).trim();
    if (text !== '') return text;
  }
  return fallback;
}

// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from 'vitest';
import { COMPANY_PORTAL_TITLE_KEY, resolvePortalTitle } from '../portal-title.js';

describe('resolvePortalTitle', () => {
  it('takes the portal title when it is set', () => {
    expect(resolvePortalTitle(' RHIEM EV ', 'RHIEM Packaging & Print GmbH')).toBe('RHIEM EV');
  });

  it('falls back to the company name for an unset or blank title', () => {
    expect(resolvePortalTitle(undefined, 'Acme')).toBe('Acme');
    expect(resolvePortalTitle('', 'Acme')).toBe('Acme');
    expect(resolvePortalTitle('   ', 'Acme')).toBe('Acme');
    expect(resolvePortalTitle(42, 'Acme')).toBe('Acme');
  });

  it('falls back to the default when both are unset', () => {
    expect(resolvePortalTitle(undefined, undefined)).toBe('EVtivity');
    expect(resolvePortalTitle('', '', 'EVtivity CSMS')).toBe('EVtivity CSMS');
  });

  it('keeps the setting key', () => {
    expect(COMPANY_PORTAL_TITLE_KEY).toBe('company.portalTitle');
  });
});

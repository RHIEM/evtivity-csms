// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from 'vitest';
import { legalLinks } from '../legal-links';

describe('legalLinks', () => {
  it('links the German pages for German', () => {
    expect(legalLinks('de')).toEqual({
      privacy: 'https://www.rhiem.com/de/datenschutz/',
      imprint: 'https://www.rhiem.com/de/impressum/',
    });
    expect(legalLinks('de-DE').privacy).toBe('https://www.rhiem.com/de/datenschutz/');
  });

  it('links the English pages for every other language', () => {
    for (const language of ['en', 'es', 'ko', 'zh', 'zh-TW', '', null, undefined]) {
      expect(legalLinks(language)).toEqual({
        privacy: 'https://www.rhiem.com/en/data-protection/',
        imprint: 'https://www.rhiem.com/en/imprint/',
      });
    }
  });
});

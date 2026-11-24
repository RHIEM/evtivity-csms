// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from 'vitest';
import { settingText } from '../setting-text.js';

describe('settingText', () => {
  it('keeps a stored text as it is', () => {
    expect(settingText('1')).toBe('1');
    expect(settingText(' RHIEM ')).toBe(' RHIEM ');
    expect(settingText('')).toBe('');
  });

  // A text that is valid JSON comes back from the settings table as another
  // type (drizzle parses the jsonb string a second time).
  it('takes a number or boolean as its text', () => {
    expect(settingText(1)).toBe('1');
    expect(settingText(46562)).toBe('46562');
    expect(settingText(84030)).toBe('84030');
    expect(settingText(true)).toBe('true');
  });

  it('counts anything else as empty', () => {
    expect(settingText(null)).toBe('');
    expect(settingText(undefined)).toBe('');
    expect(settingText(Number.NaN)).toBe('');
    expect(settingText({ a: 1 })).toBe('');
    expect(settingText(['1'])).toBe('');
  });
});

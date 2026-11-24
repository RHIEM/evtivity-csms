// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * RHIEM: the text of a stored text setting. The settings table keeps JSON
 * (`jsonb`), and a read through drizzle parses a stored string a second time
 * (postgres.js parses the column, then drizzle's jsonb mapping parses a string
 * result again). A text that is valid JSON on its own therefore comes back as
 * another type: "46562" as the number 46562, "1" as 1, "true" as true. A text
 * field must show and use these values as the text that was saved, so a number
 * or boolean counts as its text; null and anything else count as empty.
 * Browser-safe, so the CSMS imports it via `@evtivity/lib/setting-text`.
 */
export function settingText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

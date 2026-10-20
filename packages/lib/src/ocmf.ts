// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { tryParseJson } from './safe-json.js';

/**
 * Signed meter data in the Open Charge Metering Format (OCMF) as German
 * calibration-law meters sign it, and its export for the S.A.F.E.
 * transparency software. Pure, browser-safe.
 *
 * An OCMF record is `OCMF|<payload JSON>|<signature JSON>`. OCPP 1.6 stations
 * (KEBA KC-P30) send it as plain text; OCPP 2.x sends signedMeterData Base64
 * encoded.
 */

/** One meter reading of an OCMF record (payload `RD`). */
export interface OcmfReading {
  /** `TM` as signed, e.g. `2026-09-20T12:56:51,000+0200 I`. */
  time: string;
  /** `TM` as a date; null when it cannot be read. */
  at: Date | null;
  /** UTC offset of `TM` as `+02:00`; null when it has none. */
  utcOffset: string | null;
  /** `TX`: B (begin), C, X, E (end), L, R, A, T, S. Null when missing. */
  type: string | null;
  /** `RV` as signed, digits kept (`2866.7280`). */
  value: string;
  /** `RU`, e.g. kWh or Wh. */
  unit: string | null;
  /** `RI`: the OBIS code, e.g. `1-b:1.8.0`. */
  obis: string | null;
}

export interface OcmfRecord {
  /** `GS`: serial of the gateway (the station for the KEBA KC-P30). */
  gatewaySerial: string | null;
  /** `MS`: serial of the meter. */
  meterSerial: string | null;
  /** `PG`: pagination, the record number the meter counts up (`T116`). */
  pagination: string | null;
  readings: OcmfReading[];
}

/** The OCMF text of a signed record: plain, or decoded from Base64 (OCPP 2.x). */
export function ocmfText(signedData: string): string | null {
  const trimmed = signedData.trim();
  if (trimmed.startsWith('OCMF|')) return trimmed;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0)),
    );
    return decoded.startsWith('OCMF|') ? decoded : null;
  } catch {
    // fail-open: data that only looks like Base64 is not an OCMF record
    return null;
  }
}

/** The payload JSON between the first and the last `|` of an OCMF record. */
function payloadJson(text: string): string | null {
  const start = text.indexOf('|');
  const end = text.lastIndexOf('|');
  if (start < 0 || end <= start) return null;
  return text.slice(start + 1, end);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * `TM` as a date and its offset. OCMF writes `YYYY-MM-DDThh:mm:ss,fff+zzzz`
 * followed by a space and the time status (I, U, S, R).
 */
function parseOcmfTime(time: string): { at: Date | null; utcOffset: string | null } {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:[,.](\d{1,3}))?([+-])(\d{2}):?(\d{2})/.exec(
    time,
  );
  if (m == null) return { at: null, utcOffset: null };
  const utcOffset = `${m[3] ?? '+'}${m[4] ?? '00'}:${m[5] ?? '00'}`;
  const at = new Date(`${m[1] ?? ''}.${(m[2] ?? '0').padEnd(3, '0')}${utcOffset}`);
  return { at: Number.isNaN(at.getTime()) ? null : at, utcOffset };
}

/**
 * `RV` values exactly as signed. JSON.parse drops trailing zeros
 * (2866.7280 becomes 2866.728); the meter display and the transparency
 * software show all digits.
 */
function readingValueTexts(json: string): string[] {
  return [...json.matchAll(/"RV"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)].map(
    (m) => {
      const raw = m[1] ?? '';
      return raw.startsWith('"') ? raw.slice(1, -1).trim() : raw;
    },
  );
}

/** The fields of an OCMF record a reader checks a bill against; null when it is not OCMF. */
export function parseOcmf(signedData: string): OcmfRecord | null {
  const text = ocmfText(signedData);
  if (text == null) return null;
  const json = payloadJson(text);
  if (json == null) return null;
  const payload = tryParseJson(json);
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const rd = Array.isArray(record['RD']) ? (record['RD'] as unknown[]) : [];
  const valueTexts = readingValueTexts(json);
  const readings: OcmfReading[] = [];
  rd.forEach((entry, i) => {
    if (entry == null || typeof entry !== 'object') return;
    const r = entry as Record<string, unknown>;
    const rv = r['RV'];
    if (typeof rv !== 'number' && typeof rv !== 'string') return;
    const time = stringField(r, 'TM') ?? '';
    readings.push({
      time,
      ...parseOcmfTime(time),
      type: stringField(r, 'TX'),
      value: valueTexts.length === rd.length ? (valueTexts[i] ?? String(rv)) : String(rv).trim(),
      unit: stringField(r, 'RU'),
      obis: stringField(r, 'RI'),
    });
  });
  return {
    gatewaySerial: stringField(record, 'GS'),
    meterSerial: stringField(record, 'MS'),
    pagination: stringField(record, 'PG'),
    readings,
  };
}

/** Begin and end reading of a session from its signed records. */
export interface OcmfSessionReadings {
  begin: OcmfReading | null;
  end: OcmfReading | null;
  /** Record numbers (`PG`) in the order of the records. */
  paginations: string[];
  meterSerial: string | null;
}

/**
 * The first begin reading (`TX` B) and the last end reading (`TX` E) of a
 * session's records. The KEBA KC-P30 signs both in one record; OCPP 2.x
 * stations may sign them separately. Readings of other OBIS codes than the
 * first begin reading's (e.g. a duration in seconds) are left out.
 */
export function ocmfSessionReadings(records: OcmfRecord[]): OcmfSessionReadings {
  let begin: OcmfReading | null = null;
  let end: OcmfReading | null = null;
  const paginations: string[] = [];
  let meterSerial: string | null = null;
  for (const record of records) {
    if (record.pagination != null && !paginations.includes(record.pagination)) {
      paginations.push(record.pagination);
    }
    meterSerial ??= record.meterSerial;
    for (const reading of record.readings) {
      if (reading.type === 'B' && begin == null) begin = reading;
    }
  }
  for (const record of records) {
    for (const reading of record.readings) {
      if (reading.type !== 'E') continue;
      if (begin?.obis != null && reading.obis != null && reading.obis !== begin.obis) continue;
      end = reading;
    }
  }
  return { begin, end, paginations, meterSerial };
}

/** A signed record for the transparency software. */
export interface SignedMeterDataExport {
  signedData: string;
  /** OCMF for OCMF records; other formats are passed on as named. */
  encodingMethod: string | null;
  /** Transaction.Begin, Transaction.End, ... */
  context: string | null;
  transactionId: string | null;
  /** The meter key as hex or Base64 (the KEBA KC-P30 sends hex DER). */
  publicKey: string | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** hex or base64, the encodings the transparency software reads besides plain and base32. */
function keyEncoding(key: string): 'hex' | 'base64' {
  return /^(?:[0-9a-fA-F]{2})+$/.test(key) ? 'hex' : 'base64';
}

/**
 * The records as the XML file the S.A.F.E. transparency software opens
 * (`values.xsd` of github.com/SAFE-eV/transparenzsoftware): one `value` per
 * record with the meter key first, then the signed data. `transactionId` is
 * an integer in the schema and left out otherwise.
 */
export function signedMeterDataXml(records: SignedMeterDataExport[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<values>'];
  for (const record of records) {
    const attributes: string[] = [];
    if (record.transactionId != null && /^\d+$/.test(record.transactionId)) {
      attributes.push(`transactionId="${record.transactionId}"`);
    }
    if (record.context != null && record.context !== '') {
      attributes.push(`context="${escapeXml(record.context)}"`);
    }
    lines.push(`  <value${attributes.map((a) => ` ${a}`).join('')}>`);
    const key = record.publicKey?.replace(/\s+/g, '') ?? '';
    if (key !== '') {
      lines.push(`    <publicKey encoding="${keyEncoding(key)}">${escapeXml(key)}</publicKey>`);
    }
    const signedData = record.signedData.trim();
    const format = record.encodingMethod ?? (ocmfText(signedData) != null ? 'OCMF' : null);
    const encoding =
      !signedData.startsWith('OCMF|') && /^[A-Za-z0-9+/]+={0,2}$/.test(signedData)
        ? 'base64'
        : 'plain';
    const formatAttribute = format != null ? ` format="${escapeXml(format)}"` : '';
    lines.push(
      `    <signedData${formatAttribute} encoding="${encoding}">${escapeXml(signedData)}</signedData>`,
    );
    lines.push('  </value>');
  }
  lines.push('</values>', '');
  return lines.join('\n');
}

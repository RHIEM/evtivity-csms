// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { client } from '@evtivity/database';
import { ocmfSessionReadings, parseOcmf } from '@evtivity/lib';
import type { OcmfReading, OcmfRecord } from '@evtivity/lib';
import type { InvoiceLanguage } from './invoice-labels.js';

/**
 * The check block of an invoice: each session's lines end with a small line
 * naming the session (its id, as the driver portal shows it) and, when the
 * station signed the meter data (German calibration law), the record number,
 * the meter and the signed begin and end readings. The driver checks these
 * against the signed data downloaded from the portal with the transparency
 * software.
 */

export interface InvoiceEvidenceLabels {
  session: string;
  record: string;
  records: string;
  meter: string;
  begin: string;
  end: string;
  /** Printed once below the line items when a session has signed meter data. */
  note: string;
}

export const INVOICE_EVIDENCE_LABELS: Record<InvoiceLanguage, InvoiceEvidenceLabels> = {
  en: {
    session: 'Session {id}',
    record: 'record {pg}',
    records: 'records {pg}',
    meter: 'meter {serial}',
    begin: 'start {time}: {value}',
    end: 'end {time}: {value}',
    note: 'Signed meter data (calibration law): the meter signed the readings named under a session. Download the signed data of a session in the customer portal and verify it with the transparency software.',
  },
  de: {
    session: 'Sitzung {id}',
    record: 'Datensatz {pg}',
    records: 'Datensätze {pg}',
    meter: 'Zähler {serial}',
    begin: 'Beginn {time}: {value}',
    end: 'Ende {time}: {value}',
    note: 'Signierte Messdaten (Eichrecht): Die unter einer Sitzung genannten Zählerstände hat der Zähler signiert. Die signierten Daten einer Sitzung stehen im Kundenportal zum Download bereit und lassen sich mit der Transparenzsoftware prüfen.',
  },
  es: {
    session: 'Sesión {id}',
    record: 'registro {pg}',
    records: 'registros {pg}',
    meter: 'contador {serial}',
    begin: 'inicio {time}: {value}',
    end: 'fin {time}: {value}',
    note: 'Datos de medición firmados (ley de metrología): el contador firmó las lecturas indicadas bajo una sesión. Descargue los datos firmados de una sesión en el portal de clientes y verifíquelos con el software de transparencia.',
  },
  ko: {
    session: '세션 {id}',
    record: '레코드 {pg}',
    records: '레코드 {pg}',
    meter: '계량기 {serial}',
    begin: '시작 {time}: {value}',
    end: '종료 {time}: {value}',
    note: '서명된 계량 데이터(계량법): 세션 아래에 표시된 계량값은 계량기가 서명한 값입니다. 세션의 서명된 데이터는 고객 포털에서 다운로드하여 투명성 소프트웨어로 확인할 수 있습니다.',
  },
  zh: {
    session: '会话 {id}',
    record: '记录 {pg}',
    records: '记录 {pg}',
    meter: '电表 {serial}',
    begin: '开始 {time}：{value}',
    end: '结束 {time}：{value}',
    note: '签名计量数据（计量法）：会话下列出的读数已由电表签名。可在客户门户下载会话的签名数据，并使用透明度软件进行验证。',
  },
  'zh-TW': {
    session: '會話 {id}',
    record: '記錄 {pg}',
    records: '記錄 {pg}',
    meter: '電表 {serial}',
    begin: '開始 {time}：{value}',
    end: '結束 {time}：{value}',
    note: '簽章計量資料（計量法）：會話下列出的讀數已由電表簽章。可在客戶入口網站下載會話的簽章資料，並使用透明度軟體進行驗證。',
  },
};

/** A session's signed meter data as the invoice shows it. */
export interface SessionEvidence {
  records: OcmfRecord[];
  /** Serial of the meter key the records refer to (the KEBA KC-P30 signs no meter serial). */
  keyMeterSerial: string | null;
}

/** The signed meter data of the sessions, by session id. Sessions without any are left out. */
export async function loadSessionEvidence(
  sessionIds: string[],
): Promise<Map<string, SessionEvidence>> {
  const evidence = new Map<string, SessionEvidence>();
  if (sessionIds.length === 0) return evidence;
  const rows = await client`
    SELECT smv.session_id, smv.signed_data, mpk.meter_serial
    FROM signed_meter_values smv
    LEFT JOIN meter_public_keys mpk ON mpk.id = smv.meter_public_key_id
    WHERE smv.session_id = ANY(${sessionIds}::text[])
    ORDER BY smv.timestamp, smv.id
  `;
  for (const row of rows) {
    const {
      session_id: sessionId,
      signed_data: signedData,
      meter_serial: meterSerial,
    } = row as { session_id?: unknown; signed_data?: unknown; meter_serial?: unknown };
    if (typeof sessionId !== 'string' || typeof signedData !== 'string') continue;
    const record = parseOcmf(signedData);
    if (record == null) continue;
    let entry = evidence.get(sessionId);
    if (entry == null) {
      entry = { records: [], keyMeterSerial: null };
      evidence.set(sessionId, entry);
    }
    entry.records.push(record);
    if (typeof meterSerial === 'string' && meterSerial !== '') entry.keyMeterSerial ??= meterSerial;
  }
  return evidence;
}

/** The reading's time in the meter's own offset, as the meter signed it. */
function formatReadingTime(reading: OcmfReading, locale: string): string {
  if (reading.at == null) return reading.time;
  try {
    // The narrow no-break space before AM/PM is not in the PDF fonts.
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      ...(reading.utcOffset != null ? { timeZone: reading.utcOffset } : {}),
    })
      .format(reading.at)
      .replace(/[\u202f\u00a0]/g, ' ');
  } catch {
    // fail-open: a time zone the runtime does not know prints the time as signed
    return reading.time;
  }
}

/** The value with all signed digits and the locale's decimal separator, plus the unit. */
function formatReadingValue(reading: OcmfReading, locale: string): string {
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ??
    '.';
  const value = reading.value.replace('.', separator);
  return reading.unit != null ? `${value} ${reading.unit}` : value;
}

/**
 * The check lines of a session: its id, record numbers and meter, and on a
 * second line the signed begin and end readings when there are any.
 */
export function sessionEvidenceLine(
  labels: InvoiceEvidenceLabels,
  locale: string,
  sessionId: string,
  evidence: SessionEvidence | undefined,
): string {
  const parts = [labels.session.replace('{id}', sessionId)];
  if (evidence == null) return parts[0] ?? '';
  const readings = ocmfSessionReadings(evidence.records);
  if (readings.paginations.length > 0) {
    const label = readings.paginations.length > 1 ? labels.records : labels.record;
    parts.push(label.replace('{pg}', readings.paginations.join(', ')));
  }
  const serial = readings.meterSerial ?? evidence.keyMeterSerial;
  if (serial != null) parts.push(labels.meter.replace('{serial}', serial));
  const readingParts: string[] = [];
  for (const [label, reading] of [
    [labels.begin, readings.begin],
    [labels.end, readings.end],
  ] as const) {
    if (reading == null) continue;
    readingParts.push(
      label
        .replace('{time}', formatReadingTime(reading, locale))
        .replace('{value}', formatReadingValue(reading, locale)),
    );
  }
  const head = parts.join(' · ');
  return readingParts.length > 0 ? `${head}\n${readingParts.join(' · ')}` : head;
}

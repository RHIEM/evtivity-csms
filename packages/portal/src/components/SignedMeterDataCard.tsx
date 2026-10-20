// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { useState } from 'react';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck } from 'lucide-react';
import { toUiLanguage } from '@evtivity/lib/languages';
import { formatDateTime } from '@evtivity/lib/timezone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { getErrorMessage } from '@/lib/error-message';
import { formatNumber } from '@/lib/utils';

interface SignedMeterReading {
  type: string | null;
  time: string;
  at: string | null;
  value: string;
  unit: string | null;
  obis: string | null;
}

interface SignedMeterRecord {
  id: number;
  pagination: string | null;
  meterSerial: string | null;
  hasPublicKey: boolean;
  readings: SignedMeterReading[];
}

/**
 * Downloads the session's signed meter data as the XML file of the
 * transparency software. The session cookie authenticates it; the JSON client
 * cannot return bytes.
 */
async function downloadSignedMeterData(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/portal/sessions/${sessionId}/signed-meter-data/xml`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `signed-meter-data-${sessionId}.xml`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** The value with all signed digits, in the UI language. */
function formatReadingValue(reading: SignedMeterReading): string {
  const digits = reading.value.split('.')[1]?.length ?? 0;
  const value = Number(reading.value);
  const text = Number.isNaN(value) ? reading.value : formatNumber(value, digits);
  return reading.unit != null ? `${text} ${reading.unit}` : text;
}

/**
 * The signed meter data of a completed session (calibration law): record
 * number, meter, signed begin and end readings, the download for the
 * transparency software and the operator's note on how to check it. Hidden
 * when the station signed nothing.
 */
export function SignedMeterDataCard({
  sessionId,
  timezone,
}: {
  sessionId: string;
  timezone: string;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const lang = toUiLanguage(i18n.language);

  const { data } = useQuery({
    queryKey: ['portal-session-signed-meter-data', sessionId],
    queryFn: () =>
      api.get<{ data: SignedMeterRecord[] }>(`/v1/portal/sessions/${sessionId}/signed-meter-data`),
    staleTime: 60_000,
  });
  const records = data?.data ?? [];

  const { data: note } = useQuery({
    queryKey: ['content', 'signed-meter-data', lang],
    queryFn: () => api.get<{ html: string }>(`/v1/portal/content/signed-meter-data?lang=${lang}`),
    enabled: records.length > 0,
    staleTime: 300_000,
  });

  if (records.length === 0) return null;

  const readings = records.flatMap((record) => record.readings);
  const begin = readings.find((r) => r.type === 'B');
  // The last end reading of the begin reading's OBIS code (not e.g. a duration).
  const end = [...readings]
    .reverse()
    .find(
      (r) => r.type === 'E' && (begin?.obis == null || r.obis == null || r.obis === begin.obis),
    );
  const paginations = [
    ...new Set(records.flatMap((r) => (r.pagination != null ? [r.pagination] : []))),
  ];
  const meterSerial = records.find((r) => r.meterSerial != null)?.meterSerial ?? null;
  const missingKey = records.some((r) => !r.hasPublicKey);
  const readingTime = (reading: SignedMeterReading): string =>
    reading.at != null
      ? formatDateTime(reading.at, timezone, { dateStyle: 'medium', timeStyle: 'medium' }, lang)
      : reading.time;

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    try {
      await downloadSignedMeterData(sessionId);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: getErrorMessage(err, t, 'sessionDetail.signedMeterDownloadFailed'),
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card data-testid="signed-meter-data">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          {t('sessionDetail.signedMeterTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {paginations.length > 0 && (
          <Row label={t('sessionDetail.signedMeterRecord')} value={paginations.join(', ')} />
        )}
        {meterSerial != null && (
          <Row label={t('sessionDetail.signedMeterMeter')} value={meterSerial} />
        )}
        {begin != null && (
          <Row
            label={t('sessionDetail.signedMeterBegin', { time: readingTime(begin) })}
            value={formatReadingValue(begin)}
          />
        )}
        {end != null && (
          <Row
            label={t('sessionDetail.signedMeterEnd', { time: readingTime(end) })}
            value={formatReadingValue(end)}
          />
        )}
        <Button
          variant="outline"
          className="w-full"
          disabled={downloading}
          onClick={() => {
            void handleDownload();
          }}
          data-testid="signed-meter-data-download"
        >
          <Download className="mr-2 h-4 w-4" />
          {t('sessionDetail.signedMeterDownload')}
        </Button>
        {missingKey && (
          <p className="text-xs text-muted-foreground">{t('sessionDetail.signedMeterNoKey')}</p>
        )}
        {note != null && note.html !== '' && (
          // Content is sanitized with DOMPurify before rendering
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.html) }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

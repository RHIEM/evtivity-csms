// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from 'vitest';
import { ocmfSessionReadings, ocmfText, parseOcmf, signedMeterDataXml } from '../ocmf.js';

// The record pattern of a KEBA KC-P30 (firmware 2.9.2): begin and end reading
// in one record, values in kWh with four decimals, no meter serial.
const KEBA_RECORD =
  'OCMF|{"FV":"1.1","GI":"KEBA_KCP30","GS":"12345678","GV":"2.9.2","PG":"T116","IS":true,' +
  '"IL":"TRUSTED","IF":["RFID_PLAIN","OCPP_WHITELIST","ISO15118_NONE","PLMN_NONE"],' +
  '"IT":"ISO14443","ID":"04AABBCC","RD":[' +
  '{"TM":"2026-09-20T12:56:51,000+0200 I","TX":"B","EF":"","ST":"G","RV":2866.7280,"RI":"1-b:1.8.0","RU":"kWh"},' +
  '{"TM":"2026-09-21T07:48:48,000+0200 I","TX":"E","EF":"","ST":"G","RV":2908.2472,"RI":"1-b:1.8.0","RU":"kWh"}' +
  ']}|{"SD":"3046022100D3"}';

const KEBA_KEY = '3059301306072a8648ce3d020106082a8648ce3d03010703420004aabb';

describe('parseOcmf', () => {
  it('reads serials, pagination and readings of a KEBA record', () => {
    const record = parseOcmf(KEBA_RECORD);
    expect(record).not.toBeNull();
    expect(record?.gatewaySerial).toBe('12345678');
    expect(record?.meterSerial).toBeNull();
    expect(record?.pagination).toBe('T116');
    expect(record?.readings).toHaveLength(2);
    const [begin, end] = record?.readings ?? [];
    expect(begin?.type).toBe('B');
    expect(begin?.value).toBe('2866.7280');
    expect(begin?.unit).toBe('kWh');
    expect(begin?.obis).toBe('1-b:1.8.0');
    expect(begin?.utcOffset).toBe('+02:00');
    expect(begin?.at?.toISOString()).toBe('2026-09-20T10:56:51.000Z');
    expect(end?.time).toBe('2026-09-21T07:48:48,000+0200 I');
    expect(end?.value).toBe('2908.2472');
  });

  it('reads string values and decodes Base64 (OCPP 2.x)', () => {
    const raw =
      'OCMF|{"MS":"1DZG0033016824","PG":"T199","RD":[{"TM":"2021-10-26T10:21:22,000+0200 I","TX":"E","RV":"       9.038","RI":"01-00:01.08.00.FF","RU":"kWh"}]}|{"SD":"30"}';
    const record = parseOcmf(Buffer.from(raw).toString('base64'));
    expect(record?.meterSerial).toBe('1DZG0033016824');
    expect(record?.readings[0]?.value).toBe('9.038');
  });

  it('returns null for data that is not OCMF', () => {
    expect(parseOcmf('not signed data')).toBeNull();
    expect(parseOcmf('OCMF|{broken|{"SD":"30"}')).toBeNull();
    expect(parseOcmf('OCMF|[1,2]|{}')).toBeNull();
    expect(ocmfText(Buffer.from('hello').toString('base64'))).toBeNull();
  });

  it('keeps a reading without a readable time', () => {
    const record = parseOcmf('OCMF|{"RD":[{"TM":"later","TX":"B","RV":1}]}|{}');
    expect(record?.readings[0]?.at).toBeNull();
    expect(record?.readings[0]?.utcOffset).toBeNull();
    expect(record?.readings[0]?.value).toBe('1');
  });
});

describe('ocmfSessionReadings', () => {
  it('takes the first begin and the last end reading of the same OBIS code', () => {
    const begin = parseOcmf(
      'OCMF|{"PG":"T198","MS":"M1","RD":[{"TM":"2021-10-26T10:20:52,000+0200 I","TX":"B","RV":9.038,"RI":"01-00:01.08.00.FF","RU":"kWh"}]}|{}',
    );
    const end = parseOcmf(
      'OCMF|{"PG":"T199","MS":"M1","RD":[{"TM":"2021-10-26T10:21:22,000+0200 I","TX":"E","RV":9.538,"RI":"01-00:01.08.00.FF","RU":"kWh"},{"TM":"2021-10-26T10:21:22,000+0200 I","TX":"E","RV":30,"RI":"01-00:00.08.06.FF","RU":"sec"}]}|{}',
    );
    const readings = ocmfSessionReadings([begin!, end!]);
    expect(readings.begin?.value).toBe('9.038');
    expect(readings.end?.value).toBe('9.538');
    expect(readings.paginations).toEqual(['T198', 'T199']);
    expect(readings.meterSerial).toBe('M1');
  });

  it('is empty without records', () => {
    expect(ocmfSessionReadings([])).toEqual({
      begin: null,
      end: null,
      paginations: [],
      meterSerial: null,
    });
  });
});

describe('signedMeterDataXml', () => {
  it('writes the S.A.F.E. values format with the key before the data', () => {
    const xml = signedMeterDataXml([
      {
        signedData: KEBA_RECORD,
        encodingMethod: 'OCMF',
        context: 'Transaction.End',
        transactionId: '4',
        publicKey: KEBA_KEY,
      },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<value transactionId="4" context="Transaction.End">');
    expect(xml).toContain(`<publicKey encoding="hex">${KEBA_KEY}</publicKey>`);
    expect(xml).toContain('<signedData format="OCMF" encoding="plain">OCMF|{&quot;FV&quot;');
    expect(xml.indexOf('<publicKey')).toBeLessThan(xml.indexOf('<signedData'));
  });

  it('keeps the signed record unchanged after XML unescaping', () => {
    const xml = signedMeterDataXml([
      {
        signedData: KEBA_RECORD,
        encodingMethod: null,
        context: null,
        transactionId: null,
        publicKey: null,
      },
    ]);
    const inner = /<signedData[^>]*>([\s\S]*?)<\/signedData>/.exec(xml)?.[1] ?? '';
    const unescaped = inner
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(unescaped).toBe(KEBA_RECORD);
    expect(xml).toContain('<value>');
    expect(xml).not.toContain('<publicKey');
    expect(xml).toContain('format="OCMF"');
  });

  it('marks Base64 data and keys and leaves out a non-integer transaction id', () => {
    const data = Buffer.from(KEBA_RECORD).toString('base64');
    const xml = signedMeterDataXml([
      {
        signedData: data,
        encodingMethod: 'OCMF',
        context: 'Transaction.Begin',
        transactionId: 'f3a1-uuid',
        publicKey: 'MFkwEwYHKoZIzj0CAQ==',
      },
    ]);
    expect(xml).toContain('<value context="Transaction.Begin">');
    expect(xml).toContain('<publicKey encoding="base64">MFkwEwYHKoZIzj0CAQ==</publicKey>');
    expect(xml).toContain(`<signedData format="OCMF" encoding="base64">${data}</signedData>`);
  });

  it('writes an empty list', () => {
    expect(signedMeterDataXml([])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<values>\n</values>\n',
    );
  });
});

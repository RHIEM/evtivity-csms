// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { InvoiceLanguage } from './invoice-labels.js';

/**
 * The texts of the session report PDF (session-report.service.ts), the
 * document a driver gets instead of a member invoice under external
 * invoicing. On purpose without invoice words: no invoice number, due date,
 * payment details or tax line, so the report is not read as an invoice.
 */
export interface SessionReportLabels {
  title: string;
  /** Printed under the title, in a box. */
  notice: string;
  driver: string;
  operator: string;
  /** `{fleet}`: the fleet whose account the sessions were charged on. */
  viaFleet: string;
  period: string;
  created: string;
  reference: string;
  begin: string;
  end: string;
  place: string;
  token: string;
  energy: string;
  net: string;
  gross: string;
  sessionCount: string;
  totalEnergy: string;
  totalNet: string;
  totalGross: string;
  /** `{zone}`: the IANA timezone of the times. */
  timesNote: string;
  /** ASCII stem of the PDF file name (`<stem>-YYYY-MM.pdf`). */
  fileStem: string;
}

export const SESSION_REPORT_LABELS: Record<InvoiceLanguage, SessionReportLabels> = {
  en: {
    title: 'Charging session report',
    notice:
      'This report is not an invoice. It lists the charging sessions of the period. They are invoiced separately.',
    driver: 'Driver',
    operator: 'Operator',
    viaFleet: 'Fleet: {fleet}',
    period: 'Period',
    created: 'Created',
    reference: 'Report ID',
    begin: 'Start',
    end: 'End',
    place: 'Location',
    token: 'Card',
    energy: 'kWh',
    net: 'Net',
    gross: 'Gross',
    sessionCount: 'Charging sessions',
    totalEnergy: 'Total energy',
    totalNet: 'Total net',
    totalGross: 'Total gross',
    timesNote: 'Times in {zone}.',
    fileStem: 'session-report',
  },
  de: {
    title: 'Ladesitzungsbericht',
    notice:
      'Dieser Bericht ist keine Rechnung. Er weist die Ladevorgänge des Zeitraums nach. Die Abrechnung erfolgt gesondert.',
    driver: 'Fahrer',
    operator: 'Betreiber',
    viaFleet: 'Flotte: {fleet}',
    period: 'Zeitraum',
    created: 'Erstellt am',
    reference: 'Bericht-ID',
    begin: 'Beginn',
    end: 'Ende',
    place: 'Standort',
    token: 'Karte',
    energy: 'kWh',
    net: 'Netto',
    gross: 'Brutto',
    sessionCount: 'Ladevorgänge',
    totalEnergy: 'Energie gesamt',
    totalNet: 'Summe netto',
    totalGross: 'Summe brutto',
    timesNote: 'Zeiten in {zone}.',
    fileStem: 'Ladesitzungsbericht',
  },
  es: {
    title: 'Informe de sesiones de carga',
    notice:
      'Este informe no es una factura. Recoge las sesiones de carga del periodo. Se facturan por separado.',
    driver: 'Conductor',
    operator: 'Operador',
    viaFleet: 'Flota: {fleet}',
    period: 'Periodo',
    created: 'Creado el',
    reference: 'ID del informe',
    begin: 'Inicio',
    end: 'Fin',
    place: 'Ubicación',
    token: 'Tarjeta',
    energy: 'kWh',
    net: 'Neto',
    gross: 'Bruto',
    sessionCount: 'Sesiones de carga',
    totalEnergy: 'Energía total',
    totalNet: 'Total neto',
    totalGross: 'Total bruto',
    timesNote: 'Horas en {zone}.',
    fileStem: 'informe-sesiones',
  },
  ko: {
    title: '충전 세션 보고서',
    notice:
      '이 보고서는 청구서가 아닙니다. 해당 기간의 충전 세션을 기록합니다. 정산은 별도로 진행됩니다.',
    driver: '운전자',
    operator: '운영자',
    viaFleet: '차량 그룹: {fleet}',
    period: '기간',
    created: '작성일',
    reference: '보고서 ID',
    begin: '시작',
    end: '종료',
    place: '위치',
    token: '카드',
    energy: 'kWh',
    net: '공급가액',
    gross: '합계액',
    sessionCount: '충전 세션',
    totalEnergy: '총 에너지',
    totalNet: '공급가액 합계',
    totalGross: '합계액 합계',
    timesNote: '시간대: {zone}.',
    fileStem: 'session-report',
  },
  zh: {
    title: '充电会话报告',
    notice: '本报告不是发票。它列出本期间的充电会话。费用另行结算。',
    driver: '司机',
    operator: '运营商',
    viaFleet: '车队：{fleet}',
    period: '期间',
    created: '创建日期',
    reference: '报告 ID',
    begin: '开始',
    end: '结束',
    place: '地点',
    token: '卡片',
    energy: 'kWh',
    net: '净额',
    gross: '总额',
    sessionCount: '充电会话',
    totalEnergy: '总电量',
    totalNet: '净额合计',
    totalGross: '总额合计',
    timesNote: '时间为 {zone}。',
    fileStem: 'session-report',
  },
  'zh-TW': {
    title: '充電會話報告',
    notice: '本報告不是發票。它列出本期間的充電會話。費用另行結算。',
    driver: '司機',
    operator: '營運商',
    viaFleet: '車隊：{fleet}',
    period: '期間',
    created: '建立日期',
    reference: '報告 ID',
    begin: '開始',
    end: '結束',
    place: '地點',
    token: '卡片',
    energy: 'kWh',
    net: '淨額',
    gross: '總額',
    sessionCount: '充電會話',
    totalEnergy: '總電量',
    totalNet: '淨額合計',
    totalGross: '總額合計',
    timesNote: '時間為 {zone}。',
    fileStem: 'session-report',
  },
};

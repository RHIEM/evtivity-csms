// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { UiLanguage } from '@evtivity/lib';

// The note the driver portal shows with the download of a session's signed
// meter data (content.signedMeterData.<lang>). Operators edit it under
// Settings > Content, e.g. to link their station manufacturer's instructions.
const SAFE_URL = 'https://safe-ev.org/de/transparenzsoftware.php';

export const DEFAULT_SIGNED_METER_CONTENT: Record<UiLanguage, string> = {
  en: `<p>The meter of the charging station signed the readings of this session (calibration law). With the transparency software you can check that the signed data is unchanged and matches the readings on your invoice.</p>
<ol>
<li>Download the signed data of the session as an XML file.</li>
<li>Get the transparency software of S.A.F.E. e.V. free of charge: <a href="${SAFE_URL}" target="_blank" rel="noopener noreferrer">safe-ev.org</a> (Java required).</li>
<li>Open the XML file in the transparency software and start the verification.</li>
</ol>
<p>Some station manufacturers name their own transparency software in the station's documentation.</p>`,
  de: `<p>Der Zähler der Ladestation hat die Messwerte dieser Sitzung signiert (Eichrecht). Mit der Transparenzsoftware prüfst du, dass die signierten Daten unverändert sind und zu den Zählerständen auf deiner Rechnung passen.</p>
<ol>
<li>Lade die signierten Daten der Sitzung als XML-Datei herunter.</li>
<li>Lade die kostenlose Transparenzsoftware des S.A.F.E. e.V. herunter: <a href="${SAFE_URL}" target="_blank" rel="noopener noreferrer">safe-ev.org</a> (Java erforderlich).</li>
<li>Öffne die XML-Datei in der Transparenzsoftware und starte die Prüfung.</li>
</ol>
<p>Manche Hersteller nennen in der Dokumentation der Ladestation eine eigene Transparenzsoftware.</p>`,
  es: `<p>El contador de la estación de carga firmó las lecturas de esta sesión (ley de metrología). Con el software de transparencia puede comprobar que los datos firmados no se han modificado y coinciden con las lecturas de su factura.</p>
<ol>
<li>Descargue los datos firmados de la sesión como archivo XML.</li>
<li>Obtenga gratis el software de transparencia de S.A.F.E. e.V.: <a href="${SAFE_URL}" target="_blank" rel="noopener noreferrer">safe-ev.org</a> (requiere Java).</li>
<li>Abra el archivo XML en el software de transparencia e inicie la verificación.</li>
</ol>
<p>Algunos fabricantes indican su propio software de transparencia en la documentación de la estación.</p>`,
  ko: `<p>충전소의 계량기가 이 세션의 계량값에 서명했습니다(계량법). 투명성 소프트웨어로 서명된 데이터가 변경되지 않았으며 청구서의 계량값과 일치하는지 확인할 수 있습니다.</p>
<ol>
<li>세션의 서명된 데이터를 XML 파일로 다운로드하세요.</li>
<li>S.A.F.E. e.V.의 무료 투명성 소프트웨어를 받으세요: <a href="${SAFE_URL}" target="_blank" rel="noopener noreferrer">safe-ev.org</a> (Java 필요).</li>
<li>투명성 소프트웨어에서 XML 파일을 열고 검증을 시작하세요.</li>
</ol>
<p>일부 충전기 제조사는 충전소 문서에 자체 투명성 소프트웨어를 안내합니다.</p>`,
  zh: `<p>充电站的电表已对本次会话的读数进行签名（计量法）。使用透明度软件可以验证签名数据未被修改，并与发票上的读数一致。</p>
<ol>
<li>将本次会话的签名数据下载为 XML 文件。</li>
<li>免费获取 S.A.F.E. e.V. 的透明度软件：<a href="${SAFE_URL}" target="_blank" rel="noopener noreferrer">safe-ev.org</a>（需要 Java）。</li>
<li>在透明度软件中打开 XML 文件并开始验证。</li>
</ol>
<p>部分充电桩制造商会在充电站文档中提供自己的透明度软件。</p>`,
  'zh-TW': `<p>充電站的電表已對本次會話的讀數進行簽章（計量法）。使用透明度軟體可以驗證簽章資料未被修改，並與發票上的讀數一致。</p>
<ol>
<li>將本次會話的簽章資料下載為 XML 檔案。</li>
<li>免費取得 S.A.F.E. e.V. 的透明度軟體：<a href="${SAFE_URL}" target="_blank" rel="noopener noreferrer">safe-ev.org</a>（需要 Java）。</li>
<li>在透明度軟體中開啟 XML 檔案並開始驗證。</li>
</ol>
<p>部分充電樁製造商會在充電站文件中提供自己的透明度軟體。</p>`,
};

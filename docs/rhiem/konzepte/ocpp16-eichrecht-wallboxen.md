# Konzept: Eichrechtskonforme OCPP-1.6-Wallboxen (KEBA KC-P30)

- **Status:** Freigegeben (30.09.2026)
- **Stand:** 30.09.2026
- **Anlass:** Erste echte Wallbox im Pilot (KEBA KC-P30, Firmware 2.1.0, OCPP 1.6J, RFID). Befunde aus der ersten Testladung am 30.09.2026 mit `v0.1.27` + RHIEM-Änderungen.

## Ziel

Eine eichrechtskonforme OCPP-1.6-Wallbox lässt sich ohne Umwege anbinden. Jede Sitzung hat die richtige Energie und die richtigen Kosten. Die signierten Messdaten und der passende öffentliche Schlüssel des Zählers bleiben als Messnachweis dauerhaft erhalten. Das ist Voraussetzung für [Laden auf Rechnung](laden-auf-rechnung.md) mit der KC-P30 („Messnachweis (Eichrecht)“).

## Befunde

| #   | Befund                                                                                                                                                                                                                                                                                                                                                                                                                                         | Stelle                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Die KC-P30 schickt Basic Auth erst nach `401` mit `WWW-Authenticate: Basic`. EVtivity nimmt das WebSocket-Upgrade immer an (`101`) und schließt erst danach mit `1008` („Missing credentials“). Die Wallbox kann sich deshalb nicht anmelden.                                                                                                                                                                                                  | `packages/ocpp/src/server/ocpp-server.ts` (`start`, `handleConnection`)                                                    |
| 2   | Bei 1.6 wird die Sitzungsenergie nur aus laufenden `MeterValues` berechnet. `StopTransaction.meterStop` wird gespeichert, aber nicht verrechnet. Testladung: 947 Wh angezeigt, laut `meterStop − meterStart` und OCMF 1.218 Wh; Kosten entsprechend zu niedrig. Zusätzlich hat der letzte periodische Wert vor dem Stopp die Sitzungsenergie nicht mehr aktualisiert (Ursache offen).                                                          | `packages/ocpp/src/server/event-projections.ts` (`Ended`-Zweig, Energie-Update bei `Energy.Active.Import.Register`)        |
| 3   | Die KC-P30 schickt OCMF nur in `StopTransaction.transactionData` als `sampledValue` mit `format: SignedData`, derselbe Datensatz zweimal (`Transaction.Begin` und `Transaction.End`). EVtivity liest `signed_data` nur aus `signedMeterValue` (2.x) und schreibt `value` („`OCMF\|…`“) in die Spalte `meter_values.value` (`numeric NOT NULL`). Der Nachweis geht verloren. `meter_values` wird außerdem nach 90 Tagen bereinigt.              | `handlers/v1_6/stop-transaction.handler.ts`, `event-projections.ts`, `packages/worker/src/handlers/log-retention-prune.ts` |
| 4   | Nach dem Verbinden schickt die KC-P30 den öffentlichen Schlüssel ihres Zählers per `DataTransfer` (`vendorId: generalConfiguration`, `messageId: setMeterConfiguration`, `data: {"meters":[{connectorId, meterSerial, type: "SIGNATURE", publicKey}]}`, Schlüssel als DER-Hex, ECDSA P-256). EVtivity antwortet `UnknownVendorId` und speichert nichts. Mit diesem Schlüssel ließen sich alle gültigen OCMF-Signaturen der Wallbox bestätigen. | `handlers/v1_6/data-transfer.handler.ts`                                                                                   |
| 5   | Der Tarifpreis ist netto; `taxRate` wird aufgeschlagen. Die Oberfläche sagt nur „Preis pro kWh“. Ein als brutto gemeinter Preis wurde so doppelt versteuert.                                                                                                                                                                                                                                                                                   | `packages/lib/src/cost-calculator.ts`, `packages/csms/src/i18n/locales/*.json` (`pricePerKwh`)                             |

Upstream gibt es zu keinem Punkt ein Issue oder einen PR (geprüft 30.09.2026).

## Lösungskonzept

Fünf getrennte Zweige ab `v0.1.27`, jeweils mit `--no-ff` in `rhiem/main` und später als eigener PR an EVtivity ([ADR 0001](../adr/0001-fork-und-branch-strategie.md)). Reihenfolge wie nummeriert.

### 1. Anmeldung vor dem Upgrade prüfen (`fix/ocpp-auth-http-401`)

- `authenticateConnection` läuft in der `verifyClient`-Rückruffunktion von `ws` (asynchrone Variante mit Callback), für den `ws://`- und den `wss://`-Server.
- Abgelehnt wird mit einer HTTP-Antwort statt nach dem Upgrade:
  - `401` mit `WWW-Authenticate: Basic realm="OCPP"` bei fehlenden oder falschen Zugangsdaten, falschem Benutzernamen oder fehlendem Passwort an der Station.
  - `404` bei unbekannter Station-ID (Empfehlung aus OCPP-J 1.6).
  - `403` bei gesperrter Station.
  - SP2/SP3 ohne TLS und fehlendes oder ungültiges Client-Zertifikat: `401` (ohne `WWW-Authenticate` bei SP3).
- Das Prüfergebnis wird an `handleConnection` weitergereicht (z. B. per `WeakMap` am Request), damit die Station nicht zweimal gelesen wird. Der Puffer für Nachrichten während der Prüfung entfällt.
- Pro-IP-Limits, Idle-Timeout und `connection_logs` bleiben unverändert.
- Tests nach dem Muster von `__tests__/ocpp-server-limits.test.ts` (echter Server): fehlender Header → `401` mit `WWW-Authenticate`; falsches Passwort → `401`; unbekannte Station → `404`; gültige Zugangsdaten → Verbindung und `connection_logs`-Eintrag wie bisher.

### 2. Endenergie aus `meterStop` (`fix/ocpp16-session-energy-meter-stop`)

- Im `Ended`-Zweig: Liegen `meter_stop` und `meter_start` vor, wird `energy_delivered_wh = GREATEST(0, meter_stop − meter_start)` gesetzt, bevor die Kosten berechnet werden. Gilt für 1.6 und für 2.x, wenn ein Endwert vorliegt.
- Bei der Umsetzung wird zusätzlich per Test geklärt, warum der letzte periodische Wert die Sitzung nicht mehr aktualisiert hat. Ein Fix dafür nur, wenn er klein bleibt; sonst eigenes Issue.
- Tests: Projektion mit einer 1.6-Sitzung, deren letzte `MeterValues` hinter `meterStop` liegen; Kostenberechnung mit der korrigierten Energie.

### 3. Messnachweise speichern (`feature/ocpp16-signed-meter-data`)

- Neue Tabelle für Messnachweise je Sitzung, angelehnt an OCPI `SignedData` (`packages/ocpi/src/types/ocpi.ts`):
  - Bezug: Sitzung, Station, EVSE (sofern bekannt).
  - `encoding_method` (`OCMF`), Art (`start`/`end`/`intermediate`, aus dem Kontext abgeleitet), Zeitpunkt, Quelle (`StopTransaction`, `MeterValues`, `TransactionEvent`).
  - Rohdaten **unverändert als Text**, dazu ihr SHA-256 für die Deduplizierung (eindeutig je Sitzung).
  - Verweis auf den zum Zeitpunkt gültigen Zählerschlüssel (aus 4), sofern bekannt.
- **Keine automatische Löschung:** Die Tabelle steht nicht in `log-retention-prune.ts`. Beim Löschen einer Sitzung darf der Nachweis nicht still mitgelöscht werden (kein `ON DELETE CASCADE`).
- Projektion: Werte mit `format: SignedData` (1.6) bzw. `signedMeterValue` (2.x) werden als Nachweis gespeichert und nicht als Zahl in `meter_values.value` geschrieben. Identische Datensätze (KC-P30: Begin und End) ergeben einen Eintrag.
- API: Nachweise einer Sitzung lesen (Route bei den Sitzungen, Berechtigung wie Sitzungsdetails).
- Nicht in diesem Schnitt: Anzeige in Betreiberoberfläche und Fahrerportal, Export, kryptografische Prüfung. Ein gespeicherter Nachweis gilt noch nicht als geprüft.
- Tests: Projektion mit dem 1.6-Muster der KC-P30 (Raw und SignedData gemischt, doppelter Datensatz); 2.x-`signedMeterValue`; Bereinigung lässt die Tabelle unberührt.

### 4. Zählerschlüssel übernehmen (`feature/ocpp16-meter-public-key`)

- `DataTransfer` mit `vendorId: generalConfiguration` und `messageId: setMeterConfiguration` wird ausgewertet. Die Nutzdaten werden validiert (`meters[]` mit `connectorId`, `meterSerial`, `type`, `publicKey`).
- Neue Tabelle für Zählerschlüssel: Station, Anschluss, Zählerseriennummer, Typ, Schlüssel (wie empfangen), erstmals und zuletzt gemeldet. Ein neuer Schlüssel für denselben Anschluss wird als neuer Eintrag geführt; der alte bleibt erhalten. Keine automatische Löschung.
- Antwort `Accepted` bei gültigen Nutzdaten, `Rejected` bei ungültigen. Andere `DataTransfer` bleiben bei `UnknownVendorId`.
- Der Messnachweis aus 3 verweist auf den Schlüssel, der für seinen Anschluss zum Zeitpunkt der Sitzung galt.
- API: Schlüssel einer Station lesen.
- Tests: Handler (gültig, ungültig, fremde `vendorId`), Projektion (neu, gleich, Wechsel des Schlüssels).

### 5. Preis als netto kennzeichnen (`fix/tariff-price-net-label`)

- Beschriftung der Preisfelder im Tarif als netto in allen sechs Sprachen.
- Ist ein Steuersatz gesetzt, zeigt das Formular darunter den Bruttopreis (z. B. „entspricht 0,2561 € brutto“), formatiert nach der UI-Sprache ([ADR 0003](../adr/0003-dezimalzahlen-eingabe.md)).
- Datenmodell und Kostenberechnung bleiben unverändert.

### Migrationen

Neue Tabellen aus 3 und 4 kommen als eigene Migrationen im Namenskreis `rhiem_` ([ADR 0002](../adr/0002-eigene-datenbankmigrationen.md)), von Hand geschrieben wie bei Upstream. 1, 2 und 5 brauchen keine Migration.

### Fertig heißt

Je Zweig: `npm run typecheck && npm run lint && npm test` grün, neue Tests wie oben. Danach im Pilot ausrollen und mit der KC-P30 prüfen:

1. Anmeldung ohne vorgeschaltete Traefik-Prüfung.
2. Energie und Kosten einer Testladung gleich `meterStop − meterStart`.
3. OCMF-Datensatz der Testladung einmal gespeichert und unverändert.
4. Zählerschlüssel gespeichert und Signatur des Datensatzes damit prüfbar.
5. Brutto-Vorschau im Tarifformular.

## Bewusst nicht in diesem Schnitt

- Anzeige und Export der Messnachweise, Prüfung der Signaturen, Anbindung an Transparenzsoftware.
- Füllen von `signed_data` im OCPI-CDR.
- Wahlweise Eingabe von Bruttopreisen.
- Kennzeichnung von EVSE 0 (Connector 0 unter 1.6 ist die gesamte Station) und die angezeigte OCPP-URL einer Station.
- OCPP 2.0.1 und Plug and Charge.

## Offene Punkte

- Gesetzliche Aufbewahrungsfrist der Messnachweise klären; bis dahin werden sie nicht gelöscht.
- Abstimmung mit EVtivity, ob Schlüssel und Messnachweise als eigene Tabellen oder anders gewünscht sind, vor den PRs zu 3 und 4.

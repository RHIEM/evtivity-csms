# Konzept: Eichrechtskonforme OCPP-1.6-Wallboxen (KEBA KC-P30)

- **Status:** Freigegeben (30.09.2026)
- **Stand:** 30.09.2026, geändert 30.09.2026 (3 und 4 zusammengelegt, Signatur-Feature vorerst nicht an EVtivity)
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

Sieben getrennte Zweige ab `v0.1.27` (einschließlich der nachträglichen Punkte 6 bis 8), jeweils mit `--no-ff` in `rhiem/main` ([ADR 0001](../adr/0001-fork-und-branch-strategie.md)). Reihenfolge wie nummeriert. 1, 2, 5, 6, 7 und 8 sind als PR an EVtivity vorgesehen; der Zeitpunkt wird gesondert entschieden. Das Signatur-Feature (3 und 4) wird vorerst **nicht** an EVtivity gegeben, weder als PR noch als Feature-Request oder Issue (Entscheidung 30.09.2026).

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

### 3. Messnachweise speichern (`feature/ocpp16-signed-meter-data`, zusammen mit 4)

- Neue Tabelle für Messnachweise je Sitzung, angelehnt an OCPI `SignedData` (`packages/ocpi/src/types/ocpi.ts`):
  - Bezug: Sitzung, Station, EVSE (sofern bekannt).
  - `encoding_method` (`OCMF`), OCPP-Kontext (`Transaction.Begin`/`Transaction.End`/…; die Art Start/Ende lässt sich daraus ableiten), Zeitpunkt, Quelle (`StopTransaction`, `MeterValues`, `TransactionEvent`).
  - Rohdaten **unverändert als Text**, dazu ihr SHA-256 für die Deduplizierung (eindeutig je Station).
  - Verweis auf den zum Zeitpunkt gültigen Zählerschlüssel (aus 4), sofern bekannt.
- **Keine automatische Löschung:** Die Tabelle steht nicht in `log-retention-prune.ts`. Beim Löschen einer Sitzung darf der Nachweis nicht still mitgelöscht werden (kein `ON DELETE CASCADE`).
- Projektion: Werte mit `format: SignedData` (1.6) bzw. `signedMeterValue` (2.x) werden als Nachweis gespeichert und nicht als Zahl in `meter_values.value` geschrieben. Identische Datensätze (KC-P30: Begin und End) ergeben einen Eintrag.
- API: Nachweise einer Sitzung lesen (Route bei den Sitzungen, Berechtigung wie Sitzungsdetails).
- Nicht in diesem Schnitt: Anzeige in Betreiberoberfläche und Fahrerportal, Export, kryptografische Prüfung. Ein gespeicherter Nachweis gilt noch nicht als geprüft.
- Tests: Projektion mit dem 1.6-Muster der KC-P30 (Raw und SignedData gemischt, doppelter Datensatz); 2.x-`signedMeterValue`; Bereinigung lässt die Tabelle unberührt.

### 4. Zählerschlüssel übernehmen (im Zweig von 3)

Zusammengelegt mit 3 (30.09.2026): Nachweis und Schlüssel gehören fachlich zusammen, und der Verweis vom Nachweis auf den Schlüssel wird fest gespeichert.

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

### 6. Ping/Pong als Lebenszeichen (`fix/ocpp-idle-timeout-keepalive`, nachträglich freigegeben am 30.09.2026)

- Befund aus dem Pilot: Der OCPP-Server schloss Verbindungen nach 5 Minuten ohne OCPP-Nachricht (`IDLE_TIMEOUT_MS`), während die BootNotification-Antwort ein Heartbeat-Intervall von 300 s vergibt. Die KC-P30 hält das Intervall exakt ein; ihr Heartbeat kam Millisekunden nach Ablauf des Zeitgebers. Im Leerlauf wurde sie deshalb alle 5 bis 10 Minuten getrennt und verband sich etwa eine Minute später neu.
- Pings der Station und Pongs auf den Ping-Monitor (alle 30 s) setzen den Zeitgeber ebenfalls zurück; geschlossen werden nur Verbindungen ohne jedes Lebenszeichen. Zeit einstellbar über `OCPP_IDLE_TIMEOUT_MS` (Standard 5 Minuten). Seit `v0.1.29` im Fork ersetzt durch die Upstream-Fassung (`d5f4955`): gleiches Verhalten, die Zeit beträgt aber das Doppelte des Heartbeat-Intervalls, mindestens 5 Minuten; `OCPP_IDLE_TIMEOUT_MS` entfällt.
- Tests: `ocpp-server-idle.test.ts` mit echtem Server und verkürzter Zeit; ohne den Fix scheitern die Ping- und Pong-Fälle.
- Vorgesehen als PR an EVtivity.

### 7. Energiewerte mit Nachkommastellen (`fix/ocpp-decimal-meter-readings`, nachträglich freigegeben am 30.09.2026)

- Befund aus der zweiten Testladung: Die KC-P30 meldet `Energy.Active.Import.Register` mit einer Nachkommastelle als Text (`"2909465.9"`). Die MeterValues-Projektion übergab den Wert ohne Typ an `SET meter_start = …` und `… - meter_start`; `meter_start` ist `integer`, Postgres lehnte ab (`invalid input syntax for type integer`) und die ganze Projektion scheiterte. Folgen: Sitzungsenergie nur bei Werten auf `.0` fortgeschrieben (daher die 947 Wh der ersten Testladung), Live-Kosten nie berechnet („n/a“ im Portal), keine Standzeit-Erkennung, und die übrigen Werte der Nachricht gingen verloren – bei `StopTransaction.transactionData` auch die OCMF-Datensätze (3 griff deshalb nicht).
- Wert in SQL als `numeric` (für `meter_start` gerundet); nicht numerische Werte überspringen die Energieberechnung. Betrifft auch OCPP 2.1, wo `meter_start` aus dem ersten Messwert gesetzt wird.
- Tests: Projektion mit dem Wertmuster der KC-P30 und mit einem nicht numerischen Wert; Fehler und Behebung gegen Postgres 17 nachgestellt.

### 8. Portal- und Stopp-Befehle übersetzen lassen (`fix/portal-commands-version-translation`, nachträglich freigegeben am 30.09.2026)

- Befund: `sendOcppCommandAndWait()` mit `version` schickt Befehl und Nutzdaten unverändert (für bereits versionsgerechte Nutzdaten). Portal-Start und -Stopp, Gast-Start, Stopp einer aktiven Sitzung in der Betreiberoberfläche und `SendLocalList` bauten 2.1-Nutzdaten, gaben aber trotzdem die Version der Station mit. Die KC-P30 bekam deshalb wörtlich `RequestStopTransaction` mit `"transactionId":"4"` und antwortete `CALLERROR InternalError`; ein Stopp aus dem Portal war nicht möglich, Start und lokale Kartenliste wären ebenso betroffen.
- Diese sieben Aufrufe geben keine Version mehr mit; die vorhandene Übersetzung (`RemoteStopTransaction` mit ganzzahliger `transactionId` usw.) greift. `triggerAndWaitForStatus()` baut versionsgerechte Nutzdaten und übergibt die Version weiterhin. Der Parameter ist dokumentiert.
- Tests: Portal-Stopp einer 1.6-Sitzung ohne Versionsangabe; der bisherige Stationstest, der den Aufruf mit Version festschrieb, ist angepasst.

### Migrationen

Die Tabellen aus 3 und 4 kommen als eine Migration im Namenskreis `rhiem_` ([ADR 0002](../adr/0002-eigene-datenbankmigrationen.md)), von Hand geschrieben wie bei Upstream. 1, 2 und 5 brauchen keine Migration.

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
- Falls das Signatur-Feature später doch an EVtivity geht: vorher abstimmen, ob Schlüssel und Messnachweise als eigene Tabellen gewünscht sind.

## Umsetzungsstand (30.09.2026, Upstream-Stand 01.10.2026)

| #     | Zweig                                     | Commits                                               | Stand                                                                                                                                                                                                       |
| ----- | ----------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `fix/ocpp-auth-http-401`                  | `b2cd1b1`                                             | upstream als #23 (`v0.1.28`); neue Tests `ocpp-server-auth.test.ts` (echter Server) und `rejectionFor`                                                                                                      |
| 2     | `fix/ocpp16-session-energy-meter-stop`    | `1767cc5`                                             | upstream als #25 (`v0.1.28`); SQL zusätzlich gegen Postgres geprüft (normal, `meterStop` 0, ohne `meterStart`, ohne `meterStop`)                                                                            |
| 3 + 4 | `feature/ocpp16-signed-meter-data`        | `dfc6213`, `18b6651`                                  | in `rhiem/main`; Migration `rhiem_0002_signed_meter_data`; Tabellen `signed_meter_values` und `meter_public_keys`; Routen `GET /sessions/:id/signed-meter-values` und `GET /stations/:id/meter-public-keys` |
| 5     | `fix/tariff-price-net-label`              | `fcf8b7b` (PR-Variante), `c4a9924` (v0.1.27-Variante) | in `rhiem/main`; Beschriftung „netto“ in sechs Sprachen, Brutto-Vorschau `GrossPriceHint` / `formatGrossPrice`                                                                                              |
| 6     | `fix/ocpp-idle-timeout-keepalive`         | `3b152e1`                                             | PR #27 geschlossen, EVtivity hat eine eigene Fassung übernommen (`d5f4955`, `v0.1.28`); unsere seit `v0.1.29` entfernt                                                                                      |
| 7     | `fix/ocpp-decimal-meter-readings`         | `ec54c34`                                             | PR #29 geschlossen, EVtivity hat eine eigene Fassung übernommen (`c688cba`, `v0.1.28`); unsere seit `v0.1.29` entfernt                                                                                      |
| 8     | `fix/portal-commands-version-translation` | `fd9d69b`                                             | upstream als #31 (`v0.1.29`)                                                                                                                                                                                |

- Zu 1: Auch SP2 ohne TLS bekommt `401` **ohne** `WWW-Authenticate`, damit keine Station aufgefordert wird, ihr Passwort unverschlüsselt zu senden (Konzept nannte das nur für SP3). Verbindungen über dem Pro-IP-Limit werden weiterhin erst nach dem Upgrade mit `1008` geschlossen; für sie entfällt nur die Stationsabfrage. Datenbankfehler ergeben `503`.
- Zu 2: Umgesetzt als `GREATEST(bisherige Energie, meter_stop − meter_start)` und nur, wenn `meter_stop ≥ meter_start`. Die Energie sinkt dadurch nie, etwa bei einer Station, die `meterStop` 0 meldet. Die Ursache dafür, dass der letzte periodische Wert der Testladung die Sitzungsenergie nicht mehr aktualisierte, ist nicht geklärt. Im Code findet sich keine Erklärung; mit den gemockten Projektionstests lässt sie sich nicht nachstellen. Der Fix über `meterStop` macht das Ergebnis unabhängig davon richtig. Bei der nächsten Testladung die Sitzungsenergie vor dem Stopp mit dem letzten Messwert vergleichen.
- Zu 3 + 4: Wiederholte Datensätze einer Station ergeben eine Zeile, `Transaction.End` gewinnt als Kontext. Der Verweis auf den Schlüssel ist der zuletzt gemeldete Schlüssel des Anschlusses beim Eintreffen des Datensatzes; ist noch keiner bekannt, bleibt er leer. Migration, Deduplizierung, Verweis und Erhalt nach dem Löschen von Station, EVSE und Sitzung wurden gegen Postgres 17 geprüft.
- Zu 5: Baut auf den Upstream-PRs #18 (Dezimaleingabe) und #21 (Zahlenanzeige) auf, beide seit `v0.1.28` gemergt. `fix/tariff-price-net-label` basiert wie diese auf `upstream/main` und ist für den späteren PR gedacht, erst nachdem #18 und #21 gemergt sind. In `rhiem/main` ist die Variante `fix/tariff-price-net-label-v0.1.27` gemergt (auf den v0.1.27-Fassungen der beiden Locale-Fixes), damit keine ungetaggten Upstream-Commits nach `rhiem/main` gelangen.
- Im Pilot (30.09.2026): 1 bis 5 seit `2689620`, 6 mit `8c24b0d`. Mit der KC-P30 bestätigt: 1 (Anmeldung nach `401`, Traefik-Middleware entfernt) und 4 (Zählerschlüssel nach Reset per API gespeichert, identisch mit dem zuvor gesicherten). 2, 3 und 6 werden mit der nächsten Testladung bzw. im Leerlauf geprüft.
- Nebenbefund: Nach der BootNotification schickt EVtivity Werte aus der automatisch angelegten Konfigurationsvorlage. Die KC-P30 lehnt `MeterValuesSampledData` mit `SoC` ab (AC-Wallbox ohne Ladestand); die Vorlage ist anzupassen.

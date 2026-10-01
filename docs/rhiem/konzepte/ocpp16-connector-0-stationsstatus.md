# Konzept: OCPP 1.6 `connectorId 0` als Stationsstatus (Fix 9)

- **Status:** Entwurf (01.10.2026), noch nicht freigegeben
- **Anlass:** Die KEBA KC-P30 (Station `28980051`, `sta_ppofemilek3o`) wird im Pilot mit zwei Anschlüssen angezeigt. Ein Löschen der überzähligen „EVSE 0“ ist nicht möglich.

## Befund

| #   | Befund                                                                                                                                                                                                                                                                                                                                          | Stelle                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | OCPP 1.6 definiert `connectorId 0` als „Ladestation als Ganzes“. Die KC-P30 meldet `StatusNotification` für 0 (Station) und 1 (Anschluss). Das ist normales Verhalten, kein Gerätefehler.                                                                                                                                                       | OCPP 1.6 Edition 2, Abschnitt `StatusNotification`                                            |
| 2   | Der 1.6-Handler veröffentlicht `evseId: request.connectorId, connectorId: request.connectorId` ohne Sonderfall für 0.                                                                                                                                                                                                                           | `packages/ocpp/src/handlers/v1_6/status-notification.handler.ts`                              |
| 3   | Die Projektion `ocpp.StatusNotification` legt fehlende EVSEs und Anschlüsse an (`auto_created`, `connector_type = 'Unknown'`). Fehlt nur der Anschluss, legt sie ihn bei der nächsten Meldung neu an. Löschen hilft deshalb nur bis zur nächsten Statusmeldung.                                                                                 | `packages/ocpp/src/server/event-projections.ts` (ab Zeile 1464)                               |
| 4   | Die API verlangt `evseId >= 1` (`evseParams`, `connectorParams`). `DELETE /v1/stations/:id/evses/0` scheitert daher mit `VALIDATION_ERROR: params/evseId must be >= 1`. Die Regel ist richtig: EVSE-IDs sind 1-basiert, die 0 gibt es nur durch Befund 2.                                                                                       | `packages/api/src/routes/stations.ts` (Zeilen 1538 bis 1547)                                  |
| 5   | Der Stationsstatus `charging_stations.availability` (`available`, `faulted`, `unavailable`) wird in der Projektion aus den Anschlüssen abgeleitet (`faulted`, sobald ein Anschluss `faulted` ist). Eine Meldung für `connectorId 0` ist dem nicht ausdrücklich zugeordnet; heute wirkt sie nur, weil die 0 als Anschluss in `connectors` steht. | `packages/database/src/schema/assets.ts` (Z. 99), `event-projections.ts` (nach Zeile 1555)    |
| 6   | Die Benachrichtigungen für `ocpp.StatusNotification` (`stationId`, `connectorStatus`, `evseId`, `connectorId`, `isFaulted`) lesen die Nutzlast des Ereignisses, nicht die Tabellen.                                                                                                                                                             | `notification-dispatcher.ts` (Z. 180), `packages/csms/src/lib/template-variables.ts` (Z. 321) |

Quellenlage zur Dokumentation (geprüft 01.10.2026): Im Git-Repo gibt es unter `docs/` nur `docs/rhiem/`; `docs-index.json` ist nur ein Verzeichnis von Titeln und Beschreibungen der Seiten auf evtivity.com. Die Seiten selbst liegen nicht im Repo. Gelesen wurden die Einführung, „Stations“, „Station Lifecycle“ und „OCPP Testing“ auf evtivity.com. Keine davon erwähnt `connectorId 0` oder einen Stationsstatus aus OCPP 1.6. „Stations“ beschreibt: „Each station has one or more EVSEs, and each EVSE has one or more connectors.“ Die Oberfläche soll das so zeigen, die 0 passt dort nicht hinein. Die übrigen Seiten der Dokumentation habe ich nicht gelesen.

## Ziel

Die Oberfläche zeigt nur echte Anschlüsse. Eine Meldung für `connectorId 0` erzeugt weder EVSE noch Anschluss. Der Stationsstatus aus Meldungen für 0 geht nicht verloren, und bestehende Benachrichtigungen funktionieren weiter.

## Lösungskonzept

Ein Zweig `fix/ocpp16-connector-0-station-status` ab dem Upstream-Tag, auf dem `rhiem/main` steht, mit `--no-ff` in `rhiem/main` ([ADR 0001](../adr/0001-fork-und-branch-strategie.md)). Als PR an EVtivity vorgesehen, der Fehler besteht dort ebenso (`v0.1.29`).

### 1. Projektion: kein EVSE/Anschluss für die 0

- Der Handler bleibt unverändert, das Ereignis `ocpp.StatusNotification` wird weiter veröffentlicht. Damit laufen Benachrichtigungen, `isFaulted` und die Vorlagenvariablen wie bisher.
- Am Anfang des Abonnenten in `event-projections.ts` ein Zweig: `evseId === 0 && connectorId === 0` (OCPP 1.6; 2.1 kennt keine `evseId 0` in dieser Meldung). Dann werden weder `evses`, `connectors` noch `port_status_log` geschrieben. Der Stationsstatus wird nach 2 behandelt, danach kehrt der Zweig zurück.
- Der gemeinsame Rest (Benachrichtigung der Oberfläche über `notifyChange('station.status', …)` und OCPI-Push) läuft auch für die 0, damit die Anzeige aktuell bleibt.

### 2. Stationsstatus aus der 0 (Entscheidung offen)

Die bisherige Ableitung nimmt nur `connectors` als Quelle. Ohne Zeile für die 0 gäbe es dort keinen Fehlerzustand der Station mehr.

| Variante | Inhalt                                                                                                                                                                                                     | Bewertung                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a**    | Die 0 wird nur verworfen. Der Stationsstatus bleibt aus den Anschlüssen abgeleitet.                                                                                                                        | Kein Schema. Ein Fehler, den die Box nur über die 0 meldet (z. B. Gehäuse- oder Zählerfehler ohne Anschluss-Fehler), wird nicht als Stationsfehler sichtbar. Das Ereignis löst weiter die Benachrichtigung aus. |
| **b**    | Neue Spalte, z. B. `charging_stations.ocpp_station_status` (nullable), hält den letzten Status der 0. Die Ableitung von `availability` berücksichtigt sie: `faulted`, wenn Anschluss oder 0 `faulted` ist. | Vollständig, aber Schemaänderung (Drizzle-Migration, `check:migrations`), UI und Berichte prüfen. Mehr Aufwand und mehr Berührung mit Upstream.                                                                 |

Empfehlung: **a als erster PR**, **b nur bei Bedarf** (ein Fehler der KEBA nur über die 0 ist noch nicht beobachtet). Ohne Zeile in `connectors` würde ein einzelnes `availability = 'faulted'` aus der 0 beim nächsten Anschluss-Ereignis wieder überschrieben; deshalb ist ein halber Weg (Status direkt setzen, ohne Speicher) nicht vorgesehen.

### 3. Bestandsdaten

- Im Pilot einmalig die EVSE 0 der Station `28980051` entfernen. Vorher prüfen, dass keine `charging_sessions` auf sie verweisen (`charging_sessions.evse_id`), sonst nicht löschen. `port_status_log`-Zeilen bleiben unverändert.
- Ob der PR zusätzlich eine Migration enthält, die bei anderen Installationen automatisch angelegte EVSEs mit `evse_id = 0` ohne Sitzungen entfernt, ist offen. Empfehlung: nein, die Bereinigung bleibt Sache der Betreiber; ein Hinweis im PR genügt.

### 4. Nicht Teil dieses Konzepts

- Die Validierung `min(1)` bleibt unverändert.
- Die Anzeige „EVSE 0“ in der Oberfläche zu kennzeichnen entfällt, wenn die 0 nicht mehr angelegt wird.
- `StatusNotification` für 0 und die Anschlüsse bei `TriggerMessage` (`refresh-status`) bleiben wie bisher.

## Tests

- Projektion (Unit): Ereignis mit `evseId 0, connectorId 0` legt weder EVSE noch Anschluss an und schreibt kein `port_status_log`; ein Ereignis für `1/1` verhält sich wie bisher.
- Projektion (Unit): Existiert die EVSE 0 bereits (Altbestand), bleibt sie unverändert und wird nicht aktualisiert.
- Integration: Eine Station, die `StatusNotification` für 0 und 1 meldet, hat danach genau eine EVSE mit einem Anschluss.
- Benachrichtigung: `ocpp.StatusNotification` mit `connectorId 0` und `Faulted` löst weiter die Benachrichtigung aus (`isFaulted`).

## Prüfung vor dem PR

`npm run typecheck`, `lint`, `format:check`, alle Tests, `check:migrations` (und `test:integration` ohne stderr), vorher die CI von `upstream/main` ansehen.

## Offene Fragen

1. Variante a oder b für den Stationsstatus (Empfehlung a)?
2. Bereinigungsmigration für Altbestand mitliefern (Empfehlung nein)?
3. Soll der Stationsstatus der 0 im Statusverlauf (`port_status_log`) stehen (Empfehlung nein, die Tabelle ist je Anschluss)?

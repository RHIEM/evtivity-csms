# Bezeichnung für Tokens

- **Status:** Freigegeben (03.11.2026), umgesetzt (`50543942`), in `rhiem/main` mit `b9eee7fd`
- **Zweig:** `feature/driver-token-label` (Basis `v0.1.49-beta.8`), Migration `rhiem_0004_driver_token_label`
- **Upstream:** Vorschlag als Discussion [#49](https://github.com/EVtivity/evtivity-csms/discussions/49) („Ideas“, 03.11.2026; zuerst irrtümlich als Issue #48 angelegt und geschlossen), PR folgt nach Rückmeldung
- **Geprüft:** auf dem Zweig typecheck, lint, format:check, check:migrations, alle Tests (29.383; ein Timeout in `FleetReservationsTab` lief einzeln grün); nach dem Merge auf `rhiem/main` erneut alles grün (29.421 Tests, Journal: `rhiem_0004` mit `idx` 240 hinter `0482`)

## Abweichung von der Planung

- Die Fahrer-Token-Route `POST /drivers/:id/tokens` (Formular „Token für Fahrer anlegen“) nimmt die Bezeichnung ebenfalls an.
- Im Portal-PATCH wird „mindestens eines von `isActive` und `label`“ im Handler geprüft. Ein `.refine` landet nicht im JSON-Schema, mit dem Fastify validiert.
- Die Token-Detailseite zeigt die Bezeichnung zusätzlich unter der Überschrift.

## Ausgangslage

Ein Token (`driver_tokens`) hat außer dem Token-Wert (`idToken`), dem Typ und der Fahrerzuordnung kein Feld, an dem man ihn erkennt. In der Betreiberoberfläche erscheinen Karten nur als UID. Pool- und Ersatzkarten ohne festen Fahrer sind nicht unterscheidbar. Auch Fahrer sehen im Portal nur die maskierte UID und können ihre Karten nicht auseinanderhalten (z. B. „Firmenkarte“, „Privat“). `revokedReason` gibt es nur beim Deaktivieren, als Bezeichnung taugt es nicht.

## Entscheidung

- **Neue Spalte `driver_tokens.label varchar(100)`**, optional. Vorbild ist `payment_terminals.label` (`varchar(100)`, API `z.string().max(100)`, „Operator label“). In der Oberfläche heißt das Feld „Bezeichnung“.
- **Ein gemeinsames Feld für Betreiber und Fahrer.** Beide dürfen es ändern, die letzte Änderung gilt. Die Audit-Historie zeigt, wer geändert hat. Getrennte Felder für Betreiber und Fahrer wurden verworfen: Sie bringen mehr Umfang, ohne dass ein Bedarf erkennbar ist.
- **Leere Eingabe = `null`**, die Eingabe wird getrimmt.
- **Migration:** `rhiem_0004_driver_token_label.sql` mit `ALTER TABLE "driver_tokens" ADD COLUMN IF NOT EXISTS "label" varchar(100);`. Im PR bekommt sie die nächste Upstream-Nummer bei gleichem Inhalt (ADR 0002).

## Umfang

### API und Service

- `token.service.ts`: `label` in `tokenSelect`, `createToken` (auch beim Reaktivieren einer eigenen Karte) und `updateToken`. Die Suche (`tokenWhere`) findet auch die Bezeichnung. `TokenSnapshot` enthält `label`, damit die Historie Änderungen zeigt.
- `routes/tokens.ts`: Response-Schemas, `createTokenBody` (`label` optional), `updateTokenBody` (`label` nullable und optional).
- `routes/portal/tokens.ts`: `tokenItem`, `portalTokenColumns` und `toPortalToken` geben `label` zurück. `createTokenBody` erhält `label` optional. Im `updateTokenBody` werden `isActive` und `label` optional, mindestens eines muss gesetzt sein (sonst 400). Eine Umbenennung ändert den Status nicht und ist auch bei vom Betreiber gesperrten Karten erlaubt.
- Den KI-Werkzeugkatalog mit `npm run codegen:ai-tools` neu erzeugen.

### CSV

- `TOKEN_CSV_HEADER` und Export bekommen `label` als **6. Spalte am Ende**. Der Import (`Tokens.tsx`) liest nach Position, alte Dateien mit 5 Spalten bleiben gültig. Ist die Bezeichnung länger als 100 Zeichen, gibt es einen Zeilenfehler wie bei den anderen Feldern.

### Betreiberoberfläche (CSMS)

- `TokenCreate.tsx`, `DriverTokenCreate.tsx`: Eingabefeld „Bezeichnung“.
- `token/TokenDetailsTab.tsx`: Feld in der Bearbeiten-Ansicht, Anzeige in der Detailansicht.
- `TokensTable.tsx` (Token-Liste und Fahrerdetail): Bezeichnung als zweite, gedämpfte Zeile unter dem Token-Wert, keine neue Spalte.
- Übersetzungen `tokens.label`, `tokens.labelHint` in allen sechs Sprachen.

### Fahrerportal

- `AccountRfidCards.tsx`: Die Bezeichnung steht als Überschrift über der maskierten UID, ohne Bezeichnung bleibt es bei der UID. Ein Stift-Knopf öffnet einen Dialog zum Umbenennen (wie der vorhandene Dialog „Karte hinzufügen“). Der Hinzufügen-Dialog bekommt ein optionales Feld „Bezeichnung“.
- Übersetzungen im Portal in allen sechs Sprachen.

### Tests

Unit- und Routen-Tests für Anlegen, Ändern, Entfernen (`null`), Länge über 100 → 400, Suche nach Bezeichnung, CSV mit 5 und 6 Spalten, Portal-PATCH nur mit `label`, leerer Body → 400, fremde Karte → 404. Komponenten-Tests für `TokenDetailsTab` und `AccountRfidCards`. Vor dem PR der volle Prüfumfang: typecheck, lint, format:check, alle Tests, check:migrations.

## Nicht umgesetzt

- **OCPI:** Die Bezeichnung geht nicht an Partner. `visual_number` ist die auf der Karte aufgedruckte Nummer und damit etwas anderes.
- **Ladestation:** Local Auth List und Authorize bleiben unverändert. Wird nur die Bezeichnung geändert, löst das keinen neuen Push der Liste aus (`listFieldsChanged`).
- **Benachrichtigungen:** Eine Umbenennung schickt keine E-Mail.
- Anzeige in Sitzungslisten, Berichten und auf Rechnungen: möglicher Folgeschritt.

# Debitorennummer, Portal-Titel und Sage-Export

- **Status:** Alle drei Bausteine umgesetzt und in `rhiem/main` gemergt (23.11.2026), nicht deployt. Freigegeben am 20.11.2026 (Nutzer): Variante B für den Portal-Titel, Abbruch bei fehlender Debitorennummer, Bericht zunächst händisch. Antworten der FIBU (Philipp Krischke, Teams-Abfrage vom 20.11.2026) stehen noch aus; alle davon abhängigen Werte sind Einstellungen, kein Code.
- **Anlass:** Termin vom 20.11.2026 (siehe `evtivity-prod/Entscheidungen.md`): Rechnungen erstellt und versendet EVtivity am 1. des Monats, die FIBU liest die Rechnungsdaten per Datei in Sage ein; Zahlung per Lastschrift; Debitorennummer je Fahrer.
- **Basis:** `rhiem/main` (enthält `v0.1.51`). Die Zweige entstehen ausnahmsweise auf Basis von `rhiem/main` (siehe Abschnitt Zweige).
- **Vorbild für das Format:** RAB-Datei des ERPHelper (`erp-helper/go/internal/entity/rab.go`, `controller/sage_importer.go`).

Das Konzept hat drei Bausteine, einzeln umsetz- und prüfbar.

## Baustein 1: Debitorennummer am Fahrer

Fast eine Kopie der Personalnummer (`employee_number`, `rhiem_0011`), nur dass die Nummer nicht auf der Rechnung steht.

| Stelle     | Änderung                                                                                                  | Vorbild                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Migration  | `rhiem_0016_driver_debtor_number.sql`: `drivers.debtor_number varchar(20)`, null erlaubt, `IF NOT EXISTS` | `rhiem_0011_driver_employee_number.sql`                              |
| Schema     | Spalte `debtorNumber`                                                                                     | `packages/database/src/schema/drivers.ts`                            |
| API        | Feld bei Anlegen, Ändern, Detail; getrimmt, leer wird `null`                                              | `routes/drivers.ts` (`employeeNumberField`, `employeeNumberToStore`) |
| Löschen    | `debtor_number = null` bei „Fahrer löschen“                                                               | `services/driver-erasure.service.ts:117`                             |
| CSMS       | Feld im Formular „Fahrer erstellen“ und in den Details (Bearbeiten)                                       | `pages/DriverCreate.tsx`, `components/driver/DriverDetailsTab.tsx`   |
| KI-Katalog | neu erzeugen (`npm run codegen:ai-tools --workspace=@evtivity/api`)                                       | `services/ai/tools/catalog.ts`                                       |
| Portal     | **nicht anzeigen** (anders als die Personalnummer)                                                        | –                                                                    |

Nicht eindeutig erzwingen (wie die Personalnummer): Eine Eindeutigkeit wäre sinnvoll gegen Tippfehler, hängt aber an der Antwort der FIBU (ein Debitor je Person?). Format-Prüfung (z. B. fünf Ziffern) erst nach der Antwort.

## Baustein 2: Portal-Titel getrennt vom Firmennamen

**Befund:** `company.name` steuert heute Kopfzeile, Footer und Browser-Titel des Portals, den App-Namen (`routes/portal/web-app.ts`) und den Betreff aller E-Mails (136 deutsche Vorlagen beginnen mit `{{{companyName}}} - …`, z. B. „RHIEM EV - Richte dein Fahrerkonto ein“). Steht in den Unternehmenseinstellungen künftig die RPP, wechseln alle diese Stellen.

Neue Einstellung `company.portalTitle` (Tabelle `settings`, keine Migration), Rückfall auf `company.name`:

- Whitelist in `routes/settings.ts` (neben `company.name`) und Feld in `CompanySettings.tsx`.
- Portal: Überschrift und `document.title` in `AuthBranding.tsx`, App-Name in `routes/portal/web-app.ts`.
- **Der Footer behält den Firmennamen** (gewünscht).

**Entscheidung (20.11.2026): Variante B.** Zur Wahl standen:

- **Variante A (klein):** Der Portal-Titel gilt nur für Portalseiten und App-Namen. E-Mail-Betreffs zeigen weiter `company.name`, also künftig die RPP („RHIEM Packaging & Print GmbH - Richte dein Fahrerkonto ein“). Die Anleitung nennt dann den neuen Betreff.
- **Variante B (gewählt):** Der Portal-Titel ist der „Produktname“ und ersetzt auch in den E-Mails die Variable `companyName`. Das ist eine Stelle im Code (dort, wo die Vorlagen ihre Variablen bekommen), keine 136 Vorlagen. Betreff bliebe „RHIEM EV - Ladeportal - Richte dein Fahrerkonto ein“; besser wäre ein kurzer Titel wie „RHIEM EV“. Die E-Mail-Fußzeilen mit Anschrift nutzen weiter die Firmendaten.

## Baustein 3: Bericht „Sage-Rechnungsausgang“

Neuer Berichtstyp in der vorhandenen Registry (`services/src/report.service.ts`, `report-registry.ts`), Generator `report-generators/sage-rab-report.ts`.

**Aufnahme:** Rechnungen und Gutschriften mit Fahrer (Mitgliederrechnungen) und Rechnungsdatum (`issued_at`, Systemzeitzone) im gewählten Zeitraum, Status ausgestellt. Flottenrechnungen ohne Fahrer entfallen. Je Rechnung eine Zeile je Steuersatz (aus `invoice_line_items.tax_rate`; heute genau ein Satz, daher eine Zeile).

**Datei** (wie die RAB-Datei des ERPHelper): Semikolon, Kopfzeile, UTF-8 mit BOM, CRLF, Datum `TT.MM.JJJJ`, Dezimalkomma, Felder nur bei Bedarf in Anführungszeichen. Eigener kleiner Schreiber `rab-csv.ts`, denn der vorhandene `buildCsv` (`packages/lib/src/csv-escape.ts`) schreibt mit Komma und Dezimalpunkt. Dateiname aus Vorlage, z. B. `RAB-<Mandant>-JJJJMMTTHHMMSS.txt`; Format im System `csv`.

| Spalte                           | Quelle                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| `Buchungsdatum`                  | Rechnungsdatum oder Ende des Leistungsmonats (Einstellung)        |
| `Belegdatum`                     | Rechnungsdatum                                                    |
| `Belegnummer`                    | `invoices.invoice_number` (bzw. Gutschriftsnummer)                |
| `OPNr`                           | leer oder Rechnungsnummer (Einstellung)                           |
| `Buchungstext`                   | Vorlage, z. B. `E-Laden {monat}/{jahr}` (Einstellung), ohne Namen |
| `Konto_Soll`                     | Präfix + `drivers.debtor_number` (Präfix `D`)                     |
| `Konto_Haben`                    | Präfix `S` + Erlöskonto (Einstellung)                             |
| `Umsatz`, `Umsatz_Eigenwaehrung` | Brutto, Gutschrift negativ                                        |
| `Waehrung`                       | `EUR`                                                             |
| `Steuerart`                      | Einstellung (Vorgabe `UH`)                                        |
| `Steuercode`                     | Einstellung je Steuersatz (z. B. 19 → Code der FIBU)              |
| `Steuerbetrag`                   | USt, Gutschrift negativ                                           |
| `Zahlungskondition`              | Einstellung (z. B. `BEZDebitor`)                                  |

**Einstellungen** (neue Karte „Sage-Export“ neben `InvoiceSettings.tsx`, Muster `INVOICE_PAYMENT_TERMS_DAYS_KEY` in `database/src/lib/invoice-settings.ts`): Mandant, Dateinamen-Vorlage, Debitor-Präfix, Sachkonto-Präfix, Erlöskonto, Steuerart, Steuercode je Satz, Zahlungskondition, Buchungstext-Vorlage, Buchungsdatum-Modus, OP-Nummer-Modus. Sind Pflichtwerte leer, lehnt der Bericht die Erzeugung mit klarer Meldung ab.

**Fehlende Debitorennummer:** Mein Vorschlag weicht von der Teams-Frage ab: Der Bericht **bricht mit Liste der betroffenen Rechnungen ab** (Meldung im Berichtsprotokoll), statt sie still wegzulassen. Eine unvollständige Datei, die in Sage eingelesen wird, ist gefährlicher als ein zweiter Lauf. Entscheidung nach Philipps Antwort.

**Berechtigungen:** `payments:read` und `drivers:read` (die Datei enthält Beträge und Debitornummern), wie `revenue` und `driverActivity` in der Registry.

**Zeitraum und Zeitplan:** Die Oberfläche kennt `dateFrom`/`dateTo`. Erste Ausbaustufe: **händisch** mit Datumsbereich auf dem Rechnungsdatum (Rechnungen vom 1. des Monats, Gutschriften seit dem letzten Export). Das Planen per E-Mail an ein Sammelpostfach (Zeitplan monatlich, Tag 2, Empfänger über `recipient_emails`) geht erst, wenn der Zeitraum relativ sein kann: Geplante Läufe benutzen die gespeicherten Filter unverändert (`worker/src/handlers/report-scheduler.ts:67`), ein fester Datumsbereich würde jeden Monat dieselben Rechnungen liefern. Dafür bräuchte es einen Filter wie `period = currentMonth`; Gutschriften nach dem 2. kämen dann erst im Folgemonat mit. Alternative: Kennzeichen „exportiert am“ an der Rechnung (Migration, Seiteneffekt im Generator). **Zurückgestellt**, bis der händische Ablauf läuft.

## Reihenfolge und Prüfung

1. Baustein 1 (Debitorennummer), danach Baustein 3 (Bericht, auch ohne Antworten der FIBU, weil alle offenen Werte Einstellungen sind), danach Baustein 2 (Portal-Titel; hängt an deiner Entscheidung A/B).
2. Tests je Baustein: Migration (Hash, `npm run check:migrations`), API-Routen (`drivers-routes.test.ts`-Muster), CSMS-Formular und Detailtab, Schreiber `rab-csv` mit den Fällen aus dem ERPHelper (BOM, CRLF, Anführungszeichen, Dezimalkomma, die Beispielzeile aus `rab_test.go`), Generator mit gemockter Datenbank (Muster `sessions-report`), Berechtigungen.
3. Vor Deployment: Vollprüfung (typecheck, lint, format:check, `npm test`, `check:migrations`, `check:openapi`) und Migrationstest an frischem Dump.
4. Upstream: Portal-Titel (Baustein 2) ist als Idea-Discussion denkbar; Debitorennummer und Sage-Format sind RHIEM-spezifisch und bleiben im Fork.

## Entscheidungen und Offenes

Entschieden am 20.11.2026: Portal-Titel als Produktname auch in E-Mails (Variante B); fehlende Debitorennummer bricht den Bericht ab; Zeitraum zunächst händisch, Planen später.

Offen, nach Antwort der FIBU: Eindeutigkeit der Debitorennummer erzwingen oder nicht, Format der Nummer, und die konkreten Werte der Einstellungen (Mandant, Konten, Steuercode, Zahlungskondition u. a.).

## Zweige

Die Bausteine hängen am Code der Personalnummer und der Unternehmenseinstellungen von `rhiem/main` und sind RHIEM-spezifisch; sie entstehen deshalb ausnahmsweise als `feature/…` auf Basis von `rhiem/main` und nicht vom Tag: `feature/driver-debtor-number`, `feature/sage-rab-report`, `feature/portal-title`.

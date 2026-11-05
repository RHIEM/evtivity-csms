# Mehrere Rechnungssteller mit eigenen Nummernkreisen

- **Status:** Umgesetzt (04.11.2026), in `rhiem/main` gemergt, nicht deployt; Annahmen und Rückfragen unten. Ersetzt den Ladesitzungsbericht ([ladesitzungsbericht.md](ladesitzungsbericht.md)), der zurückgebaut ist
- **Anlass:** Abstimmung am 04.11.2026 mit den Fachbereichen (Präsentation, Übergabe, Rechnungsanforderungen). Weitere Anforderungen an die Rechnung folgen per E-Mail.
- **Basis:** Tag `v0.1.49` (Stand von `rhiem/main` nach dem Update vom 04.11.2026). Jeder Baustein soll für sich als PR bei EVtivity taugen und ohne Rechnungssteller das heutige Verhalten unverändert lassen.
- **Upstream:** Entscheidung des Nutzers 04.11.2026: erst im Fork umsetzen und an EVtivity melden, wenn der Stand final ist (Ideas-Discussion, Entwurf am Ende, danach PRs).
- **Termin:** Kein Zeitdruck. Ziel ist der finale Stand; danach werden die Altdaten und die Sitzungen seit 01.11.2026 migriert, zuerst testweise. Derzeit laden nur die Dienstwagen der leitenden Mitarbeiter und der Sonderfall des Nutzers.

## Anforderungen

RHIEM betreibt die Ladepunkte nicht als ein Rechnungssteller. Die Firmen der Gruppe sind als Flotten angelegt: RHIEM Intermedia GmbH (RI), RHIEM Services GmbH (RS) und RHIEM Packaging & Print GmbH (RPP).

1. **Dienstwagen leitender Mitarbeiter:** Die Ladevorgänge sind im Portal mit Kosten sichtbar, eine Rechnung entsteht nicht. Eine Kostenübersicht braucht derzeit niemand.
2. **Mitarbeiter mit Monatsrechnung:** Je Mitarbeiter und Monat entsteht eine formale Rechnung.
   - Rechnungssteller ist die GmbH des Mitarbeiters mit eigener Anschrift.
   - Käufer ist der Mitarbeiter mit der im Portal hinterlegten Rechnungsanschrift (Privatanschrift).
   - Die Rechnung trägt einen Hinweis wie „Bitte nicht überweisen, der Betrag wird mit der nächsten Gehaltsabrechnung verrechnet.“
   - Zugestellt wird nicht an den Mitarbeiter, sondern an eine pflegbare Stelle der GmbH, die die Rechnungen weiterverteilt.
   - Jede GmbH hat einen eigenen, lesbaren Nummernkreis (etwa RS 10000 ff., RPP 20000 ff.). Gutschriften haben einen eigenen Kreis mit derselben Logik.
   - Ob bezahlt wurde, wird nicht verfolgt; das erledigt die Gehaltsabrechnung. Ein Kreditlimit ist für diese Mitarbeiter nicht nötig.
3. **Sonderfall des Nutzers (bisher Ladesitzungsbericht):** eine eigene Flotte mit eigenem Rechnungssteller, eigener Anschrift und eigenem Nummernkreis. Das Dokument wird verworfen, die Übersicht entsteht von Hand.

Randbedingung: Alles, was der Stamm kann (Kreditlimit, Mahnungen, Zahlungsinformationen, GiroCode, Flottenrechnungen), bleibt erhalten und funktioniert für Flotten ohne die neuen Einstellungen wie bisher.

## Stand im Stamm (v0.1.49)

| Thema                    | Verhalten heute                                                                                                                                                                                     | Fundstelle                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Rechnung je Mitarbeiter  | Flotte mit Kontoabrechnung und `account_invoice_recipient = 'member'`; der Monatslauf erzeugt je Fahrer und Monat eine Mitgliederrechnung                                                           | `issueAccountInvoice` in `services/src/fleet-invoice.service.ts`   |
| Käufer                   | Rechnungsanschrift des Fahrers, als `invoices.bill_to` bei Ausstellung gespeichert                                                                                                                  | `billToFromDriver`                                                 |
| Verkäufer                | Einer für alles: `company.*` (Name, Anschrift, USt-ID, Register, E-Mail, Telefon). Er wird **bei jedem PDF-Abruf aus den aktuellen Einstellungen gelesen** und nicht an der Rechnung gespeichert.   | `loadInvoiceSeller` in `services/src/invoice-pdf.service.ts`       |
| Nummern                  | Ein globaler, lückenloser Zähler je Art (`invoice`, `credit_note`) in `invoice_number_counters`, Format fest `INV-YYYYMM-NNNN` bzw. `CN-YYYYMM-NNNN`; `invoices.invoice_number` ist global `UNIQUE` | `database/src/lib/invoice-number.ts`                               |
| Zustellung               | Mitgliederrechnung, -gutschrift und -mahnung gehen **nur an den Fahrer** (laut Code-Kommentar eine bewusste Entscheidung des Maintainers)                                                           | `memberInvoiceRecipient` in `services/src/fleet-invoice-notice.ts` |
| Zahlung                  | Mitgliederrechnungen entstehen als `issued`; Mahnung nach Fälligkeit (`invoice.MemberOverdue`), offene Rechnungen zählen zum Kreditlimit (`invoicedCents`)                                          | `fleet-invoice-run.ts`, `database/src/lib/fleet-credit-limit.ts`   |
| Zahlungsblock im PDF     | Global aus `company.iban` usw.; bei `paid` „Bezahlt am …“ samt Referenz, bei `issued` Überweisungstext und ggf. GiroCode                                                                            | `services/src/invoice-payment-block.ts`                            |
| Logo und Fußzeile im PDF | Global (`pdf.logo`, `pdf.footer`)                                                                                                                                                                   | `services/src/pdf-branding.ts`                                     |
| Zuordnung der Sitzung    | Beim Start gestempelt: `charging_sessions.billing_mode`, `billing_fleet_id`, `member_billed`                                                                                                        | `database/src/schema/charging.ts`                                  |

`insertInvoiceInTransaction` kann eine Rechnung bereits direkt als `paid` anlegen (`paidAt` = Ausstellung). Das nutzen Kartenzahlungen.

## Vorschlag: vier Bausteine

### 1. Rechnungssteller (Invoice issuer)

Neue Tabelle `invoice_issuers` (ID-Präfix `iss`):

| Spalte                                                                              | Zweck                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `name`, `street`, `zip`, `city`, `state`, `country`                                 | Kopf „Von“ auf der Rechnung                                 |
| `tax_id`, `tax_id_label`, `registration_number`, `invoice_email`, `invoice_phone`   | wie die heutigen Verkäuferfelder (`company.*`)              |
| `bank_account_holder`, `iban`, `bic`, `bank_name`                                   | optional; leer = Zahlungsblock wie im Stamm aus `company.*` |
| `invoice_prefix`, `invoice_year`, `invoice_start`, `invoice_digits`                 | Nummernkreis Rechnungen (siehe unten)                       |
| `credit_note_prefix`, `credit_note_year`, `credit_note_start`, `credit_note_digits` | Nummernkreis Gutschriften, gleiche Logik                    |

Neue Spalte `fleets.invoice_issuer_id` (nullable, `ON DELETE RESTRICT`). Ohne Rechnungssteller bleibt alles wie im Stamm: Verkäufer aus `company.*`, Nummer `INV-YYYYMM-NNNN`.

Ein Rechnungssteller gilt für die Flottenrechnung und die Mitgliederrechnungen der Flotte. Rechnungen für Fahrer ohne Flotte (Kartenzahlung) bleiben beim Unternehmen.

CSMS: Einstellungen → Rechnungen → „Rechnungssteller“ (Liste, Anlegen, Bearbeiten), an der Flotte im Rechnungsprofil eine Auswahl. Berechtigung wie die heutigen Verkäufereinstellungen (`settings.system:write`, alle Standorte).

### 2. Verkäufer an der Rechnung speichern

Neue Spalte `invoices.seller` (jsonb), geschrieben bei Ausstellung und danach nie geändert, wie `bill_to`. Sie enthält den Verkäufer, der heute aus `company.*` gelesen wird, bzw. die Daten des Rechnungsstellers. Dazu kommt `invoices.issuer_id` (nullable) für Auswertung und Filter.

- Das PDF liest den Verkäufer aus `invoices.seller`. Bei älteren Rechnungen ohne Speicherung liest es wie bisher aus den Einstellungen.
- Eine Gutschrift übernimmt `seller` und `issuer_id` der gutgeschriebenen Rechnung.
- Dieser Baustein ist **auch ohne Rechnungssteller sinnvoll**: Heute ändert eine geänderte Firmenanschrift alle alten Rechnungs-PDFs (GoBD: Inhalt nach Ausstellung unveränderlich). Er eignet sich daher als erster, eigenständiger PR.

### 3. Zustellung der Mitgliederrechnungen

Neue Spalte `fleets.member_invoice_delivery`: `'driver'` (Standard, wie heute) oder `'billing_contacts'`. Bei `billing_contacts` gehen Mitgliederrechnungen und -gutschriften an die Rechnungskontakte der Flotte (`fleets.billing_contact_emails`, gibt es schon für Flottenrechnungen) und nicht an den Fahrer. Eine E-Mail je Rechnung mit PDF im Anhang.

- Das Ereignis bleibt `invoice.MemberInvoice` bzw. `invoice.MemberCreditNote`; die Empfänger wechseln nur. Die E-Mail-Vorlage braucht dafür den Namen des Mitarbeiters als Variable (vorhanden prüfen).
- Der Monatslauf erzeugt Mitgliederrechnungen dann auch für Fahrer ohne E-Mail-Adresse; Voraussetzung ist mindestens ein Rechnungskontakt (wie die Prüfung `fleets_auto_invoice_contact_check`).
- Im Portal sieht der Mitarbeiter seine Rechnung weiterhin (Liste und PDF). Ob das gewünscht ist, ist noch offen.
- Weil der Maintainer „nur an den Fahrer“ bewusst entschieden hat, gehört dieser Punkt in die Discussion.

### 4. Zahlung außerhalb von EVtivity (z. B. Gehaltsverrechnung)

Neue Spalten an der Flotte:

- `fleets.account_settlement`: `'payment'` (Standard, wie heute) oder `'external'`;
- `fleets.settlement_note` (Text): wird bei `external` auf jede Rechnung gedruckt, z. B. „Bitte nicht überweisen. Der Betrag wird mit der nächsten Gehaltsabrechnung verrechnet.“

Bei `external` gilt für Flotten- und Mitgliederrechnungen:

- Sie entstehen direkt als `paid` mit `paidAt` = Rechnungsdatum. Es gibt keine Mahnung, und das Kreditlimit sieht keine offenen Rechnungen. Es funktioniert weiter für unabgerechnete und laufende Sitzungen, falls eine solche Flotte doch eines bekommt.
- Der Hinweis wird als `invoices.settlement_note` gespeichert und ersetzt im PDF den Zahlungsblock: kein „Bezahlt am …“, kein Überweisungstext, kein GiroCode.
- Im CSMS und im Portal steht die Rechnung als „Verrechnet“ statt „Bezahlt“. Dafür gibt es keinen neuen Status, die Anzeige richtet sich nach `settlement_note IS NOT NULL`.
- Eine Gutschrift auf eine solche Rechnung gilt ebenfalls als verrechnet und bekommt den Hinweis der Rechnung. Den Text dafür klären wir mit der E-Mail bzw. der Steuerberatung.

Ein eigener Status `settled` wäre sauberer, ändert aber ein Enum, auf das Filter, Berichte und das Portal angewiesen sind. Mit `paid` plus Hinweis bleibt die Änderung klein.

## Nummernformat

Je Rechnungssteller und Art (Rechnung, Gutschrift) vier Felder:

| Feld      | Bedeutung                                         | Beispiel RS        | Beispiel RI    |
| --------- | ------------------------------------------------- | ------------------ | -------------- |
| Präfix    | optional, frei                                    | leer               | `RI-`          |
| Jahr      | zweistelliges Jahr nach dem Präfix, ohne Trennung | nein               | ja             |
| Startwert | erste Nummer                                      | 10000              | 1              |
| Stellen   | Mindestlänge, mit Nullen aufgefüllt               | 0                  | 5              |
| Ergebnis  |                                                   | `10000`, `10001` … | `RI-2600001` … |

- **Mit Jahr beginnt der Zähler jedes Jahr neu beim Startwert, ohne Jahr läuft er durch.**
- Maßgeblich ist das Jahr des Rechnungsdatums, wie heute in der Systemzeitzone. Bei „Rechnungsdatum = Monatsletzter“ trägt die Dezember-Rechnung also noch das alte Jahr.
- Die Zähler liegen in der Tabelle `invoice_issuer_number_counters`, eine Zeile je Rechnungssteller, Art und Jahr (Jahr 0 für einen Kreis ohne Jahr). Die Zeile wird bei der ersten Vergabe angelegt (`INSERT … ON CONFLICT DO UPDATE … RETURNING`). Wie heute ist sie bis zum Commit gesperrt, die Vergabe bleibt also lückenlos.
- `invoices.invoice_number` bleibt global eindeutig. **Kreise sollten sich nicht überschneiden. Tun sie es doch, teilen sie sich die Nummern** (Rückmeldung 05.11.2026): Die Vergabe prüft jede gezogene Nummer gegen die vorhandenen Belege und überspringt eine bereits vergebene, gleich woher sie stammt. Eine Transaktionssperre auf die Nummer (`pg_advisory_xact_lock`) lässt einen gleichzeitigen Beleg eines anderen Rechnungsstellers warten, bis der erste festgeschrieben ist; danach sieht er die Nummer als vergeben und zieht die nächste. Für den einzelnen Rechnungssteller entstehen dann Lücken, zusammen bleibt der Kreis lückenlos. Das Formular weist darauf hin.
- **Nach der ersten vergebenen Nummer sind Präfix, Jahr und Stellen gesperrt.** Der Startwert gilt nur für neue Zähler (also ein neues Jahr), damit kein Kreis rückwärts läuft.

## Abbildung der drei Fälle

| Fall                 | Flotte                          | Einstellungen                                                                                                                                                                                                                  |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Dienstwagen        | je GmbH „<Firma> – Dienstwagen“ | Kontoabrechnung an, Monatslauf (`auto_invoice`) aus, kein Kreditlimit. Kein neuer Code nötig. Bei der Umsetzung prüfen, ob dauerhaft unabgerechnete Sitzungen irgendwo stören (Hinweise, Monatslauf-Fehler, Flottenübersicht). |
| 2 Gehaltsverrechnung | je GmbH „<Firma> – Mitarbeiter“ | Kontoabrechnung an, „Each Driver“, Rechnungssteller = GmbH, Zustellung an Rechnungskontakte (Stelle der GmbH), Zahlung extern mit Hinweis, Monatslauf an, Preisgruppe nach Bedarf                                              |
| 3 Sonderfall         | eigene Flotte                   | eigener Rechnungssteller mit eigener Anschrift und eigenem Kreis, sonst wie Fall 2. Zustellung an den Nutzer selbst.                                                                                                           |

## Rückbau im Fork

Wenn die Bausteine in `rhiem/main` sind und Fall 3 damit läuft:

- Ladesitzungsbericht zurückbauen: die Merges `d36782f6` (`feature/session-report`) und `4994059f` (`fix/session-report-no-replaces`) per `git revert -m 1`. Es gibt keine Migration. In der Datenbank die Einstellung `invoice.externalInvoicing` entfernen und Reste des Ereignisses `invoice.MemberSessionReport` in den Benachrichtigungseinstellungen prüfen.
- Bereits ausgestellte interne Rechnungen (z. B. `INV-202611-0004`, sofort bezahlt) bleiben stehen.
- Im Fork bleiben danach nur die signierten Messdaten (Prüfzeile im Rechnungs-PDF: dort auf Konflikte mit Baustein 2 achten). Die Token-Bezeichnung entfällt nach dem Merge von PR 50.

## Umsetzung und Migration

1. `rhiem/main` auf das stabile v0.1.49 bringen (04.11.2026, `rhiem/update-v0.1.49`).
2. Bausteine auf Zweigen ab Tag `v0.1.49` bauen, in der Reihenfolge 2 → 1 → 4 → 3. Baustein 2 ist eigenständig, 1 braucht 2, 4 und 3 sind voneinander unabhängig. Jeder Baustein mit Migration, Tests, OpenAPI, KI-Katalog und Übersetzungen in den sechs Sprachen. Danach jeweils mit `--no-ff` in `rhiem/main` mergen.
3. Ladesitzungsbericht zurückbauen (siehe oben).
4. **Migration zuerst gegen einen Dump der Produktion (lokal):**
   - Rechnungssteller RI, RS, RPP und den Sonderfall anlegen und die Flotten nach der Tabelle oben umbauen.
   - Unabgerechnete Sitzungen seit 01.11.2026 (und die Altdaten des Nutzers) per SQL umstempeln: `billing_mode`, `billing_fleet_id`, `member_billed`, nur wo `invoice_id IS NULL`.
   - Monatslauf für November testen, PDFs, Nummern und Zustellung prüfen.
5. Danach dasselbe in der Produktion, vor dem ersten echten Lauf am 01.12.2026 bzw. am eingestellten Lauftag.

## Offene Punkte

- **E-Mail mit weiteren Rechnungsanforderungen** abwarten und einarbeiten.
- **Steuerlich:** Wer leistet, wenn ein Mitarbeiter der RPP an einer Säule der RS lädt? Rechnet trotzdem der Arbeitgeber ab? Mit der Steuerberatung klären, ebenso den Text für Gutschriften bei Gehaltsverrechnung.
- **Portal:** Soll der Mitarbeiter seine Gehaltsverrechnungs-Rechnungen im Portal sehen, oder nur die Stelle der GmbH per E-Mail?
- **Nummernkreise:** endgültige Werte je GmbH.

## Umsetzung (04.11.2026)

Alle vier Bausteine sind umgesetzt, geprüft und mit `--no-ff` in `rhiem/main` gemergt. Nicht deployt. Die Zweige sind gestapelt, jeder baut auf dem vorigen auf; für PRs an EVtivity werden sie einzeln auf `upstream/main` gebracht.

| Baustein                    | Zweig                                            | Commit     | Migration                             |
| --------------------------- | ------------------------------------------------ | ---------- | ------------------------------------- |
| 2 Verkäufer an der Rechnung | `feature/invoice-seller-snapshot` (ab `v0.1.49`) | `5a4d5a2a` | `rhiem_0005_invoice_seller`           |
| 1 Rechnungssteller          | `feature/invoice-issuers`                        | `407ee332` | `rhiem_0006_invoice_issuers`          |
| 4 Zahlung extern            | `feature/fleet-external-settlement`              | `ae2069ed` | `rhiem_0007_fleet_account_settlement` |
| 3 Zustellung                | `feature/member-invoice-delivery`                | `252b9c13` | `rhiem_0008_member_invoice_delivery`  |

Merges in `rhiem/main`: `c90d124b` (2), `dd8e5588` (1), `5cad30bf` (4), `a4218758` (3). Der Ladesitzungsbericht ist vorher zurückgenommen worden: `0b97f226` (Fix-Merge) und `5bd53c76` (Feature-Merge).

**Geprüft** je Zweig und auf `rhiem/main`: typecheck, lint, format:check, check:migrations, check:openapi, alle Tests. Migration mit PostgreSQL 17: Neuinstallation (247), zweiter Lauf ohne Änderung, Pilot-Abschluss-Dump vom 16.10.2026 (98 nachgeholt, `verify-migrations-applied OK: 247`). Das Schema der Neuinstallation und des Pilot-Dumps stimmt überein, bis auf die Schreibweise alter Upstream-CHECK-Constraints.

### Abweichungen vom Entwurf

- **Eigene Zählertabelle** `invoice_issuer_number_counters` (Rechnungssteller, Art, Jahr; Jahr 0 ohne Jahresangabe) statt Zeilen in `invoice_number_counters`: deren Namensspalte (`varchar(32)`) ist für Schlüssel mit ID zu kurz.
- **Keine Bankverbindung je Rechnungssteller.** Bei Gehaltsverrechnung entfällt der Zahlungsblock ohnehin; sonst gelten die Bankdaten des Unternehmens.
- **Audit** der Rechnungssteller in der Einstellungshistorie (`setting_audit_log`, Schlüssel `invoiceIssuer:<id>`), keine eigene Tabelle.
- **E-Mail an die Rechnungskontakte** mit den vorhandenen Ereignissen `invoice.FleetInvoice` / `invoice.FleetCreditNote` statt einer eigenen Vorlage.
- **Status „Verrechnet“** ist kein neuer Rechnungsstatus: Die Rechnung ist `paid` und trägt `settlement_note`. CSMS und Portal zeigen in der Detailansicht „Verrechnet“ mit dem Hinweis.

### API und Oberfläche

- `GET/POST /v1/invoice-issuers`, `PATCH/DELETE /v1/invoice-issuers/:id` (`settings.system:read/write`, nur mit Zugriff auf alle Standorte). Neue Fehlercodes `INVOICE_ISSUER_NOT_FOUND`, `INVOICE_ISSUER_IN_USE`, `INVOICE_ISSUER_NUMBER_FORMAT_LOCKED`.
- `PATCH /v1/fleets/:id/billing-profile`: neue Felder `invoiceIssuerId`, `accountSettlement` (`payment` | `external`), `settlementNote`, `memberInvoiceDelivery` (`driver` | `billing_contacts`).
- Rechnungen (CSMS und Portal): Felder `seller` (intern), `issuerId`, `settlementNote`.
- CSMS: Einstellungen → Rechnungssteller (bis 05.11.2026 unter Unternehmen); im Rechnungsprofil der Flotte die Felder Rechnungssteller, Verrechnung mit Hinweis und „Mitgliederrechnungen senden an“.

### Einrichtung für RHIEM (nach dem Deployment)

1. Unter Einstellungen → Rechnungssteller die Rechnungssteller anlegen: RHIEM Intermedia, RHIEM Services, RHIEM Packaging & Print und einen für den Sonderfall, jeweils mit Anschrift, USt-ID und Nummernkreisen. Format und Startwerte erst festlegen, wenn sie endgültig sind: Nach der ersten Rechnung sind sie gesperrt.
2. Flotten je GmbH:
   - „<Firma> – Dienstwagen“: Kontoabrechnung an, Monatslauf aus, kein Kreditlimit.
   - „<Firma> – Mitarbeiter“: Kontoabrechnung an, „Each Driver“, Rechnungssteller = GmbH, Verrechnung extern mit Hinweis, Mitgliederrechnungen an die Rechnungskontakte (Stelle der GmbH), Monatslauf an.
   - Sonderfall: eigene Flotte mit eigenem Rechnungssteller, Zustellung an den Nutzer.
3. Fahrer den Flotten zuordnen. Unabgerechnete Sitzungen seit 01.11.2026 und die Altdaten des Nutzers per SQL umstempeln (`billing_mode`, `billing_fleet_id`, `member_billed`, nur wo `invoice_id IS NULL`); vorher an einem Produktions-Dump lokal testen.
4. In der Produktion `invoice.externalInvoicing` löschen (Einstellung des zurückgebauten Ladesitzungsberichts) und prüfen, ob das Ereignis `invoice.MemberSessionReport` noch in den Benachrichtigungseinstellungen steht.

## Rückmeldung 05.11.2026

**Umgesetzt** (`fix(invoices)` `76f28d3e` auf `feature/invoice-issuers`, Merge `2d3eda1c`):

- Kein Trennzeichen nach dem Jahr: `RI-2600001` statt `RI-26-00001`.
- Überschneidende Kreise teilen sich die Nummern; die Vergabe überspringt bereits vergebene (siehe Nummernformat). Hinweistext im Formular entsprechend („fortlaufend“ statt „lückenlos“).

**Umgesetzt** (freigegeben 05.11.2026), mit `--no-ff` in `rhiem/main` gemergt:

| Teil                             | Zweig                             | Commit     | Migration                                 |
| -------------------------------- | --------------------------------- | ---------- | ----------------------------------------- |
| Tab „Rechnungssteller“           | `feature/invoice-issuers`         | `81798a71` | –                                         |
| PDF-Logo und Fußzeile je Steller | `feature/invoice-issuer-branding` | `ffdbf7c2` | `rhiem_0009_invoice_issuer_branding`      |
| Rechnungsempfang als Gruppe      | `feature/member-invoice-delivery` | `9aab11ee` | `rhiem_0010_member_invoice_delivery_none` |

1. **Eigener Tab „Rechnungssteller“** in den Einstellungen hinter „Unternehmen“ (`settings.system:read`, alle Standorte) mit Einleitung. Nur der eigene Block zieht um, die Upstream-Blöcke bleiben unter „Unternehmen“. Das Rechnungsprofil der Flotte verlinkt mit „Rechnungssteller verwalten“ direkt auf den Tab (`/settings?tab=invoiceIssuers`).
2. **PDF-Logo und Fußzeile je Rechnungssteller** (optional): `invoice_issuers.pdf_logo` (`NULL` = Logo des Unternehmens) und `pdf_footer` (`NULL` = Fußzeile des Unternehmens, leer = keine Fußzeile). Wie beim Unternehmen live beim Erzeugen des PDFs gelesen, keine Momentaufnahme an der Rechnung; ein unbrauchbares Logo fällt auf das des Unternehmens zurück. API: `GET/PUT/DELETE /v1/invoice-issuers/:id/pdf-logo`, `pdfFooter` beim Anlegen und Ändern; Liste und Audit tragen nur `hasPdfLogo`, nie das Bild. Die Druckansicht holt das Logo über `GET /v1/invoices/print-logo?invoiceId=`. Berichte behalten das globale Branding. Im Formular: Logo hochladen/entfernen (erst nach dem Anlegen), Ankreuzfeld „Eigene Fußzeile“.
3. **Rechnungsempfang als Gruppe im Rechnungsprofil:**
   - „Rechnung an“ (Flotte / Jeden Fahrer) zieht aus der Karte „Abrechnung“ oben in die Gruppe; die Umschaltung speichert wie bisher sofort nach Bestätigung. Die Bestätigung nennt die E-Mail „Abrechnung auf Rechnung geändert“ (`fleet.AccountBillingChanged`, abschaltbar unter Benachrichtigungen → Fahrer-Ereignisse) und dass vor dem Wechsel gestartete Ladevorgänge noch auf eine letzte Flottenrechnung kommen.
   - Bei „Flotte“: Rechnungsempfänger (Firmenname, Anschrift, USt-ID), Rechnungssprache und „Versand per E-Mail an“ (bisher „Rechnungskontakte“).
   - Bei „Jeden Fahrer“: Hinweis, dass der Fahrer mit seiner Rechnungsadresse Empfänger ist, und „Versand“: an den Fahrer, an feste E-Mail-Adressen (dann erscheint „Versand per E-Mail an“) oder „Nicht versenden (nur im CSMS)“.
   - Warnung, wenn bei Versand an E-Mail-Adressen keine hinterlegt ist. Ausgeblendete Werte bleiben gespeichert.
   - Gruppe „Ausstellung“: Rechnungssteller, Rechnungsdatum, Verrechnung mit Hinweis, Zahlungsziel (ausgeblendet bei Verrechnung extern), automatische Monatsrechnung.

**Abweichung vom Entwurf („nur Oberfläche“):** Zwei Backend-Änderungen waren nötig, damit die Gruppe so funktioniert:

- **Neuer Wert `none`** in `fleets.member_invoice_delivery`: Mitgliederrechnungen und Gutschriften werden ausgestellt, aber nicht versendet (`sent_at` bleibt leer), und es gibt keine Zahlungserinnerung. „Senden“ auf einer solchen Rechnung antwortet 400 `INVOICE_DELIVERY_OFF`.
- **Rechnungskontakte nur noch Pflicht, wenn sie Empfänger sind.** Upstream verlangt für die automatische Monatsrechnung immer einen Kontakt (API und Constraint `fleets_auto_invoice_contact_check`). Jetzt nur noch bei „Rechnung an: Flotte“ oder bei Versand der Mitgliederrechnungen an die Kontakte; sonst ließe sich „Jeden Fahrer“ mit Versand an den Fahrer und Monatslauf nicht speichern. Der Wechsel zurück auf „Flotte“ ohne Kontakt bei aktivem Monatslauf antwortet 400 `FLEET_BILLING_CONTACT_REQUIRED`. Eine letzte Flottenrechnung für Ladevorgänge vor dem Wechsel auf „Jeden Fahrer“ wird ohne Kontakte ausgestellt, aber nicht versendet (wie bisher protokolliert).

**Geprüft** auf dem zusammengeführten Stand: typecheck, lint, format:check, check:migrations (249), check:openapi, 29.917 Tests grün (der bekannte Zeitlimit-Test `FleetReservationsTab` einzeln grün). Vergabe bei überschneidenden Kreisen mit zwei gleichzeitigen Sitzungen an PostgreSQL 17 geprüft.

### Nachtrag 05.11.2026: Personalnummer und Versand an beide

**Personalnummer am Fahrer** (`feature/driver-employee-number`, `d8c1d135`, Migration `rhiem_0011_driver_employee_number`, freigegeben 05.11.2026):

- Neues optionales Feld `drivers.employee_number` (Text bis 50 Zeichen, nicht eindeutig). Pflege im CSMS beim Anlegen und in der Detailansicht des Fahrers (`drivers:write`), im Verlauf des Fahrers festgehalten, von der DSGVO-Löschung geleert. Die Fahrersuche findet es.
- Der Fahrer sieht es im Portal unter den persönlichen Daten nur lesend (`GET /v1/portal/auth/me`, Feld `employeeNumber`).
- Auf Rechnung und Gutschrift „Personalnr.: …“ im Block „Rechnung an“, nur wenn gesetzt: bei der Mitgliederrechnung beim Ausstellen im Empfängerblock eingefroren (die Gutschrift erbt ihn), bei der Fahrerrechnung ohne Flotte live wie Name und E-Mail, bei der Flottenrechnung hinter dem Fahrernamen jeder Gruppe (beim Ausstellen in den Positions-Metadaten). Bereits ausgestellte Rechnungen bleiben unverändert.

**Versand der Mitgliederrechnungen als zwei Ankreuzfelder** (`feature/member-invoice-delivery`, `35aaea2e`, Migration `rhiem_0012_member_invoice_delivery_both`, freigegeben 05.11.2026):

- „E-Mail an den Fahrer“ und „E-Mail an feste E-Mail-Adressen“; bei der zweiten erscheint „Versand per E-Mail an“. Abgebildet auf `member_invoice_delivery`: nur Fahrer `driver`, nur Adressen `billing_contacts`, beide `driver_and_contacts` (neu), keines `none` (nicht versenden, Hinweis im Formular).
- Bei beiden: ein PDF, eine Versandmarke (`sent_at`), dann Fahrer und jede Adresse. Ein Fahrer ohne E-Mail verhindert den Versand an die Adressen nicht. Zahlungserinnerungen gehen an den Fahrer. Die Monatsrechnung braucht wie bei `billing_contacts` eine Adresse.

## Annahmen und Rückfragen

Während der Umsetzung getroffene Annahmen. Bitte bestätigen oder korrigieren; in Ausnahmen bauen wir zurück.

### Baustein 2 (Verkäufer an der Rechnung)

1. **Keine Nachträge für alte Rechnungen.** Bereits ausgestellte Rechnungen bekommen keinen gespeicherten Verkäufer, ihr PDF liest weiter die aktuellen Einstellungen. Alternative: einmalig mit dem heutigen Stand füllen.
2. **Gutschrift übernimmt den Verkäufer der Rechnung**, nicht den aktuellen.

### Baustein 1 (Rechnungssteller)

3. **Eigene Zählertabelle** `invoice_issuer_number_counters` (Rechnungssteller, Art, Jahr) statt `invoice_number_counters`: deren Namensspalte (`varchar(32)`) ist für Schlüssel mit ID zu kurz.
4. **Präfix:** nur Buchstaben, Ziffern und `- . _`, höchstens 20 Zeichen. Kein `/`, weil die Nummer den PDF-Dateinamen bildet.
5. **Trennzeichen:** Das Präfix bringt sein Trennzeichen selbst mit (`RI-`). Nach dem Jahr steht **kein** Trennzeichen (`RI-2600001`, ohne Präfix `2600001`; Rückmeldung 05.11.2026).
6. **Sperre:** Präfix, Jahr, Startwert und Stellen einer Belegart sind gesperrt, sobald der Rechnungssteller einen Beleg dieser Art ausgestellt hat (auch der Startwert für künftige Jahre). Die Kopfdaten (Name, Anschrift, USt-ID) bleiben änderbar und gelten für später ausgestellte Belege.
7. **Überschneidung von Kreisen** wird nicht beim Speichern geprüft, nur ein Hinweis im Formular. Überschneiden sich Kreise, teilen sie sich die Nummern: Die Vergabe überspringt bereits vergebene Nummern (Rückmeldung 05.11.2026, siehe Nummernformat).
8. **Keine Bankverbindung je Rechnungssteller.** Bei „Zahlung extern“ wird kein Zahlungsblock gedruckt; sonst gelten die Bankdaten des Unternehmens.
9. **Audit über die Einstellungshistorie:** Anlegen, Ändern und Löschen eines Rechnungsstellers stehen in `setting_audit_log` unter dem Schlüssel `invoiceIssuer:<id>` (Einstellungen → Historie), keine eigene Audit-Tabelle. Die Zuordnung an der Flotte steht wie das übrige Rechnungsprofil im Flotten-Audit.
10. **Löschen** nur, solange keine Flotte und keine Rechnung den Rechnungssteller nutzt und noch kein Beleg nummeriert wurde.
11. **Berechtigung:** Rechnungssteller verwalten wie die Verkäuferdaten (`settings.system:read/write`, alle Standorte). Wer nur das Flottenprofil bearbeiten darf, sieht in der Auswahl nur „Das Unternehmen“ und den gesetzten Eintrag.
12. **Logo und Fußzeile** bleiben für alle Rechnungssteller gleich (global). Offen, ob je GmbH ein eigenes Logo oder eine eigene Fußzeile (Geschäftsführung, Registergericht) nötig ist.
13. **Neue Fehlercodes** (`INVOICE_ISSUER_IN_USE`, `INVOICE_ISSUER_NOT_FOUND`, `INVOICE_ISSUER_NUMBER_FORMAT_LOCKED`) stehen im Fork direkt in `error-codes.generated.ts`. Für einen PR pflegt EVtivity sie in seiner Website-Liste.
14. **Zweige gestapelt:** Baustein 1 baut auf Baustein 2 auf (`feature/invoice-issuers` von `feature/invoice-seller-snapshot`).

### Baustein 4 (Zahlung außerhalb von EVtivity)

15. **Status „bezahlt“ statt eigenem Status.** Verrechnete Rechnungen entstehen als `paid` (bezahlt am Rechnungsdatum, fällig am Rechnungsdatum). CSMS und Portal zeigen sie in der Detailansicht als „Verrechnet“ mit dem Hinweis. In den Listen steht weiter „Bezahlt“.
16. **Hinweistext je Flotte**, nicht je Rechnungssteller (eine GmbH könnte sonst nicht beide Arten haben). Ohne eigenen Text druckt das PDF den Standard „Bitte nicht überweisen. Der Betrag wird gesondert verrechnet.“ in der Rechnungssprache.
17. **Der Hinweis ersetzt den ganzen Zahlungsblock**, auch wenn eine IBAN hinterlegt ist. Er steht unter der Überschrift „Zahlungsinformationen“.
18. **Gutschriften** einer verrechneten Rechnung tragen denselben Hinweis (statt „wird erstattet oder verrechnet“). Ihr Status bleibt wie im Stamm „ausgestellt“, ohne Fälligkeit.
19. **Umstellen wirkt nur auf künftige Rechnungen.** Bereits ausgestellte Rechnungen behalten Status und Hinweis.
20. **Kreditlimit** sieht verrechnete Rechnungen nicht mehr als offen. Es begrenzt nur noch unabgerechnete und laufende Sitzungen (für Gehaltsverrechnung ist ohnehin keins vorgesehen).

### Baustein 3 (Zustellung der Mitgliederrechnungen)

21. **E-Mail an die Rechnungskontakte mit der Vorlage der Flottenrechnung** (`invoice.FleetInvoice` bzw. `invoice.FleetCreditNote`, Betreff etwa „Rechnung … für Flotte …“). Das PDF liegt bei und nennt den Mitarbeiter. Eine eigene Vorlage „Mitgliederrechnung an Rechnungskontakte“ gibt es nicht.
22. **Sprache:** Die E-Mail an die Rechnungskontakte ist in der Rechnungssprache der Flotte, das PDF bleibt in der Sprache des Fahrers.
23. **Der Fahrer bekommt keine E-Mail und keine Push-Nachricht.** Im Portal sieht er die Rechnung weiterhin (offen, ob das gewünscht ist).
24. **Zahlungserinnerungen** gehen weiter an den Fahrer. Bei Gehaltsverrechnung entstehen ohnehin keine.
25. **Keine Rechnungskontakte:** Die Rechnung entsteht trotzdem, der Versand meldet „keine Kontakte“, der Monatslauf protokolliert das. Ist der Monatslauf an, verlangt das Profil wie im Stamm mindestens einen Kontakt.

## Entwurf Ideas-Discussion (EVtivity)

> **Title:** Multiple invoice issuers per operator (seller, number range, delivery and external settlement per fleet)
>
> We run EVtivity for a group of companies. Each company is a fleet, and each must invoice its own employees under its own name, address and VAT ID, with its own readable number range. Today EVtivity has one seller (`company.*`) and one global counter (`INV-YYYYMM-NNNN`).
>
> Proposal, in four independent steps; nothing changes for a fleet without the new settings:
>
> 1. **Store the seller on the invoice at issue** (`invoices.seller`, like `bill_to`). Today the PDF reads the seller from the current settings, so changing the company address changes every old invoice PDF. Useful on its own (immutability after issue).
> 2. **Invoice issuers:** a table with seller details, optional bank details and a number format per document kind (prefix, optional two-digit year with yearly reset, start value, digits). A fleet may reference an issuer; its fleet and member invoices and their credit notes then use the issuer's seller block and number range. The counters live in `invoice_number_counters`, one row per issuer, kind and year, so numbering stays gap-free.
> 3. **Member invoice delivery:** per fleet, send member invoices and credit notes to the driver (default) or to the fleet's billing contacts (e.g. HR, which forwards them).
> 4. **External settlement:** per fleet, `payment` (default) or `external` with a note printed instead of the payment block (e.g. "Do not transfer, deducted from the next payroll"). Invoices are issued as paid at issue, so there are no overdue notices and the credit limit keeps working.
>
> We would be happy to contribute PRs, starting with step 1, if this direction fits your plans.

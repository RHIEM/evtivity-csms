# Mehrere Rechnungssteller mit eigenen Nummernkreisen

- **Status:** Zur Umsetzung freigegeben (04.11.2026); offene Punkte siehe unten. Ersetzt den Ladesitzungsbericht ([ladesitzungsbericht.md](ladesitzungsbericht.md))
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

| Feld      | Bedeutung                                            | Beispiel RS        | Beispiel RPP    |
| --------- | ---------------------------------------------------- | ------------------ | --------------- |
| Präfix    | optional, frei                                       | leer               | `RPP-`          |
| Jahr      | zweistelliges Jahr nach dem Präfix, getrennt mit `-` | nein               | ja              |
| Startwert | erste Nummer                                         | 10000              | 1               |
| Stellen   | Mindestlänge, mit Nullen aufgefüllt                  | 0                  | 4               |
| Ergebnis  |                                                      | `10000`, `10001` … | `RPP-26-0001` … |

- **Mit Jahr beginnt der Zähler jedes Jahr neu beim Startwert, ohne Jahr läuft er durch.**
- Maßgeblich ist das Jahr des Rechnungsdatums, wie heute in der Systemzeitzone. Bei „Rechnungsdatum = Monatsletzter“ trägt die Dezember-Rechnung also noch das alte Jahr.
- Die Zähler liegen in der bestehenden Tabelle `invoice_number_counters`, eine Zeile je Rechnungssteller, Art und Jahr (`name` z. B. `iss_…:invoice:2026` bzw. `iss_…:credit_note:all`). Die Zeile wird bei der ersten Vergabe angelegt (`INSERT … ON CONFLICT DO UPDATE … RETURNING`). Wie heute ist sie bis zum Commit gesperrt, die Vergabe bleibt also lückenlos.
- `invoices.invoice_number` bleibt global eindeutig. Beim Speichern warnt das CSMS, wenn sich zwei Kreise überschneiden können (gleiches Präfix, gleiche Jahreseinstellung und überlappende Bereiche). Hart sichert der `UNIQUE`-Index: Eine doppelte Nummer lässt die Ausstellung scheitern, der Monatslauf protokolliert das wie andere Fehler (`fleet_member_invoice_run_failures`).
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
- **Logo und Fußzeile je Rechnungssteller?** Im Stamm sind sie global (`pdf.logo`, `pdf.footer`). Falls jede GmbH ihr eigenes Logo bzw. ihre eigene Fußzeile (Geschäftsführer, Registergericht) braucht, kommen zwei Felder an den Rechnungssteller.
- **Portal:** Soll der Mitarbeiter seine Gehaltsverrechnungs-Rechnungen im Portal sehen, oder nur die Stelle der GmbH per E-Mail?
- **Nummernkreise:** endgültige Werte je GmbH.

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

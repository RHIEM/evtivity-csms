# Ladesitzungsbericht statt Rechnung (externe Fakturierung)

- **Status:** Freigegeben (03.11.2026), umgesetzt auf `feature/session-report`; noch nicht in `rhiem/main` und nicht deployt
- **Zweig:** `feature/session-report`, Basis `rhiem/main` (`aee70a30`) statt des Upstream-Tags (Entscheidung des Nutzers 03.11.2026): Der Bericht nutzt die Eichrecht-Prüfzeile (`invoice-evidence.ts`) und die Token-Bezeichnung (`driver_tokens.label`), die es nur im Fork gibt. Für einen PR an EVtivity muss der Fork-Anteil herausgelöst werden.
- **Upstream:** zuerst als Ideas-Discussion bei EVtivity vorschlagen; Umsetzung im Fork nur, wenn das nicht bis zur ersten echten Abrechnung (frühestens 01.12.2026) warten kann
- **Termin:** Die erste echte Abrechnung ist die für November, frühestens am 01.12.2026 (seit v0.1.48 sind nur abgeschlossene Monate abrechenbar)

## Ausgangslage

RHIEM fakturiert das Laden der Mitarbeiter im eigenen ERP und nicht über EVtivity. EVtivity hat dafür nur die Kontoabrechnung mit Rechnung. Der Fall „Invoice To: Each Driver“ (`fleets.account_invoice_recipient = member`) erzeugt je Fahrer und Monat eine Mitgliederrechnung (`invoices.member_billed`) und tut Folgendes:

- Er vergibt eine Nummer aus dem Nummernkreis und setzt Fälligkeit, Zahlungsinformationen und GiroCode.
- Er schickt die Rechnung als PDF per E-Mail an den Fahrer (`invoice.MemberInvoice`, `dispatchMemberInvoiceNotice` in `fleet-invoice-notice.ts`).
- Er zeigt die Rechnung im Portal unter Rechnungen, mit PDF-Download über `/portal/invoices/:id/pdf`.
- Er mahnt nach Fälligkeit (`invoice.MemberOverdue`) und verschickt Gutschriften (`invoice.MemberCreditNote`).

Die Rechnung bestimmt außerdem den Abrechnungsstand. Beendete Kontositzungen ohne Rechnung und Sitzungen auf unbezahlten Rechnungen zählen zur offenen Summe für das Kreditlimit (`fleet-credit-limit.ts`, `unbilledCents` und `invoicedCents`). Ohne Rechnung würde diese Summe endlos wachsen.

Eine Rechnung aus EVtivity und eine zweite aus dem ERP für dieselbe Leistung sollen nicht entstehen. Ein Dokument mit Nummer, Leistungsempfänger, Entgelt und ausgewiesener USt kann unabhängig von seiner Überschrift als Rechnung gelten (Risiko des doppelten Steuerausweises nach § 14c UStG).

## Abweichungen in der Umsetzung

- **Schlüssel** heißt `invoice.externalInvoicing` (wie `invoice.epcQrEnabled`) statt `billing.externalInvoicing`. Er wird bei jedem Zugriff gelesen (kein Cache), ein Lesefehler wird nicht als „aus“ gewertet, sondern weitergereicht.
- **Hinweistext** steht fest in den Texten des Berichts (sechs Sprachen) und ist nicht unter Einstellungen → Inhalt pflegbar. Der Messnachweis-Text dort ist HTML für das Portal, ein PDF bräuchte einen eigenen Klartext-Inhalt.
- **Kennung** des Berichts ist die interne Rechnungs-ID (`inv_…`), nicht `LSB-<JJJJ-MM>-<Fahrer-ID>`. So hat ein Ersatzbericht nach einer Korrektur eine eigene Kennung.
- **Eigenes Ereignis** `invoice.MemberSessionReport` mit eigenen Vorlagen (E-Mail, Push, Betreff; sechs Sprachen), Pflichtereignis wie `invoice.MemberInvoice`. Die Standardvorlage von `invoice.MemberInvoice` spricht von „Rechnung“, „Fälliger Betrag“ und „Bitte begleiche …“; das per Vorlage umzuschreiben wäre fehleranfällig.
- **Gutschrift erneut senden** antwortet im externen Modus mit 409 `INVOICE_IS_CREDIT_NOTE` (eigene Fehlercodes kommen bei EVtivity aus einer externen Liste).
- **Mahnungen** entfallen im externen Modus ganz, auch für Mitgliederrechnungen, die vor dem Umschalten ausgestellt wurden.
- **Portal:** Neben Rechnungsliste, Detail und PDF zeigt auch die Sitzungsansicht (`SessionDetail.tsx`, über `withAccountBilling`) im externen Modus den Bericht statt der Rechnungsnummer, und „bezahlt“ erscheint dort als „in Rechnung gestellt“. Gutschriften und gutgeschriebene Mitgliederrechnungen sind für den Fahrer ausgeblendet.
- **CSV:** Spaltennamen englisch und maschinenlesbar (`period;driver_id;…`), damit eine spätere ERP-Zuordnung stabil bleibt. Das Format ist wie geplant Semikolon, Dezimalkomma, UTF-8 mit BOM. Erzeugt mit `csvEscape` aus `@evtivity/lib` (statt `buildCsv`, das Kommas trennt).
- **Warnung bei Flottenrechnungen** im CSMS gibt es nicht. Stattdessen sagt der Hilfetext der Einstellung, dass Flottenrechnungen nicht betroffen sind.
- **Datei** heißt `session-report.service.ts` (PDF und CSV), dazu `session-report-labels.ts`.

## Entscheidung

1. **Die Rechnung bleibt in EVtivity, aber nur intern.** Der Monatslauf und „Invoice All Members“ erzeugen die Mitgliederrechnung wie bisher (Nummernkreis, Positionen, Audit, Gutschriften). Sie verlässt EVtivity nie: keine E-Mail mit Rechnungs-PDF, kein Rechnungs-PDF im Portal, keine Mahnung.
2. **Der Mitarbeiter bekommt stattdessen einen Ladesitzungsbericht.** Der Bericht wird aus derselben Mitgliederrechnung erzeugt (`InvoiceDetail` mit Positionen). Bericht, interne Rechnung und CSV für das ERP stimmen damit auf den Cent überein.
3. **Die interne Rechnung gilt bei Erstellung als „extern abgerechnet“.** Sie wird sofort auf `paid` gesetzt (`paidAt` = Ausstellung, Referenz „Externe Abrechnung (ERP)“). Damit gibt es keine Mahnungen, und das Kreditlimit funktioniert weiter. Es begrenzt dann, was im laufenden und im noch nicht abgerechneten Monat anfällt.
4. **Schalter systemweit** über die Systemeinstellung `billing.externalInvoicing` (bool, Standard `false`). Ohne Migration bleibt der Abstand zum Upstream klein. Ist der Schalter aus, verhält sich alles wie bei Upstream.

Für den Upstream-Vorschlag wäre ein Schalter je Flotte natürlicher (`fleets.account_invoice_document = invoice | session_report`). Im Fork nehmen wir den systemweiten Schalter, weil wir keine Flotte mit echter Rechnung haben.

## Inhalt des Berichts (PDF)

Neue Datei `packages/services/src/session-report.service.ts`. Sie nutzt `pdf-branding.ts` (Logo, Farben, Schriften inkl. CJK) und lässt `invoice-pdf.service.ts` unberührt.

- **Titel:** „Ladesitzungsbericht“ mit Zeitraum (Monat) und Erstellungsdatum.
- **Kopf:** Betreiber (Name, Anschrift aus den Unternehmenseinstellungen), Mitarbeiter (Name), Flotte. Es gibt kein Anschriftsfeld für Fensterumschläge.
- **Hinweis direkt unter dem Titel:** „Dieser Bericht ist keine Rechnung. Er weist die Ladevorgänge des Zeitraums nach. Die Abrechnung erfolgt gesondert.“ Der Text ist je Sprache unter Einstellungen → Inhalt pflegbar, nach dem Muster des Messnachweis-Textes.
- **Tabelle, eine Zeile je Sitzung:** Beginn, Ende, Standort/Station, Karte („Bezeichnung (UID)“, sonst die UID; das Portal zeigt die UID dem Fahrer ebenfalls unmaskiert), Energie (kWh), Betrag netto, Betrag brutto. Gebühren (Zeit, Standzeit, Sitzungsgebühr) werden in die Sitzungszeile eingerechnet. Eine Position ohne Sitzung (etwa eine Reservierungsgebühr) bekommt eine eigene Zeile mit ihrer Beschreibung. Zeiten in der Systemzeitzone, mit Hinweis unter der Tabelle.
- **Eichrecht-Prüfzeile** je Sitzung wie bisher auf der Rechnung (aus `efa35ae7`: Sitzungs-ID, Datensatz, Zähler, signierter Beginn und Ende) und der Hinweis auf den Messnachweis im Portal.
- **Summen:** Anzahl Sitzungen, Energie, Summe netto, Summe brutto.
- **Bewusst weggelassen:** Rechnungsnummer, Rechnungsdatum, Fälligkeit, Zahlungsinformationen, GiroCode, eine eigene Zeile mit dem USt-Betrag und Wörter wie „Rechnung“, „Betrag fällig“ oder „zahlbar“.
- **Kennung:** Bericht `LSB-<JJJJ-MM>-<Fahrer-ID>`, keine Nummer aus dem Rechnungskreis.
- **Dateiname:** `Ladesitzungsbericht-<JJJJ-MM>.pdf`.

Netto und Brutto kommen aus den Rechnungspositionen (`invoice_line_items.total_cents`, `tax_cents`, `tax_rate`). Gerechnet wird wie bei der Rechnung (Steuerbasis `company.taxBasis`), damit die Summen exakt übereinstimmen.

## CSV für das ERP

Konkrete Anforderungen gibt es noch nicht. Die erste Fassung ist so geschnitten, dass sie später leicht anzupassen ist.

- **Eine Datei je Flotte und Monat** mit allen Mitgliedern, als Download im CSMS auf dem Abrechnungs-Tab der Flotte. Optional gibt es sie auch je Mitarbeiter.
- **Eine Zeile je Sitzung:** Zeitraum, Fahrer-ID, Name, E-Mail, Token (ID und Bezeichnung), Sitzungs-ID, Beginn, Ende (ISO 8601 mit Zeitzone `system.timezone`), Standort, Station, Energie (kWh), Netto, Steuersatz, Steuer, Brutto, Währung, interne Rechnungsnummer (nur für den Abgleich, steht nicht im PDF).
- **Format:** UTF-8 mit BOM, Trennzeichen `;`, Dezimalkomma. Damit öffnet sich die Datei in einem deutschen Excel ohne Umwege. Beträge stehen in Euro mit zwei Nachkommastellen. Vorhandenen `csv-builder.ts` verwenden.

## Änderungen im Code

- **Versand** (`fleet-invoice-notice.ts`, `sendMemberInvoiceEmail`): Im externen Modus geht statt `generateInvoicePdf` der Bericht als PDF über das eigene Ereignis `invoice.MemberSessionReport` (siehe Abweichungen).
- **Als bezahlt ausstellen** (`fleet-invoice.service.ts`, `issueAccountInvoice`): Im externen Modus wird die Mitgliederrechnung direkt mit Status `paid` und Referenz „Invoiced outside EVtivity“ eingefügt (`insertInvoiceInTransaction` nimmt dafür `paymentReference`). Das Audit `invoice_generated` hält den Status fest.
- **Mahnung und Gutschrift:** Gehen im externen Modus nicht an den Fahrer (`sendMemberInvoiceOverdueNotices`, `invoice.MemberCreditNote`). Eine Korrektur läuft intern über Gutschrift und neue Rechnung. Danach bekommt der Fahrer einen neuen Bericht mit dem Vermerk „ersetzt den Bericht vom …“.
- **Portal:** `/portal/invoices` und `/portal/invoices/:id/pdf` liefern im externen Modus den Bericht. Die Seiten `Invoices.tsx` und `InvoiceDetail.tsx` heißen dann „Ladesitzungsberichte“ und zeigen keine Rechnungsnummer, keine Fälligkeit und keinen Zahlstatus. Prüfen, ob `SessionDetail.tsx` und `MonthlyStatement.tsx` irgendwo die Rechnung nennen.
- **CSMS:** Die interne Rechnung bleibt sichtbar (Rechnungs-PDF nur intern). An der Mitgliederrechnung gibt es „Ladesitzungsbericht“ (`GET /v1/invoices/:id/session-report`), bei den Mitgliederrechnungen auf dem Abrechnungs-Tab der Flotte „CSV für ERP (Ladesitzungen)“ (`GET /v1/fleets/:id/session-report.csv?period=JJJJ-MM`). Die Einstellung steht als eigene Karte „Externe Fakturierung“ unter Einstellungen → Unternehmen, unter den Zahlungsinformationen.
- **Übersetzungen:** alle sechs Sprachen von CSMS und Portal (die i18n-Tests verlangen gleiche Schlüssel).
- **Tests:** PDF-Inhalt (keine Rechnungsmerkmale, Summen gleich der Rechnung, Ersatzvermerk), CSV-Format und Abfrage, Versand mit Bericht statt Rechnung, Gutschrift bleibt intern, sofort `paid`, keine Mahnung, Portal liefert Bericht statt Rechnung, Sitzungsansicht ohne Rechnungsnummer, Einstellung und Routen. Die Kreditlimit-Summe ist nicht eigens getestet: sie zählt bezahlte Rechnungen schon bei Upstream nicht.

## Bis zur Bereitstellung

- `fleets.auto_invoice` (Monatslauf) bleibt aus. Auch „Invoice All Members“ und das manuelle Erzeugen einer Mitgliederrechnung schicken sofort die Rechnung per E-Mail an den Fahrer (`sendAccountInvoiceEmail` mit `once`). Vor der Bereitstellung des Berichts daher keine Mitgliederrechnung erzeugen.

## Offene Fragen

- Steuerberatung kurz bestätigen lassen: interne Rechnung ohne Übermittlung an den Mitarbeiter, dazu ein Bericht mit Netto und Brutto, aber ohne USt-Zeile und Rechnungsmerkmale.
- Soll das Kreditlimit erst nach Zahlung im ERP freigeben? Dann würde die Rechnung `issued` bleiben, und ein Betreiber müsste sie von Hand oder per Import auf bezahlt setzen. Umgesetzt ist der Vorschlag: sofort `paid`.
- Nach der Bereitstellung in der Produktion: Schalter einschalten, eine Mitgliederrechnung erzeugen und prüfen (Status `paid`, Referenz „Invoiced outside EVtivity“, E-Mail mit Bericht, Portal zeigt nur den Bericht, CSV öffnet sich in Excel).
- CSV-Spalten und Format mit dem ERP abstimmen, sobald es eine Anforderung gibt.
- Flottenrechnungen (`account_invoice_recipient = fleet`) erst später einbeziehen.

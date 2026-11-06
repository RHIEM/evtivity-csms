# Rechnungen im Briefbogen der GmbH

- **Status:** Baustein 1 und 2 umgesetzt (05.11.2026), in `rhiem/main` gemergt (`ab0a5781`). Baustein 1 liegt upstreamfähig auf `feature/pdf-letterhead` (ab `v0.1.49`). Entscheidungen des Nutzers am 05.11.2026: Briefbögen werden versioniert; Folgeseiten ohne Briefbogen, mit Kopfzeile; Drucken im CSMS öffnet bei Briefbogen das PDF; Vorlage sind die Ausgangsrechnungen aus dem ERP; Upload bleibt bei PNG und SVG (kein PDF, keine neue Abhängigkeit).
- **Anlass:** Die Rechnungen der Rechnungssteller sollen wie die Briefbögen der jeweiligen GmbH aussehen. Vorlage war zuerst der Scan `Briefbögen.pdf`, dann die Ausgangsrechnungen der fünf GmbHs aus dem ERP. Daraus ist `Briefbögen-Vektor.pdf` entstanden (nur der Briefbogen, Rechnungsinhalt entfernt) und daraus je GmbH ein PNG mit 300 dpi (`Briefbögen-PNG/`). Alle Dateien liegen außerhalb des Repos im Projektordner.
- **Basis:** `rhiem/main` mit den Rechnungsstellern ([rechnungssteller.md](rechnungssteller.md)), Stand `ac8f1561`, auf Tag `v0.1.49`.
- **Leitlinie:** Nah am Upstream bleiben. Wir bauen keine eigene Rechnungsstellung, das Layout wird nicht nachgebaut, und es kommt keine neue Abhängigkeit dazu. Der allgemeine Teil soll als Vorschlag an EVtivity taugen. Im Fork bleibt nur die Übersteuerung je Rechnungssteller, nach dem Muster von `rhiem_0009`.

## Befund: die Briefbögen

Alle fünf Briefbögen sind gleich aufgebaut, nach DIN 5008 Form B:

| Element       | Lage                                               | Inhalt                                                                                          |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Logo          | oben rechts                                        | Bildmarke „R“, je nach GmbH mit Schriftzug (Branding Solutions, Intermedia) oder nur „RHIEM“    |
| Absenderzeile | über dem Anschriftfeld, etwa 47 mm von oben, klein | z. B. „RHIEM Intermedia GmbH · Gildeweg 10 · D-46562 Voerde“                                    |
| Anschriftfeld | links, Eckmarken unten bei etwa 88 mm              | leer; für Fensterumschläge (DL, Fenster links)                                                  |
| Infospalte    | rechts, bis etwa 100 mm von oben                   | Firma, alle Geschäftsführer, Anschrift, Telefon, Fax, E-Mail, Web                               |
| Farbmarke     | rechter Rand, etwa auf Höhe der Falzmarke          | Firmenfarbe: Services cyan, Intermedia magenta, Packaging & Print gelb, Branding Solutions grau |
| Falzmarke     | linker Rand                                        | Strich                                                                                          |
| Fußzeile      | ab etwa 255 mm, zwei bis drei Spalten              | Bank(en) mit IBAN und SWIFT/BIC, USt-IdNr., HRB und Amtsgericht                                 |

Die Lagen sind aus dem Scan geschätzt. Der Scanner hat die Seite leicht verkleinert (576 × 818 pt statt 595 × 842 pt).

| GmbH                     | Sitz    | Besonderheit                                                              |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| RHIEM Branding Solutions | Bocholt | zwei Banken, Verbandslogos (f:mp, PSI) unten links, Gerichtsstand Bocholt |
| CAPREO                   | Voerde  | eigenes Design (Weinmarke), roter Strich oben rechts und in der Fußzeile  |
| RHIEM Intermedia         | Voerde  | drei Geschäftsführer                                                      |
| RHIEM Packaging & Print  | Voerde  | vier Geschäftsführer                                                      |
| RHIEM Services           | Voerde  | drei Geschäftsführer                                                      |

Jede GmbH hat ein eigenes Bankkonto. Als Rechnungssteller vorgesehen sind bisher Intermedia, Services und Packaging & Print ([rechnungssteller.md](rechnungssteller.md)).

## Stand im Fork

| Element                                    | Heute                                                                                       | Abweichung vom Briefbogen                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Name, Anschrift, USt-ID, Register, Kontakt | am Rechnungssteller, bei Ausstellung als `invoices.seller` gespeichert, Block „Von“         | mitten auf der Seite statt in der Infospalte     |
| Logo                                       | `pdf.logo` bzw. `invoice_issuers.pdf_logo`, oben links, höchstens 160 × 60 pt, live gelesen | links statt rechts                               |
| Fußzeile                                   | `pdf.footer` bzw. `invoice_issuers.pdf_footer`, zentriert, höchstens 5 Zeilen, live gelesen | keine Spalten                                    |
| Geschäftsführer                            | fehlt                                                                                       | Pflichtangabe auf Geschäftsbriefen (§ 35a GmbHG) |
| Fax, Web                                   | fehlen                                                                                      |                                                  |
| Bankverbindung je GmbH                     | fehlt (Annahme 8 in rechnungssteller.md: Bank des Unternehmens)                             | jede GmbH hat ein eigenes Konto                  |
| Absenderzeile, Anschrift im Fenster        | fehlen; „Rechnung an“ steht unter einer Trennlinie bei etwa 45 mm                           |                                                  |
| Farbmarke, Falzmarke                       | fehlen                                                                                      |                                                  |
| Seitenzahlen                               | fehlen                                                                                      |                                                  |
| Druckansicht im CSMS                       | eigenes HTML-Layout (`InvoiceDetail.tsx`), Logo über `GET /v1/invoices/print-logo`          | folgt nicht dem PDF                              |

Das Rechnungs-PDF entsteht in `services/src/invoice-pdf.service.ts` (pdfkit, A4, Rand 50 pt) bei jedem Abruf neu. Logo und Fußzeile lädt `loadPdfBranding(issuerId)` in `services/src/pdf-branding.ts`. SVG-Logos rastert `@resvg/resvg-js`.

## Verworfene Wege

- **Layout nachbauen:** Dafür bräuchten wir neue Felder (Geschäftsführer, Fax, Web, Bank, Farbe, Spalten der Fußzeile) und einen eigenen DIN-5008-Modus in `invoice-pdf.service.ts`. Das wäre viel Code in einer Datei, die upstream häufig ändert. Das Ergebnis träfe das Corporate Design trotzdem nicht, etwa bei Schrift, Logo-Lage und Verbandslogos.
- **HTML-Vorlagen mit Headless-Browser:** Das wäre eine eigene PDF-Erzeugung neben der von EVtivity und damit genau die Drift, die wir vermeiden wollen.
- **Briefbogen nachträglich außerhalb von EVtivity aufbringen:** EVtivity versendet die Rechnungen selbst und zeigt sie im Portal. Ein nachgelagerter Schritt erreicht diese Wege nicht.

## Lösung: Briefbogen als Hintergrund

Der Briefbogen wird als Bild hinterlegt und auf die erste Seite gelegt. EVtivity schreibt nur noch den Inhalt in die freien Flächen. Logo, Absenderzeile, Infospalte, Farbmarke und Fußzeile kommen unverändert aus dem Original. Damit stehen auch die Geschäftsführer, die USt-IdNr., HRB, Amtsgericht und Bank auf der Rechnung, ohne neue Datenfelder.

Ohne Briefbogen bleibt alles wie im Stamm.

### Baustein 1: Briefbogen für das Unternehmen (upstreamfähig)

#### Datenmodell

Neue Tabelle `pdf_letterheads` (ID-Präfix `lhd`). Eine Zeile ist eine **Version** und wird nach dem Anlegen nie geändert:

| Spalte                              | Typ            | Zweck                                                                              |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `id`                                | `text` PK      |                                                                                    |
| `name`                              | `varchar(100)` | Bezeichnung für die Liste, z. B. „Briefbogen 2026“                                 |
| `image`                             | `text`         | PNG- oder SVG-Data-URI (wie `pdf.logo`)                                            |
| `image_sha256`                      | `char(64)`     | Prüfsumme des Bildes, für Cache und Nachweis                                       |
| `address_left_mm`, `address_top_mm` | `numeric(5,1)` | Beginn der Empfängeranschrift; Standard 25,0 / 62,7 (Form B, unter der Zusatzzone) |
| `content_top_mm`                    | `numeric(5,1)` | Beginn des Inhalts auf Seite 1 unter der Infospalte; Standard 105,0                |
| `content_bottom_mm`                 | `numeric(5,1)` | Ende des Inhalts auf jeder Seite über der Fußzeile; Standard 250,0                 |
| `margin_left_mm`, `margin_right_mm` | `numeric(5,1)` | Satzspiegel links und rechts; Standard 25,0 / 20,0                                 |
| `created_at`, `created_by`          |                | wer die Version angelegt hat                                                       |

- Neue Einstellung `pdf.letterhead`: ID der gültigen Version oder `''` für keinen Briefbogen.
- Neue Spalte `invoices.letterhead_id` (nullable, `ON DELETE RESTRICT`). Sie wird **bei Ausstellung** gesetzt, mit der Version, die in diesem Moment gilt, und danach nie geändert, wie `bill_to` und `seller`.
- Die Layoutwerte gehören zur Version, weil sie das Ergebnis genauso bestimmen wie das Bild. Wer einen Rand ändert, legt eine neue Version an.
- Die API kennt kein Ändern und kein Löschen einer Version. `ON DELETE RESTRICT` schützt Versionen, auf die Rechnungen verweisen.

#### Versionierung und GoBD

- Eine Rechnung zeigt immer den Briefbogen, unter dem sie ausgestellt wurde. Kommt ein neuer Geschäftsführer dazu oder ändert sich die Bank, wird eine neue Version angelegt und als gültig gesetzt. Alte Rechnungen behalten beim erneuten Abruf ihren alten Briefbogen.
- Bereits ausgestellte Rechnungen ohne `letterhead_id` behalten das heutige Layout. Es gibt keinen Nachtrag.
- Die Unveränderlichkeit macht auch das Rastern billig: Das Bild einer Version wird einmal je Prozess gerastert und unter `image_sha256` zwischengespeichert.
- Logo und Fußzeile des Stamms werden weiterhin live gelesen. Bei Rechnungen mit Briefbogen werden sie nicht gezeichnet, dort ist die Lücke also geschlossen.

#### Dateiformat

- **SVG** (bevorzugt), Text in Pfade umgewandelt, sonst fehlen im Container die Schriften. Gerastert mit `@resvg/resvg-js` (schon vorhanden) auf 2480 px Breite (300 dpi).
- **PNG** mit mindestens 2480 × 3508 px (300 dpi).
- Seitenverhältnis A4 hochkant (210 : 297) mit höchstens 1 % Abweichung; sonst lehnt der Upload ab. Höchstgröße 3 MB dekodiert (das Logo hat 512 KB).
- **PDF wird nicht angenommen:** pdfkit kann keine PDF-Seiten einbetten, dafür bräuchte es eine neue Bibliothek (`pdf-lib`). Die Druckdaten werden einmalig von Hand umgewandelt, z. B. `pdftocairo -svg briefbogen.pdf briefbogen.svg` und Text in Pfade über Inkscape. Das Ergebnis wird geprüft.
- Das SVG wird wie das Logo bereinigt (`sanitizeSvg`).

#### Aufbau des PDFs mit Briefbogen

Seite 1:

1. Briefbogen als Hintergrund über die ganze Seite (0, 0, 595,28 × 841,89 pt), vor allem anderen.
2. **Kein** Logo, **kein** Block „Von“, **keine** Fußzeile aus `pdf.footer`. Der Verkäufer bleibt als `invoices.seller` gespeichert, auch für spätere E-Rechnungen.
3. **Empfängeranschrift** ab `address_left_mm` / `address_top_mm`, höchstens 6 Zeilen (Anschriftzone nach Form B). Darin stehen nur Name und Anschrift aus `bill_to`. Personalnummer und USt-ID des Käufers kommen in den Infoblock.
4. **Betreff** bei `content_top_mm`: „Rechnung RI-2600001“ bzw. „Gutschrift …“, fett.
5. **Infoblock** darunter, zweispaltig: Rechnungsdatum, Leistungszeitraum, Fälligkeit, Personalnr., USt-ID des Käufers, gegebenenfalls „Ersetzt …“. Das sind dieselben Felder wie heute, nur an anderer Stelle.
6. Danach wie heute: Positionen, Prüfzeilen (Eichrecht), Steuerübersicht, Summen, Zahlungsblock bzw. Verrechnungshinweis. Rand links und rechts aus der Version, Seitenende bei `content_bottom_mm`.

Folgeseiten (Entscheidung 05.11.2026: leer):

- Kein Hintergrund. Satzspiegel oben und unten 20 mm, links und rechts wie Seite 1.
- Oben eine Kopfzeile in 8 pt: „RHIEM Intermedia GmbH · Rechnung RI-2600001 · Seite 2 von 3“ (Name aus `invoices.seller`). So bleibt eine einzelne Folgeseite zuordenbar.
- Ab zwei Seiten steht auf Seite 1 über `content_bottom_mm` rechts „Seite 1 von 3“.

Das gilt für Mitglieder- und Fahrerrechnungen, Flottenrechnungen und Gutschriften, also für alles aus `invoice-pdf.service.ts`. Berichte (`report-generators/`) behalten das heutige Branding.

#### Code

- Neues Modul `services/src/invoice-letterhead.ts`: Version laden, rastern und zwischenspeichern, Layout in pt umrechnen, Hintergrund und Kopfzeile der Folgeseiten zeichnen.
- In `invoice-pdf.service.ts` nur Weichen: Die festen Konstanten (`MARGIN`, `PAGE_BOTTOM`, Lage des Meta-Blocks) kommen aus einem Layoutobjekt. Der Standard entspricht genau den heutigen Werten, dazu Bedingungen für Logo, „Von“ und Fußzeile. Ziel ist, dass ein Upstream-Merge in dieser Datei höchstens kleine Konflikte bringt.
- Ausstellung: `insertInvoiceInTransaction` setzt `letterhead_id`. Woher der Wert kommt, entscheidet eine Funktion `resolveLetterheadId(issuerId)`; im Stamm ist es einfach `pdf.letterhead`.

#### API und CSMS

- `GET /v1/pdf-letterheads`: Versionen ohne Bild (ID, Name, Prüfsumme, Layout, angelegt von und am, gültig ja/nein, Zahl der Rechnungen).
- `POST /v1/pdf-letterheads`: neue Version anlegen (Bild und Layout). Mit `activate: true` wird sie sofort gültig.
- `GET /v1/pdf-letterheads/:id/image`: Bild für Vorschau und Druckansicht.
- `POST /v1/pdf-letterheads/preview`: Probe-PDF mit Beispieldaten für ein noch nicht gespeichertes Bild mit Layout. So sitzen Anschrift und Ränder, bevor eine Version entsteht.
- `PUT /v1/settings/pdf-letterhead`: gültige Version setzen oder `null` (kein Briefbogen).
- Berechtigung `settings.system:write` wie die übrigen PDF-Einstellungen, alles im Audit (ohne Bild).
- CSMS: Einstellungen → PDF, neben Logo und Fußzeile ein Abschnitt „Briefbogen“: gültige Version mit Vorschau, „Neue Version“ (Upload, Layoutfelder in mm, „Probe-PDF“), Liste der Versionen.

### Baustein 2: Briefbogen je Rechnungssteller (Fork)

- Neue Spalte `invoice_issuers.letterhead_id` (nullable, `ON DELETE RESTRICT`). `NULL` bedeutet: Briefbogen des Unternehmens, falls einer gilt. Das ist dieselbe Logik wie `pdf_logo`.
- Neue Spalte `pdf_letterheads.issuer_id` (nullable). Damit hat jeder Rechnungssteller eine eigene Versionsliste. Eine Version gehört genau einem Rechnungssteller oder dem Unternehmen.
- `resolveLetterheadId(issuerId)`: der Briefbogen des Rechnungsstellers, sonst `pdf.letterhead`.
- API: `GET/POST /v1/invoice-issuers/:id/letterheads`, `PUT /v1/invoice-issuers/:id/letterhead`. Die Vorschau nutzt die Route aus Baustein 1, mit dem Verkäufer des Stellers als Beispiel.
- CSMS: im Tab „Rechnungssteller“ im Formular ein Abschnitt „Briefbogen“ wie in Baustein 1. Ist ein Briefbogen gültig, weist das Formular darauf hin, dass Logo und Fußzeile des Stellers auf Rechnungen dann nicht gezeichnet werden.
- Eine Gutschrift bekommt den Briefbogen, der bei ihrer Ausstellung für den Rechnungssteller der Rechnung gilt. Den Briefbogen der Rechnung erbt sie nicht, denn sie ist ein neues Geschäftsschreiben mit dem aktuellen Stand (z. B. Geschäftsführer). `seller` und `issuer_id` erbt sie weiterhin.

### Druckansicht im CSMS

Die HTML-Druckansicht (`InvoiceDetail.tsx`) hat ein eigenes Layout. Vorschlag: Bei Rechnungen mit `letterhead_id` öffnet „Drucken“ das PDF, statt die HTML-Ansicht nachzuziehen. Damit gibt es ein Layout statt zwei. Bei Rechnungen ohne Briefbogen bleibt die Druckansicht wie heute.

## Zusammenspiel mit den Rechnungsstellern

- **Annahme 12** (Logo und Fußzeile global) ist mit `rhiem_0009` schon überholt. Der Briefbogen ersetzt beides auf Rechnungen.
- **Annahme 8** (keine Bank je Rechnungssteller): Der Briefbogen zeigt die Bank der GmbH. Der Zahlungsblock nutzt dagegen die Bank des Unternehmens. Bei Gehaltsverrechnung entfällt der Zahlungsblock, das passt also. Stellt eine GmbH einmal mit Überweisung aus, stehen zwei verschiedene IBANs auf der Rechnung. Dann braucht der Rechnungssteller eine eigene Bankverbindung (eigener kleiner Baustein, nicht Teil dieses Konzepts).
- **Abgleich Briefbogen und Verkäuferdaten:** Name und Anschrift des Rechnungsstellers müssen zum Briefbogen passen. Die Probe-PDF zeigt beides nebeneinander (Verkäufer als Text unter der Vorschau). Eine maschinelle Prüfung gibt es nicht.

## Übergang bis zur Umsetzung

Die Pflichtangaben nach § 35a GmbHG (Rechtsform, Sitz, Registergericht, HR-Nummer, alle Geschäftsführer) lassen sich schon jetzt über die Fußzeile je Rechnungssteller (`rhiem_0009`, bis 5 Zeilen) eintragen, dazu das GmbH-Logo. Vorschlag für die Einrichtung beim Deployment der Rechnungssteller, z. B. für Intermedia:

```text
<Firma> · <Anschrift> · Sitz <Ort> · HRB <Nummer> · Amtsgericht <Ort>
Geschäftsführer: <alle Geschäftsführer>
```

Bank und USt-IdNr. stehen schon im Zahlungsblock bzw. im Block „Von“. Den Sitz bestätigt die Buchhaltung; auf dem Briefbogen steht er nicht ausdrücklich.

## Upstream

Baustein 1 ist allgemein: Briefpapier für Rechnungen ist in Fakturierungsprogrammen üblich, und die Versionierung schließt dieselbe GoBD-Lücke wie das Speichern des Verkäufers. Vorschlag als Ideas-Discussion, zusammen mit oder nach der Discussion zu den Rechnungsstellern. Baustein 2 setzt die Rechnungssteller voraus und bleibt bis dahin im Fork.

Entwurf:

> **Letterhead (stationery) background for invoice PDFs, versioned**
>
> Many operators send invoices on their printed letterhead (logo, legal details, bank, managing directors). Rebuilding that layout from settings fields never matches the corporate design. Proposal:
>
> 1. **Letterhead versions** (`pdf_letterheads`): an A4 SVG or PNG plus the free areas (recipient address position, content top and bottom, side margins). A version is never changed; a new upload is a new version, `pdf.letterhead` names the current one.
> 2. **Kept on the invoice at issue** (`invoices.letterhead_id`, like `bill_to`): a re-rendered PDF shows the letterhead it was issued under, so a new managing director or bank does not change old invoices.
> 3. **Rendering:** with a letterhead, page 1 draws it as background and leaves out the logo, the "From" block and the footer; the recipient address sits in the window position (DIN 5008 / window envelopes), followed by title, details and the existing line items. Following pages stay plain with a small header "Company · Invoice no. · Page n of m". Without a letterhead nothing changes.
>
> Uses the existing resvg rasterizer, no new dependency. Reports keep the current branding.

## Aufwand und Prüfung

- Baustein 1: eine Migration, `invoice-letterhead.ts` (etwa 150 Zeilen), Weichen in `invoice-pdf.service.ts`, Routen, Abschnitt im CSMS, Übersetzungen (alle Sprachen der Rechnung für „Seite n von m“). Etwa 1,5 Tage.
- Baustein 2: eine Migration, Routen, Abschnitt im Formular des Rechnungsstellers. Etwa 0,5 Tage.
- Tests: Upload-Prüfung (Format, Seitenverhältnis, Größe, SVG-Bereinigung), Versionierung (kein Ändern, `RESTRICT`), Auswahl des Briefbogens (Steller, Unternehmen, keiner), `letterhead_id` bei Ausstellung und bei Gutschriften, PDF-Inhalt (Text an der erwarteten Stelle, kein „Von“, Kopfzeile ab Seite 2), unveränderte PDFs ohne Briefbogen.
- Vor dem PR die volle Prüfung: typecheck, lint, format:check, alle Tests, check:migrations, check:openapi.
- Abnahme an echten Daten: Probe-PDF je GmbH ausdrucken und in einen DL-Fensterumschlag stecken; eine mehrseitige Flottenrechnung prüfen.

## Umsetzung Baustein 1 (05.11.2026)

Zweig `feature/pdf-letterhead` ab `v0.1.49`, Migration `rhiem_0013_pdf_letterheads`.

- **Datenbank:** Tabelle `pdf_letterheads` (ID-Präfix `lhd`) mit `name`, `image`, `image_sha256`, den sechs Layoutwerten in mm (`numeric(5,1)`) und `created_by_user_id`; `invoices.letterhead_id` (`ON DELETE RESTRICT`); Einstellung `pdf.letterhead`. `currentPdfLetterheadId(tx)` liest die gültige Version in der Transaktion der Ausstellung (Rechnung und Gutschrift).
- **PDF:** `services/src/invoice-letterhead.ts` lädt und rastert die Version (Zwischenspeicher je SHA-256) und prüft, dass pdfkit das Bild lesen kann. In `invoice-pdf.service.ts` läuft der Satzspiegel über ein `PageFrame`; ohne Briefbogen sind die Werte genau die bisherigen. Mit Briefbogen: Hintergrund auf Seite 1, Anschrift im Fenster, Titel mit Nummer am Textbeginn, darunter USt-ID des Käufers und Flotte, „Seite 1 von n“ über der Fußzeile, Kopfzeile auf den Folgeseiten. Ein unbrauchbares Bild fällt auf das Standardlayout zurück.
- **API:** `GET/POST /v1/pdf-letterheads`, `GET /v1/pdf-letterheads/:id/image`, `PUT /v1/pdf-letterheads/current`, `POST /v1/pdf-letterheads/preview` (Probe-PDF mit Beispieldaten, zwei Seiten). Fehlercode `PDF_LETTERHEAD_NOT_FOUND`. Die allgemeine Settings-Route lehnt `pdf.letterhead` ab. Audit im Settings-Verlauf ohne Bild.
- **CSMS:** Einstellungen → Unternehmen, Karte „PDF-Briefbogen“ unter dem PDF-Branding: gültige Version wählen, Versionsliste mit Probe-PDF und „Als Vorlage“, neue Version mit Upload, Lagen in mm, Probe-PDF und „Sofort verwenden“. „Drucken“ in der Rechnungsansicht druckt bei Briefbogen das PDF.
- **Geprüft:** typecheck, lint, format:check, check:migrations (240), check:openapi, alle Tests; Sichtprüfung der Probe-PDF auf allen fünf Briefbögen.

**Abweichungen vom Entwurf (Kleinigkeiten):**

- Höchstgröße 2 MB statt 3 MB (die PNGs mit 300 dpi haben 130 bis 215 KB). Ein PNG muss mindestens 1240 Pixel breit sein (150 dpi); 2480 Pixel (300 dpi) wird im Formular empfohlen.
- Die Satzbreite muss mindestens 160 mm betragen, weil die Positionstabelle feste Spaltenbreiten hat.
- Die Probe-PDF für eine gespeicherte Version holt Bild und Layout im CSMS und nutzt dieselbe Route wie die neue Version (keine eigene Route). Sie erscheint in einem Dialog im CSMS, nicht in einem neuen Tab (der Upstream-Wächter verlangt `noopener` bei `window.open`, ein so geöffnetes Tab lässt sich nicht nachträglich füllen).
- Die Lesbarkeitsprüfung mit pdfkit liegt in `invoice-pdf.service.ts` (`letterheadBackground`), weil laut Upstream-Wächter nur der Rechnungs-Renderer und der Berichts-Builder pdfkit importieren dürfen.
- Die Anschrift steht in normaler Schrift (DIN 5008), die E-Mail des Fahrers nur, wenn keine Postanschrift hinterlegt ist.

**Lagen für die Einrichtung** (aus den Ausgangsrechnungen gemessen, auf den Probe-PDFs geprüft):

| GmbH                     | Datei                | Anschrift links / oben | Text Seite 1 ab | Text bis | Rand links / rechts |
| ------------------------ | -------------------- | ---------------------- | --------------- | -------- | ------------------- |
| RHIEM Intermedia         | `Briefbogen-RI.png`  | 22,9 / 53,6            | 92              | 258      | 15,2 / 15,2         |
| RHIEM Packaging & Print  | `Briefbogen-RPP.png` | 21,2 / 58,9            | 112             | 258      | 21,2 / 15,9         |
| RHIEM Services           | `Briefbogen-RS.png`  | 21,2 / 58,9            | 112             | 258      | 21,2 / 15,9         |
| RHIEM Branding Solutions | `Briefbogen-RBS.png` | 27,2 / 53,6            | 105             | 262      | 27,2 / 19,4         |
| CAPREO                   | `Briefbogen-CAP.png` | 22,9 / 53,6            | 100             | 255      | 15,2 / 15,2         |

## Umsetzung Baustein 2 (05.11.2026)

Zweig `feature/issuer-letterhead` ab `rhiem/main` `69499436`. Er enthält den Merge von `feature/pdf-letterhead` (`703397ac`) und Baustein 2 (`6f07d6f3`, `e5197ac0`), mit `--no-ff` in `rhiem/main` gemergt.

- **Merge von Baustein 1:**
  - Die Migration heißt im Fork `rhiem_0014_pdf_letterheads`, weil `rhiem_0013` schon die Portal-Sichtbarkeit belegt. Auf `feature/pdf-letterhead` heißt sie weiter `rhiem_0013`; für einen PR bekommt sie ohnehin eine Upstream-Nummer.
  - Konflikte in `invoice-pdf.service.ts` mit Verkäufer-Speicherung, Personalnummer und Messnachweis: Mit Briefbogen steht die Personalnummer im Infoblock unter dem Titel (vor USt-ID und Flotte), wie in Annahme 5. Die Prüfzeilen folgen dem Satzspiegel des Briefbogens.
- **Datenbank (`rhiem_0015_invoice_issuer_letterhead`):** `pdf_letterheads.issuer_id` und `invoice_issuers.letterhead_id`, beide mit `ON DELETE RESTRICT`.
- **Ausstellung:** `letterheadIdForIssue(tx, issuer)` liefert die eigene gültige Version des Stellers, sonst `pdf.letterhead`. `allocateDocumentNumber` gibt sie zusammen mit Nummer und Verkäufer zurück. Eine Gutschrift nimmt die Version ihres Stellers, die bei ihrer Ausstellung gilt. `currentPdfLetterheadId` nimmt nur Versionen des Unternehmens.
- **API:**
  - `GET/POST /v1/invoice-issuers/:id/letterheads` und `PUT /v1/invoice-issuers/:id/letterhead`. Eine Version eines anderen Stellers oder des Unternehmens wird mit 404 `PDF_LETTERHEAD_NOT_FOUND` abgelehnt.
  - Audit wie bei Baustein 1 (`pdfLetterhead:<id>`), das Setzen der gültigen Version zusätzlich im Verlauf des Stellers.
  - `GET /v1/pdf-letterheads` und `PUT /v1/pdf-letterheads/current` nehmen nur Versionen des Unternehmens.
  - Die Probe-PDF nimmt mit `issuerId` den Verkäufer des Stellers (Kopfzeile der Folgeseiten).
  - Das Löschen eines unbenutzten Stellers löscht seine Versionen mit; kein Beleg kann sie nutzen.
- **CSMS:** Im Formular des Rechnungsstellers zeigt der Abschnitt „PDF-Briefbogen“, ob ein eigener Briefbogen gilt (mit Namen) oder der des Unternehmens, und weist darauf hin, dass mit Briefbogen weder Logo noch Fußzeile gezeichnet werden. „Briefbogen verwalten“ öffnet die Versionsverwaltung aus Baustein 1 für den Steller in einem eigenen Dialog.
- **Abweichung vom Entwurf:** Die Versionsverwaltung sitzt in einem eigenen Dialog statt direkt im Formular. Sie hat ein eigenes Formular für neue Versionen, und Formulare lassen sich nicht verschachteln.
- **Geprüft:**
  - Typecheck, lint, format:check, check:migrations (254) und check:openapi.
  - Alle Tests: 30.045 grün. Der eine Ausfall (die neuen Routen fehlten in der Audit-Klassifizierung) ist behoben und einzeln grün.
  - Die Migrationen liefen an einer lokalen Postgres 17 vom Stand `69499436` aus sauber, ein zweiter Lauf fand nichts mehr.
  - `npm run test:integration` verweist auf ein fehlendes `vitest.integration.ts` und lief nicht.

## Nachtrag 06.11.2026

Nach der Durchsicht der Probe-PDFs, mit `--no-ff` in `rhiem/main` gemergt:

- **CSP `frame-src blob:`** (`80cbc120`): Die Probe-PDF des Briefbogens und die Druckansicht der Rechnung laden das PDF als `blob:`-URL in einen iframe, den `frame-src` blockierte (`ERR_BLOCKED_BY_CSP`). Beide iframes kommen aus Baustein 1, upstream gibt es keinen solchen. Der Fix lag zuerst auf `fix/csp-blob-frame` ab `rhiem/main` und gehört jetzt als `c63d8e57` zu `feature/pdf-letterhead`, damit der Zweig für sich funktioniert. `fix/csp-blob-frame` ist überholt.
- **Sitzungstabelle auf Ladesitzungsrechnungen** (`d068adc1`, Zweig `feature/invoice-session-table` ab `rhiem/main`): Eine Rechnung nur aus Ladevorgängen listet jede Sitzung mit Beginn, Energie, Energiepreis des Tarifs und Betrag (beides brutto) und einer kleinen Zeile mit Standort, Station und Zeiten. Die Steuerübersicht bleibt netto. Statt der Zählerstände steht ein Hinweis, dass die signierten Messdaten im Kundenportal liegen. Im Kopf entfallen der Status und bei Verrechnung außerhalb das Fälligkeitsdatum, dazu kommt die Gesamtenergie.
- **Anschriftfeld mit Briefbogen** (`aeda15af`, gleicher Zweig): Personalnummer und E-Mail des Empfängers stehen klein über der Anschrift. Die Zeile mit der belasteten Flotte entfällt auf Mitgliederrechnungen und ihren Gutschriften. Das ändert Annahme 5 (unten).
- Der Zweig zweigt von `rhiem/main` ab, weil er Messnachweis (`invoice-evidence.ts`), Briefbogen und Personalnummer voraussetzt. Er ist nicht PR-fähig ([ADR 0001](../adr/0001-fork-und-branch-strategie.md)).
- Ebenfalls auf diesem Zweig entstanden, aber unabhängig: **Flotten je Fahrer in der Fahrerliste** (`f9ce7a1f`). Für einen PR neu aufgebaut als `feature/driver-list-fleets` ab `v0.1.49` (`109dbc3b`, Konflikt nur im Test-Mock wegen der Personalnummer).

## Offene Punkte

Baustein 2 ist umgesetzt (siehe oben).

1. **Briefbögen einrichten:** je Rechnungssteller eine Version mit den Lagen aus der Tabelle oben hochladen und als gültig setzen, Probe-PDF prüfen.
2. **Weitere Rechnungssteller:** Werden CAPREO und RHIEM Branding Solutions Rechnungssteller? Für den Code ändert das nichts, nur für die Einrichtung.
3. **Abnahme:** Probe-PDF je GmbH ausdrucken und in einen DL-Fensterumschlag stecken.

## Annahmen

1. Folgeseiten ohne Hintergrund, mit Kopfzeile „Firma · Rechnung … · Seite n von m“ in EVtivity-Text.
2. Eine Gutschrift nimmt den bei ihrer Ausstellung gültigen Briefbogen, nicht den der Rechnung.
3. Versionen werden nie gelöscht, auch unbenutzte nicht, außer zusammen mit einem Rechnungssteller, der nie einen Beleg ausgestellt hat. Es sind wenige, und das hält die Regel einfach.
4. Ein Rechnungssteller kann den Briefbogen des Unternehmens nicht ausdrücklich abschalten (`NULL` = Unternehmen). Bei drei GmbHs mit eigenem Briefbogen reicht das.
5. Personalnummer und Käufer-USt-ID stehen im Infoblock und nicht im Anschriftfeld. Geändert am 06.11.2026: Personalnummer und E-Mail stehen klein über der Anschrift (siehe Nachtrag).
6. Berichte bekommen keinen Briefbogen.

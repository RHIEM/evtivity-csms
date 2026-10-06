# Preisangabe brutto/netto

- **Status:** Freigegeben (02.10.2026), umgesetzt
- **Zweig:** `fix/tariff-price-net-label` (zusammen mit Fix 5 aus [ocpp16-eichrecht-wallboxen.md](ocpp16-eichrecht-wallboxen.md)), in `rhiem/main` mit `33df57f`
- **Upstream:** Sammel-Issue [#33](https://github.com/EVtivity/evtivity-csms/issues/33), PR [#34](https://github.com/EVtivity/evtivity-csms/pull/34) (erfüllt Punkte 1–4 aus #33); Punkte 5–12 von EVtivity bis `v0.1.38` umgesetzt

## Ausgangslage

Tarifpreise sind netto. `calculateSessionCost()` addiert alle Positionen (Energie, Zeit, Sitzungs-, Stand- und Reservierungsgebühr), schlägt den Steuersatz des Tarifs einmal auf die Summe auf und rundet einmal (vertikal, Netto-Basis). `calculateSplitSessionCost()` rechnet die Steuer je Tarifabschnitt. Die Sitzung speichert nur den Endbetrag inklusive Steuer (`final_cost_cents`) und den Satz (`tariff_tax_rate`).

Das Fahrerportal zeigte den Nettopreis als Hauptpreis, auf Cent gerundet, und die Steuer nur als „19 % Steuer“ in der Aufschlüsselung. Abgerechnet wurde brutto.

## Entscheidung

- **Vorgabe auf Unternehmensebene:** Einstellung `company.priceDisplay` (`gross` | `net`), im CSMS unter Einstellungen → Unternehmen. Standard `net`, damit sich für bestehende Installationen nichts ändert. Im Pilot auf `gross` setzen.
- **Wahl des Fahrers:** Portal unter Konto → Persönliche Daten, Spalte `drivers.price_display`; leer bedeutet Vorgabe des Betreibers (Muster wie `payment_mode`). Gäste sehen immer brutto.
- **Tarifpreise im Portal** (`PricingDisplay`): je nach Wahl brutto oder netto, bis zu 4 Nachkommastellen, darunter „inkl./zzgl. 19 % Steuer“.
- **Sitzungsdetail:** brutto „darin enthalten 19 % Steuer“, netto „Nettobetrag“ + „zzgl. 19 % Steuer“. Die Steuer wird wie in der Rechnung herausgerechnet (`includedTaxCents`).
- **Beträge** (Listen, Summen, Monatsübersicht, E-Mails): bleiben die abgerechneten Bruttobeträge und tragen „inkl. Steuer“.
- **E-Mail IdlingStarted:** Standgebühr nach Wahl des Fahrers mit Steuerhinweis (`idleFeeFormatted`, `idleFeeIncludesTax`, `taxRatePercent`). Behoben: Ohne Standgebühr wurden trotzdem Standgebühren angekündigt (`'0'` ist in Handlebars wahr).
- Kostenberechnung und Datenmodell der Tarife bleiben unverändert.
- Migration im Fork `rhiem_0003_driver_price_display`, im PR `0095_driver_price_display` mit identischem Inhalt (ADR 0002). Upstream als `0104_driver_price_display` übernommen; beim Merge von `v0.1.37` ersetzt sie `rhiem_0003` (gleicher Hash, gilt in bestehenden Datenbanken als angewendet).

## Übrige Punkte aus #33 (Stand v0.1.38)

EVtivity hat am 05.10.2026 in #33 gemeldet, dass alle zwölf Punkte mit `v0.1.38` erledigt sind. Am 06.10.2026 im Code von `v0.1.38` geprüft und bestätigt:

- **5 Rechnungs-PDF:** Spalte Steuersatz je Position, Steuerübersicht je Satz (Satz, Netto, Steuer, Brutto), Zwischensumme netto; Texte in der Sprache des Fahrers (`invoice-labels.ts`, `invoice-pdf.service.ts`).
- **6 Rechnung bei Tarifwechsel:** eine Position je Steuersatz (`invoice.service.ts`, `taxBreakdown`).
- **7 Umsatzbericht:** Umsatz brutto und netto, Steuer getrennt, Gewinn aus dem Nettoumsatz (`revenue-report.ts`).
- **8 Säulendisplay:** Preise nach `company.priceDisplay`, Steuerhinweis „inkl./zzgl. … %“ je Display-Sprache (`station-message.ts`).
- **9 OCPI-Kosten:** `excl_vat` netto, `incl_vat` brutto (2.2.1), `before_taxes` und `taxes` je Satz (2.3.0) (`ocpi-price.ts`).
- **10 OCPI-Tarife:** `vat` als Prozentwert (`vatPercentFromFraction`).
- **11/12 Rundung und Berechnungsmethode:** Einstellung `company.taxBasis` (`net` Standard, `gross` mit herausgerechneter Steuer). Steuer einmal je Steuersatz der Sitzung gerundet (vertikal), auch bei Tarifwechsel (`cost-calculator.ts`). Auf Basis `gross` entspricht der Abrechnungsbetrag genau Bruttopreis × Menge.

Folge für den Pilot (`company.priceDisplay` `gross`, `company.taxBasis` `net`): Angezeigt wird der aus dem Nettopreis errechnete Bruttopreis, abgerechnet netto plus einmal gerundete Steuer. Das kann einen Cent abweichen, z. B. Transaktion 9 am 05./06.10.2026: 4,5785 kWh × 0,2152 € = 99 ct netto + 19 ct Steuer = 1,18 €, angezeigt 0,2561 €/kWh × 4,5785 kWh = 1,17 €. Deshalb am 06.10.2026 auf `company.taxBasis` `gross` mit Bruttopreisen im Tarif umgestellt (0,2561 € statt 0,2152 € netto), siehe `evtivity-pilot/Entscheidungen.md`.

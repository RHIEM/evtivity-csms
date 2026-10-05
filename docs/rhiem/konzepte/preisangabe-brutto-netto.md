# Preisangabe brutto/netto

- **Status:** Freigegeben (02.10.2026), umgesetzt
- **Zweig:** `fix/tariff-price-net-label` (zusammen mit Fix 5 aus [ocpp16-eichrecht-wallboxen.md](ocpp16-eichrecht-wallboxen.md)), in `rhiem/main` mit `33df57f`
- **Upstream:** Sammel-Issue [#33](https://github.com/EVtivity/evtivity-csms/issues/33), PR [#34](https://github.com/EVtivity/evtivity-csms/pull/34) (erfüllt Punkte 1–4 aus #33)

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

## Nicht umgesetzt (Sammel-Issue)

Upstream-Stand (05.10.2026): PR #34 ist in `v0.1.34` gemergt. `v0.1.34` greift weitere Punkte aus #33 auf (Rechnungen je Steuersatz, OCPI-Steuer, Nettoumsatz, Berechnungsmethode), `v0.1.36` übersetzt das Rechnungs-PDF. Welche der folgenden Punkte damit vollständig erledigt sind, ist noch nicht einzeln geprüft.

- Rechnungs-PDF ohne Steuersatz, Texte nur Englisch (für „Laden auf Rechnung“ relevant; perspektivisch eigene RHIEM-Rechnung).
- Umsatzbericht: Umsatz inklusive Steuer, Gewinn um die Steuer zu hoch.
- Display der Ladesäule (`formatPricingDisplay`): netto, 2 Stellen, nur Englisch.
- OCPI: `total_cost.excl_vat` mit dem Bruttobetrag, `vat` als 0,19 statt 19 (zu bestätigen).
- Rundung: Bruttopreis × Menge kann 1 Cent vom Abrechnungsbetrag abweichen.
- Berechnungsmethode konfigurierbar (horizontal/vertikal, Brutto-Methode mit herausgerechneter Steuer).

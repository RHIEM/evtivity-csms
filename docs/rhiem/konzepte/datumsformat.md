# Datums- und Uhrzeitformat je nach Sprache

- **Status:** Freigegeben (02.10.2026)
- **Zweig:** `fix/locale-date-display` (Basis `v0.1.32`)
- **Upstream:** PR folgt (Anzeige und Benachrichtigungen ggf. getrennt)

## Ausgangslage

Fahrerportal, CSMS und Benachrichtigungen formatieren Datum und Uhrzeit fest mit `'en-US'`, z. B. „Oct 1, 2026, 9:24 PM“ im Portal und „10/1/2026, 9:24:00 PM“ im CSMS, unabhängig von der gewählten Sprache. Einige Stellen nutzen `toLocaleString()` ohne Locale und damit Browsersprache und Browserzeitzone. Die Zeitzone (Fahrer, Betreiber, System) wird sonst bereits berücksichtigt.

## Entscheidung

- **Format folgt der UI-Sprache**, wie bei Zahlen und Beträgen (ADR 0003, `fix/locale-number-display`). Keine eigene Formateinstellung, keine neue Bibliothek, nur `Intl`.
- **`dateStyle: 'medium'`** statt einzelner Felder: Jede Sprache bekommt ihre übliche Schreibweise, Deutsch numerisch (`05.03.2026, 09:04`), Englisch wie bisher im Portal (`Mar 5, 2026, 9:04 AM`).
- **Sekunden:** im CSMS ja (wie bisher), im Portal und in E-Mails/SMS nein.
- **Umsetzung:** `@evtivity/lib/timezone` erhält einen Parameter `locale` und wird zur gemeinsamen Implementierung (eigener Export wie `@evtivity/lib/number`). CSMS und Portal setzen `uiLocale()` ein, der Server die Sprache des Empfängers.
- **Relative Zeit** im CSMS („5s ago“) über `Intl.RelativeTimeFormat` (`style: 'narrow'`).
- **Benachrichtigungen:** `formatDateVariables` bekommt die Sprache des Empfängers; im OCPP-Dispatcher wird je Empfänger formatiert.
- **Säulendisplay:** Reservierungsende in der Zeitzone des Standorts (bisher Serverzeit). Format bleibt `en-US`, da es weder Sprache je Säule noch eine systemweite Sprache gibt und die Display-Vorlagen englisch sind.

## Nicht umgesetzt

- Rechnungs-PDF (Texte, Datum, Beträge nur Englisch): gesondertes Thema, siehe Issue #33.
- Sprache des Säulendisplays (Standort- oder Systemsprache).

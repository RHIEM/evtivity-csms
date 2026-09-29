# Konzept: Laden auf Rechnung

- **Status:** Entwurf – Anforderungssammlung, noch keine Lösungskonzeption
- **Stand:** 29.09.2026
- **Quellen:** bisherige RHIEM-Dokumente zum Mitarbeiterladen (Konzept Mitarbeiterladen, EVtivity-Produktionsabgleich, Feldversuchsplanung)

## Ziel

Ein freigegebener Fahrer lädt zu einem kostenpflichtigen Tarif ohne Karte. Am Monatsende erhält er oder ein Unternehmen eine Rechnung.

Erster Einsatz ist der Feldversuch ab Oktober 2026: Eine private Wallbox (KEBA KC-P30, OCPP 1.6J) wird von der bisherigen Hersteller-Abrechnung auf EVtivity umgestellt; die Monatsrechnung für Oktober soll erstmals aus EVtivity kommen und an den Empfänger gehen, der sie bisher erhält. Die Verbrauchsdaten bleiben zum Abgleich direkt aus der Wallbox abrufbar.

## Ausgangslage in EVtivity

Laut bisheriger Prüfung ist der Ablauf im geprüften Quellstand nicht durchgängig vorhanden:

- Das Fahrerportal verlangt bei kostenpflichtigen Tarifen eine Stripe-Zahlungsmethode und Vorautorisierung.
- Der OCPP-Pfad stoppt auch per RFID gestartete kostenpflichtige Vorgänge, wenn dem Fahrer eine Zahlungsmethode fehlt.
- Free-Vend und kostenlose Tarife umgehen die Zahlungsschranke, erzeugen aber keine abrechenbaren Kosten. Eine kostenlose Tarifkonfiguration ist daher keine korrekte Simulation.
- Vorhanden: Abgeschlossene, bepreiste und noch nicht fakturierte Vorgänge eines einzelnen Fahrers lassen sich für einen Zeitraum **manuell** zu einer Rechnung zusammenfassen (Empfänger: der Fahrer, Fälligkeit 30 Tage ab Erstellung).
- Nicht vorhanden: Freigabemerkmal für Zahlung auf Rechnung, automatische monatliche Rechnungserstellung, gemeinsame Unternehmensrechnung für mehrere Fahrer.
- Die Rechnungsauswahl filtert bereits per Karte bezahlte Vorgänge nicht heraus.

## Anforderungen

1. **Freigabe:** Ein Fahrer kann für Laden auf Rechnung freigegeben werden (eigener Abrechnungsmodus neben der Kartenzahlung).
2. **Rechnungsempfänger:** Je Freigabe ist festgelegt, wer die Rechnung erhält – der Fahrer selbst oder ein Unternehmen.
3. **Zahlungsschranken:** Freigegebene Fahrer können kostenpflichtig laden, ohne Zahlungsmethode – konsistent im Portal-Start und im OCPP-Pfad (inkl. RFID).
4. **Status:** Vorgänge auf Rechnung haben einen eindeutigen Status „offen auf Rechnung“.
5. **Monatslauf:** Am Monatsende werden die offenen Vorgänge zu einer Rechnung zusammengefasst.
6. **Keine Doppelabrechnung:** Jeder Vorgang wird genau einmal abgerechnet – weder doppelt im Monatslauf noch zusätzlich per Karte. Stabile Sitzungs-IDs je Position.
7. **Unvollständige Vorgänge:** Unvollständige oder nicht bepreiste Sitzungen werden ausdrücklich gekennzeichnet statt stillschweigend abgerechnet.
8. **Tests:** Ablauf mit Portal- und RFID-Starts testen.

## Weitere Anforderungen aus dem Konzept Mitarbeiterladen

- **Identität:** Persönliche RFID-Kennung je Mitarbeiter mit Gültigkeitszeitraum; historische Zuordnungen bleiben nachvollziehbar, auch wenn Karten neu vergeben werden.
- **Transparenz:** Mitarbeiter sehen eigene Sitzungen, kWh, Tarif, Betrag und ihren Messnachweis.
- **Export:** Berechtigte Verwaltungspersonen können einen Zeitraum als CSV exportieren.
- **Messnachweis (Eichrecht):** Signierte OCMF-Daten werden unverändert aufbewahrt und mit dem passenden öffentlichen Schlüssel exportierbar gemacht; ein vorhandener Signatureintrag gilt noch nicht als verifiziert. Vor Rechnungen ist eine Regel für fehlende oder ungültige Nachweise festzulegen. Maßgeblich sind die Auflagen der genauen KC-P30-Ausführung und deren Baumusterprüfbescheinigung.
- **Rechnungssystem:** Falls Rechnungen an Mitarbeitende gehen, ggf. über das bestehende Buchhaltungssystem; EVtivity liefert dann geprüfte Rechnungspositionen, Tarif und Nachweisreferenz.

## Offene Punkte

- Bezahlen Mitarbeitende und erhalten Rechnungen, oder werden Kosten nur intern verrechnet? (Im zweiten Fall genügen zunächst Sitzungsübersicht und Monats-CSV.)
- Rechtliche und steuerliche Ausgestaltung der Mitarbeiterabrechnung – mit den zuständigen Fachleuten festzulegen.
- Abstimmung mit EVtivity: Das Feature wird so umgesetzt, als läge eine Upstream-Freigabe vor, und später als Vorschlag eingereicht.

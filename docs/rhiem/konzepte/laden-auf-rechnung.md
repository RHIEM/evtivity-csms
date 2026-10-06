# Konzept: Laden auf Rechnung

- **Status:** Freigegeben (Lösungskonzept, erster schmaler Schnitt)
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

## Lösungskonzept (freigegeben am 29.09.2026)

Erster, bewusst schmaler Schnitt. EVtivity erhält eine Zahlungsart **Rechnung** neben der Kartenzahlung. Rechnungsempfänger ist der Fahrer. Das Clearing der Rechnung (Zahlungseingang, Buchhaltung) ist nicht Bestandteil des Portals.

### Zahlungsart und Auflösung

- Enum `payment_mode: 'card' | 'invoice'`.
- `fleets.payment_mode` (nullable): gilt für alle Fahrer der Flotte; `null` = nicht festgelegt.
- `drivers.payment_mode` (nullable): überschreibt die Flotte; `null` = von der Flotte erben.
- Auflösung analog `resolveTariffGroup` (`packages/api/src/services/tariff.service.ts`): Fahrer > älteste Flottenmitgliedschaft mit gesetztem Wert > `'card'`. Im OCPP-Pfad wird dasselbe SQL inline ausgeführt (wie `isTariffFreeForStation`), weil `ocpp` nicht von `api` abhängt.
- `charging_sessions.payment_mode` (nullable) hält die Zahlungsart beim Start fest (Snapshot analog `free_vend` und `tariff_*`). Spätere Flotten- oder Fahreränderungen verändern die Historie nicht.

### Zahlungsschranken

- **OCPP (inkl. RFID):** `runPaymentGate` löst die Zahlungsart auf. Bei `invoice` wird sie am Vorgang gespeichert, der Vorgang weder gestoppt noch vorautorisiert.
- **Portal-Start:** Bei `invoice` ist keine Zahlungsmethode nötig; die Zahlungsart wird beim Anlegen des Vorgangs gespeichert.
- Reservierungen verlangen weiterhin eine Karte (No-Show- und Stornogebühren) – nicht Teil dieses Schnitts.

### Verwaltung

- API: `payment_mode` in den Create-/Update-Routen für Fahrer und Flotten.
- Betreiberoberfläche: Auswahl „Zahlungsart“ im Flotten- und Fahrerformular (beim Fahrer zusätzlich „Von Flotte übernehmen“).

### Rechnung

- Abrechnung zeitbasiert und manuell (z. B. quartalsweise) über die vorhandene Sammelrechnung `POST /invoices/aggregated` je Fahrer, direkt im Status `issued`; Versand über `POST /invoices/:id/send`.
- Bereits abgerechnete Vorgänge (vorhandene Rechnungsposition) werden wie bisher ausgelassen.
- Neu: Vorgänge mit einem Karten-Zahlungseintrag (`payment_records` in `pre_authorized`, `captured`, `partially_refunded`, `refunded`) werden aus der Sammelrechnung ausgeschlossen.
- Die Sammelrechnung filtert **nicht** auf `payment_mode = 'invoice'`, damit das bisherige Verhalten erhalten bleibt.

### Bekannte Einschränkungen (bewusst nicht in diesem Schnitt)

- Kein automatischer Monatslauf/Cronjob; ein späterer Job ruft nur die Sammelrechnung auf.
- Eine stornierte Rechnung gibt ihre Vorgänge nicht wieder frei (Positionen bleiben bestehen).
- Keine Sperre gegen zwei gleichzeitige Sammelrechnungen für denselben Fahrer.
- `createSessionInvoice` prüft nicht, ob ein Vorgang bereits abgerechnet ist.
- Unvollständige oder nicht bepreiste Vorgänge werden weiterhin still ausgelassen statt gemeldet.
- Keine Anzeige des Abrechnungsstands im Fahrerportal; der Status „offen auf Rechnung“ ist ableitbar (`payment_mode = 'invoice'`, `completed`, keine Rechnungsposition).
- Unternehmensrechnungen, Transparenz, CSV-Export und Eichrecht-Regel folgen später.

### Umsetzung

Zweig `feature/invoice-payment-mode` ab `v0.1.25`, `--no-ff` in `rhiem/main`.

## Umsetzungsstand (29.09.2026)

Umgesetzt auf `feature/invoice-payment-mode` (`cd3ef7d`), gemergt in `rhiem/main`.

- Schema: Enum `payment_mode` in eigener Schema-Datei (`packages/database/src/schema/payment-mode.ts`), weil sich `drivers.ts` und `charging.ts` gegenseitig importieren. Migration `rhiem_0001_payment_mode` von Hand angelegt (auf dem Feature-Zweig noch als `0089_payment_mode`, beim Merge von `v0.1.27` umbenannt, siehe [ADR 0002](../adr/0002-eigene-datenbankmigrationen.md)).
- Auflösung: `resolvePaymentMode()` in `packages/api/src/services/driver.service.ts`. Im OCPP-Pfad setzt `snapshotPaymentMode()` den Wert per `UPDATE … RETURNING` in einem Schritt am Vorgang.
- Portal-Start: Die Zahlungsprüfung greift wie bisher nur, wenn Stripe konfiguriert ist. Im Rechnungsmodus wird sie übersprungen.
- Oberfläche: Die Auswahl der Zahlungsart steht in den Detail- bzw. Bearbeitungsformularen von Fahrer und Flotte. In den Anlageformularen fehlt sie, dort lässt sich die Zahlungsart vorerst nur über die API setzen.
- Tests: Unit- und Routentests (Auflösung, Portal-Start, OCPP-Gate beim RFID-Start, Fahrer-/Flotten-API, Karten-Filter). Das Repo hat keine Integrationstests (`test:integration` verweist auf eine fehlende Konfiguration). Zusätzlich wurden das SQL gegen die lokale Datenbank und der Ablauf über die laufende API geprüft.

Abhängigkeiten (eigene Fixes, beide in EVtivity `v0.1.27` übernommen):

- `fix/hash-based-migrations`: Offene Migrationen werden am Hash erkannt. Voraussetzung dafür, dass die Migration in die Pilot-Datenbank darf. Upstream: Issue [#13](https://github.com/EVtivity/evtivity-csms/issues/13), PR [#14](https://github.com/EVtivity/evtivity-csms/pull/14).
- `fix/nullable-enum-schema`: `null` für nullable Enums in Request-Bodies. Der Feature-Zweig baut darauf auf. Upstream: Issue [#15](https://github.com/EVtivity/evtivity-csms/issues/15), PR [#16](https://github.com/EVtivity/evtivity-csms/pull/16).

Noch offen vor dem Feldversuch: Test mit der KEBA KC-P30 (OCPP 1.6J, RFID) bzw. dem Simulator. Bisher ist der Pfad nur mit gemockter Datenbank getestet.

## Anpassung an EVtivity v0.1.37 (05.10.2026)

Mit `v0.1.37` hat EVtivity die Zahlungen in ein eigenes Paket `@evtivity/payments` verlagert: austauschbare Zahlungsanbieter (Stripe, Adyen) und eine gemeinsame Einordnung je Vorgang, `classifySessionPayment()` (`roaming`, `free_vend`, `prepaid`, `card`, `guest`, `anonymous`), die Zahlungsschranke beim Start und Abrechnung am Ende teilen.

Entscheidungen (05.10.2026):

- **Rechnung ist eine Zahlungsart, kein Zahlungsanbieter.** Ein Anbieter ist eine Kartenanbindung (Karten hinterlegen, Betrag vormerken, abbuchen, erstatten), und systemweit ist nur einer aktiv (`payments.provider`). Rechnung wird stattdessen als `invoice` in `classifySessionPayment()` eingeordnet, nach `prepaid` und vor `card`. Vorbild ist `prepaid`: keine Vormerkung, Abrechnung außerhalb des Kartenanbieters.
- **Die Sammelrechnung enthält auch bereits Bezahltes**, wie bei Upstream. Unser Filter gegen Vorgänge mit Kartenzahlung entfällt. Heute unkritisch, weil ein Fahrer entweder ganz auf Rechnung oder ganz per Karte lädt.

Umsetzung auf `feature/invoice-payment-mode` (Merge von `v0.1.37`, `3f51627`):

- `SessionPaymentFacts.invoice`; die OCPP-Schranke ruft `snapshotPaymentMode()` für Fahrer außerhalb von Roaming auf und kehrt bei `invoice` ohne Vormerkung zurück. `settleSessionPayment()` liest `charging_sessions.payment_mode`; ohne Vormerkung wird nichts abgebucht.
- Portal-Start: Bei aktivem Zahlungsanbieter wird die Zahlungsmethode im Rechnungsmodus nicht verlangt.
- Migration als `rhiem_0001_payment_mode` (Inhalt unverändert) am Ende des Journals.
- Das Rechnungs-PDF ist seit `v0.1.36` übersetzt (u. a. Deutsch) und weist Steuern je Steuersatz aus (`v0.1.34`).

Rangfolge beim Start (OCPP und Portal):

- Zahlungsart: Fahrer > älteste Flottenmitgliedschaft mit gesetztem Wert > `card`. Sie wird bei jedem Start neu ermittelt und am Vorgang festgehalten; eine Änderung während des Ladens gilt erst für den nächsten Vorgang.
- Einordnung des Vorgangs: `roaming` > `free_vend` > `prepaid` > `invoice` > `card`. Bei `invoice` kehrt die OCPP-Schranke zurück, bevor `authorizeSessionHold()` die Zahlungsmethode prüft; eine fehlende Karte stoppt den Vorgang also nicht. Wer mit einem Prepaid-Token lädt, zahlt über das Guthaben.
- Zahlungsanbieter: `payments.provider` hat in `v0.1.37` noch keine Oberfläche. Migration `0116` belegt ihn mit `stripe` vor, wenn ein Stripe-Schlüssel hinterlegt ist, sonst mit `none`; das Speichern eines Stripe-Schlüssels setzt `none` auf `stripe`. Bei `none` verlangt der Portal-Start von niemandem eine Zahlungsmethode, der OCPP-Pfad stoppt Kartenfahrer ohne Karte aber weiterhin (`no_method` wird vor dem Anbieter geprüft). Ein Test im Pilot ist deshalb nur per RFID aussagekräftig, solange kein Anbieter aktiv ist. Seit `v0.1.38` lässt sich der Anbieter in den Zahlungseinstellungen wählen (`none`, `simulated`, `stripe`, `adyen`).

Bekannte Einschränkung: Storno- und No-Show-Gebühren einer Reservierung werden per Karte bezahlt und stehen zusätzlich auf der Sammelrechnung (Upstream-Verhalten). Reservierungen verlangen weiterhin eine Karte; im Feldversuch wird nicht reserviert.

Upstream: EVtivity hat am 03.10.2026 Interesse bekundet und will den Vorschlag prüfen. Antwort mit dem Stand auf `v0.1.37` am 05.10.2026 ([Kommentar](https://github.com/EVtivity/evtivity-csms/discussions/12#discussioncomment-18760460)): Rechnung als Zahlungsart in `classifySessionPayment()`, Ausschluss von Kartenzahlungen aus der Sammelrechnung entfällt (angeboten: auf `payment_mode = 'invoice'` beschränkt, falls gewünscht).

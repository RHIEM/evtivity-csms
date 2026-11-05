# Station aus den Listen des Fahrerportals nehmen

- **Status:** Freigegeben (05.11.2026, im Chat: Vorschläge 1 und 2, Schalter nur an der Station), umgesetzt
- **Zweig:** in `rhiem/main` `feature/portal-unlisted-station-v0.1.49` mit Basis `v0.1.49` (Migration `rhiem_0013_station_portal_listed`); für den PR `feature/portal-unlisted-station` mit Basis `upstream/main` `4790ef78` (v0.1.50, `3ac60b53`, Migration `0487_station_portal_listed`, gleicher Inhalt)
- **Upstream:** Vorschlag als Discussion [#53](https://github.com/EVtivity/evtivity-csms/discussions/53) („Ideas“, 05.11.2026), eingereicht als PR [#54](https://github.com/EVtivity/evtivity-csms/pull/54) (05.11.2026, Freigabe des Nutzers), Hinweis in #53 kommentiert
- **Geprüft:** PR-Zweig auf v0.1.50: typecheck, lint, format:check, check:migrations (242), check:openapi, KI-Katalog ohne Diff, test:release, 31.188 Tests; Zweig auf v0.1.49: typecheck, lint, format:check, check:migrations (240), check:openapi, 29.756 Tests; jeweils nur der bekannte Timeout in `FleetReservationsTab` (einzeln grün)

## Ausgangslage

Jede angenommene Station erscheint im Fahrerportal in der Suche, auf der Karte, in „In der Nähe“ und auf der Standortseite. Einzelne Stationen sollen dort nicht auftauchen, z. B. die Heimladesäule „Heimladen-Test“ des Nutzers. Maßgeblich ist die Sichtbarkeit in Listen. Wer zufällig vor Ort ist und per QR-Code startet, darf laden; eine Zugriffsregel ist nicht gewünscht.

Bisher filterte `publicStationListed()` (`packages/api/src/lib/public-station.ts`) sowohl die Listen als auch alle Zugriffe per Stations-ID. Ausblenden ging nur über `pending`/`blocked`, und das sperrt auch das Laden.

## Entscheidung

- **Schalter an der Station:** `charging_stations.portal_listed boolean not null default true`. Bestehende Stationen bleiben gelistet.
- **Kein Schalter am Standort.** Ein Standort folgt seinen Stationen: `publicSiteListed()` zeigt ihn nur, wenn er mindestens eine gelistete Station hat. Zwei Schalter bräuchten eine Vorrangregel. Bekannter Haken: Eine neue Station an einem sonst ausgeblendeten Standort ist zunächst wieder gelistet. Falls das stört, kann sie später beim Anlegen den Wert der übrigen Stationen des Standorts übernehmen.
- **Filter geteilt:**
  - `publicStationServed()` entspricht der bisherigen Regel (angenommene Betreiberstation) und gilt für alles per Stations-ID: Stations- und EVSE-Seite (QR-Landeseiten), Preise, Statusabfrage, Start, Gast-Konfiguration und Gast-Start, Favorit hinzufügen, Station beobachten, Ereignisstrom, Reservierung. `qrCheckableStation()` baut darauf auf, dynamische QR-Codes funktionieren also weiter.
  - `publicStationListed()` = served und `portal_listed = true`, nur für Suche, „In der Nähe“/Karte und Standortseite (Stationen, Zählung, Bilder; die Stoßzeiten hängen an `publicSiteListed()`).
- **Kein toter Link:** Stations- und EVSE-Seite liefern bei einer nicht gelisteten Station `siteId: null`. Das Portal zeigt dann die Adresse ohne Link zur Standortseite (Verhalten wie bei Stationen ohne Standort), eine Änderung am Portal ist nicht nötig.
- **Favoriten (Vorschlag 2):** Die Favoritenliste filtert schon bisher nicht nach den Listen. Favorit hinzufügen nutzt jetzt `publicStationServed()`. Ein Fahrer speichert die Station also einmal von der QR-Seite aus und findet sie dann unter seinen Favoriten.
- **Nicht geändert:** wer laden darf; OCPI veröffentlicht weiter jede Station (`publish: true`). Das kann später der Einstellung folgen.

## Umfang

- Schema `assets.ts`, Migration `rhiem_0013_station_portal_listed.sql` (`ADD COLUMN IF NOT EXISTS`).
- `lib/public-station.ts`; Aufrufe in `routes/portal/charger.ts`, `guest.ts`, `favorites.ts`, `station-watches.ts`, `station-events.ts`; Kommentar in `web-payment.service.ts`; Guard-Test `conformance-station-guard.test.ts` kennt `publicStationServed`.
- `routes/stations.ts`: `portalListed` im PATCH-Body, im GET und im Antwortschema. Das Stations-Audit erfasst die Änderung über den Vorher/Nachher-Schnappschuss. KI-Werkzeugkatalog neu erzeugt.
- CSMS: Karte „Fahrerportal“ mit Schalter „Im Fahrerportal auflisten“ oben im Tab „QR-Codes“ der Station (`StationPortalListingCard.tsx`, ohne `stations:write` gesperrt), Übersetzungen in sechs Sprachen.
- Tests: `public-station.test.ts`, `portal-charger-routes.test.ts`, `portal-favorites-routes.test.ts`, `stations-routes.test.ts`, `StationPortalListingCard.test.tsx`.

## Nach dem Upstream-Merge

Beim nächsten Update `rhiem_0013` durch die Upstream-Migration ersetzen (gleicher Inhalt, `IF NOT EXISTS`), wie bei `rhiem_0004` (Token-Bezeichnung).

# RHIEM-Fork von EVtivity CSMS

Dieses Repository ist der RHIEM-Fork von [EVtivity CSMS](https://github.com/EVtivity/evtivity-csms). Ziel ist zunächst der Feldversuch Mitarbeiterladen (u. a. „Laden auf Rechnung“). Umgebung und Befehle: [README.rhiem.md](README.rhiem.md). Konzepte und Entscheidungen: [docs/rhiem/](docs/rhiem/README.md).

## Arbeitsweise

1. **Erst planen, dann umsetzen.** Vor jeder Code-Änderung gemeinsam mit dem Nutzer einen Plan erarbeiten: Rückfragen stellen, betroffene Stellen benennen, konkrete Beispiele und Umsetzungsvorschläge analog der bestehenden Implementierung zeigen (echte Dateien und Patterns aus dem Repo zitieren).
2. **Freigabe abwarten.** Umgesetzt wird erst, wenn der Nutzer das Konzept ausdrücklich freigegeben hat. Weicht die Umsetzung vom freigegebenen Konzept ab, zuerst nachfragen.
3. Freigegebene Konzepte und Architekturentscheidungen in `docs/rhiem/` ablegen (siehe dortige README).

## Sprache

- **Englisch:** Quelltext, Kommentare, Bezeichner, Tests, Commit-Messages von Features, Issues und PRs an EVtivity – im Stil des bestehenden Codes.
- **Deutsch:** Abstimmung mit dem Nutzer, Pläne, Konzepte und ADRs in `docs/rhiem/`, RHIEM-Doku.

## Code-Standards

Grundlage ist [CONTRIBUTING.md](CONTRIBUTING.md). Alle Features werden so umgesetzt, als wären sie bereits für Upstream freigegeben, und später als Vorschlag an EVtivity eingereicht.

- Bestehende Patterns übernehmen: vor neuem Code vergleichbare Stellen im Repo suchen und deren Struktur, Benennung und Kommentardichte folgen. Keine neuen Abstraktionen oder Abhängigkeiten ohne Absprache.
- TypeScript strict, kein `any` ohne Begründung.
- Tests für jede Änderung: Unit-Tests für Logik, Integrationstests für API-Routen.
- Fertig heißt: `npm run typecheck && npm run lint && npm test` grün; bei API-, Datenbank- oder Auth-Änderungen zusätzlich `npm run test:integration` ohne stderr-Ausgabe.
- Schemaänderungen über Drizzle (`npm run db:generate`) und `npm run check:migrations`.

## Git

Strategie: [ADR 0001](docs/rhiem/adr/0001-fork-und-branch-strategie.md).

- `rhiem/main` ist unser Release-Zweig. Features entstehen als `feature/…` bzw. `fix/…` vom Upstream-Tag, auf dem `rhiem/main` steht, und werden mit `--no-ff` in `rhiem/main` gemergt.
- RHIEM-eigene Dateien (`CLAUDE.md`, `README.rhiem.md`, `docs/rhiem/`, `shell.nix`, `.envrc`) nur auf `rhiem/main` bzw. `rhiem/…`-Zweigen ändern, nie auf Feature-Zweigen.
- Conventional Commits (commitlint). Nach freigegebener Umsetzung selbstständig committen und pushen – das Repo aktuell halten.
- Git-Hooks brauchen `npx`: Befehle ohne aktives direnv mit `nix-shell --run '…'` ausführen.

## Vertraulichkeit

Der Fork ist **öffentlich**. Keine Zugangsdaten, internen Hostnamen, personenbezogenen Daten oder Datenbank-Dumps committen. Betriebsdaten des Piloten liegen außerhalb des Repos in `../evtivity-pilot/` (dort `*.local.md` und `.env.local` nur lesen, wenn die Aufgabe es erfordert).

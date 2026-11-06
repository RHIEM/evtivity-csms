# Abweichungen von EVtivity

Register aller Stellen, an denen `rhiem/main` vom EVtivity-Release abweicht: was, warum, wo, mit welcher Migration, wie der Stand bei EVtivity ist und wann die Abweichung entfällt. Grundsatz (Entscheidung vom 09.10.2026, [ADR 0001](adr/0001-fork-und-branch-strategie.md)): kein dauerhafter eigener Fork. Jede Abweichung hat ein Ziel, entweder upstream oder bewusst nur bei uns, mit Begründung.

**Pflege:** bei jedem Merge in `rhiem/main`, bei jedem Upstream-Update und wenn sich ein PR oder eine Discussion bei EVtivity bewegt. Einzelheiten stehen im jeweiligen Konzept, hier nur der Überblick.

## Stand

- **Stand:** 06.11.2026, `rhiem/main` auf Tag **`v0.1.49`**
- **Abstand zu `upstream/main`** (`4790ef78`, Vorbereitung von 0.1.50): 181 Commits vor, 7 zurück. Ohne RHIEM-Dateien sind 186 Dateien geändert (+17.000 / −700 Zeilen, mit Tests), dazu 15 eigene Migrationen.
- **Probe-Merge mit `upstream/main`:** 28 Dateien mit Konflikten, fast alle aus der Token-Bezeichnung, die upstream mit PR #50 übernommen wurde (siehe unten).

Messen:

```bash
git fetch upstream --tags
git rev-list --left-right --count rhiem/main...upstream/main
git diff --stat $(git merge-base rhiem/main upstream/main) rhiem/main -- . ':!docs/rhiem'
git merge-tree --write-tree --name-only rhiem/main upstream/main   # Konfliktdateien
```

## Aktive Abweichungen

| Abweichung                                                                                                                          | Zweig (Basis)                                                                                                                                                                                            | Migration           | Konzept                                                                   | Upstream                                                                          | Entfällt, wenn …                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Token-Bezeichnung                                                                                                                   | `feature/driver-token-label` (gelöscht)                                                                                                                                                                  | `rhiem_0004`        | [token-bezeichnung.md](konzepte/token-bezeichnung.md)                     | PR [#50](https://github.com/EVtivity/evtivity-csms/pull/50) gemergt (v0.1.50)     | Update auf v0.1.50: Upstream-Fassung übernehmen, `0485` ist inhaltsgleich (Hash geprüft) |
| Station aus den Listen des Fahrerportals nehmen                                                                                     | `feature/portal-unlisted-station` (`upstream/main`), im Fork `-v0.1.49`                                                                                                                                  | `rhiem_0013`        | [portal-sichtbarkeit-station.md](konzepte/portal-sichtbarkeit-station.md) | Discussion #53, PR [#54](https://github.com/EVtivity/evtivity-csms/pull/54) offen | PR #54 gemergt: `rhiem_0013` durch `0487` ersetzen                                       |
| Flotten je Fahrer in der Fahrerliste                                                                                                | `feature/driver-list-fleets` (`v0.1.49`)                                                                                                                                                                 | –                   | – (klein, siehe Commit `109dbc3b`)                                        | noch nicht vorgeschlagen, PR-fähig                                                | als PR angenommen                                                                        |
| Versionierter PDF-Briefbogen (Baustein 1), inkl. CSP `frame-src blob:` für Vorschau und Druck                                       | `feature/pdf-letterhead` (`v0.1.49`)                                                                                                                                                                     | `rhiem_0014`        | [briefbogen.md](konzepte/briefbogen.md)                                   | Ideas-Discussion nach dem Update auf v0.1.50 geplant                              | als PR angenommen                                                                        |
| Rechnungssteller: Verkäufer an der Rechnung, eigene Nummernkreise, Verrechnung außerhalb, Zustellung, Personalnummer, Logo/Fußzeile | gestapelt ab `v0.1.49`: `invoice-seller-snapshot` → `invoice-issuers` → `fleet-external-settlement` → `member-invoice-delivery` → `driver-employee-number`; `invoice-issuer-branding` (alle `feature/…`) | `rhiem_0005`–`0012` | [rechnungssteller.md](konzepte/rechnungssteller.md)                       | bewusst noch nicht vorgeschlagen (Entscheidung 04.11.2026: erst final)            | als PR-Serie angenommen; sonst dauerhaft im Fork                                         |
| Briefbogen je Rechnungssteller (Baustein 2)                                                                                         | `feature/issuer-letterhead` (`rhiem/main`, begründet: hängt an den Rechnungsstellern)                                                                                                                    | `rhiem_0015`        | [briefbogen.md](konzepte/briefbogen.md)                                   | folgt den Rechnungsstellern                                                       | mit den Rechnungsstellern                                                                |
| Sitzungstabelle auf Ladesitzungsrechnungen, Kopf und Anschriftfeld mit Briefbogen                                                   | `feature/invoice-session-table` (`rhiem/main`, begründet: nutzt Messnachweis, Briefbogen, Personalnummer)                                                                                                | –                   | [briefbogen.md](konzepte/briefbogen.md#nachtrag-06112026)                 | nicht vorgeschlagen                                                               | mit Rechnungsstellern und Messnachweis                                                   |
| Eichrecht für OCPP 1.6: signierte Messwerte und Zählerschlüssel speichern, OCMF-Export, Messnachweis im Portal und auf der Rechnung | `feature/ocpp16-signed-meter-data` (`v0.1.47-beta.1`), Folgecommits direkt                                                                                                                               | `rhiem_0002`        | [ocpp16-eichrecht-wallboxen.md](konzepte/ocpp16-eichrecht-wallboxen.md)   | bewusst nicht eingereicht (Entscheidung 30.09.2026, PR am 20.10.2026 erwogen)     | EVtivity baut es selbst, oder Entscheidung geändert und als PR angenommen                |
| Entwicklungsumgebung und Doku                                                                                                       | direkt auf `rhiem/main`                                                                                                                                                                                  | –                   | [ADR 0001](adr/0001-fork-und-branch-strategie.md)                         | geht nie upstream                                                                 | nie (`CLAUDE.md`, `README.rhiem.md`, `docs/rhiem/`, `shell.nix`, `.envrc`, `.gitignore`) |

## Migrationen

Eigener Namenskreis `rhiem_NNNN` nach [ADR 0002](adr/0002-eigene-datenbankmigrationen.md). Ausgelieferte Dateien werden nie geändert, auch wenn die Abweichung entfällt.

| Migration                  | Gehört zu                     | Stand                                                                                                    |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `rhiem_0001`, `rhiem_0003` | Laden auf Rechnung (abgelöst) | Altlast: `0001` legt `payment_mode` an, `0003` überführt in die Flottenabrechnung und entfernt es wieder |
| `rhiem_0002`               | Eichrecht                     | aktiv                                                                                                    |
| `rhiem_0004`               | Token-Bezeichnung             | wird mit v0.1.50 durch `0485` ersetzt (inhaltsgleich)                                                    |
| `rhiem_0005`–`rhiem_0012`  | Rechnungssteller              | aktiv                                                                                                    |
| `rhiem_0013`               | Portal-Sichtbarkeit           | im PR #54 als `0487`, gleicher Inhalt                                                                    |
| `rhiem_0014`               | Briefbogen Baustein 1         | auf `feature/pdf-letterhead` als `rhiem_0013`, im PR mit Upstream-Nummer                                 |
| `rhiem_0015`               | Briefbogen Baustein 2         | aktiv                                                                                                    |

## Upstream übernommen (Historie)

Diese Abweichungen gibt es nicht mehr, weil EVtivity sie übernommen oder selbst gelöst hat.

| Thema                                                 | Upstream                                                           | Konzept                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Offene Migrationen am Hash erkennen                   | PR #14                                                             | [ADR 0002](adr/0002-eigene-datenbankmigrationen.md)                                   |
| `null` für nullable Enums                             | PR #16                                                             | [laden-auf-rechnung.md](konzepte/laden-auf-rechnung.md)                               |
| Dezimaltrennzeichen und Zahlenformat je Sprache       | PRs #18, #21                                                       | [ADR 0003](adr/0003-dezimalzahlen-eingabe.md)                                         |
| OCPP-Auth vor dem Upgrade, Endenergie aus `meterStop` | PRs #23, #25                                                       | [ocpp16-eichrecht-wallboxen.md](konzepte/ocpp16-eichrecht-wallboxen.md)               |
| Ping/Pong als Aktivität, Dezimal-Zählerstände         | upstream selbst gelöst (#26/#27, #28/#29)                          | [ocpp16-eichrecht-wallboxen.md](konzepte/ocpp16-eichrecht-wallboxen.md)               |
| Portal-/Stopp-Befehle für OCPP 1.6 übersetzen         | PR #31                                                             | [ocpp16-eichrecht-wallboxen.md](konzepte/ocpp16-eichrecht-wallboxen.md)               |
| `connectorId 0` als Stationsstatus                    | upstream selbst gelöst (`v0.1.32`), PR #32 geschlossen             | [ocpp16-connector-0-stationsstatus.md](konzepte/ocpp16-connector-0-stationsstatus.md) |
| Preise netto/brutto                                   | Issue #33, PR #34                                                  | [preisangabe-brutto-netto.md](konzepte/preisangabe-brutto-netto.md)                   |
| Datumsformat je Sprache                               | PR #35                                                             | [datumsformat.md](konzepte/datumsformat.md)                                           |
| Laden auf Rechnung                                    | durch die Flottenabrechnung von `v0.1.41` ersetzt (Discussion #12) | [laden-auf-rechnung.md](konzepte/laden-auf-rechnung.md)                               |
| OCPP-1.6-Start ohne Flottenguthaben ablehnen          | PR #43                                                             | –                                                                                     |
| Ladesitzungsbericht                                   | nie eingereicht, im Fork zurückgebaut (04.11.2026)                 | [ladesitzungsbericht.md](konzepte/ladesitzungsbericht.md)                             |

## Zweige auf `origin`

Am 06.11.2026 gelöscht: `fix/csp-blob-frame` (Fix steckt in `feature/pdf-letterhead`) und `feature/invoice-payment-mode` (Laden auf Rechnung, abgelöst).

PR-fähig heißt: Basis ist ein Upstream-Tag, keine RHIEM-Dateien, keine Fork-Features außer den eigenen Vorgängern im Stapel.

| Zweig                                                                                   | Basis            | PR-fähig       | Bemerkung                                                                                  |
| --------------------------------------------------------------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `feature/portal-unlisted-station`                                                       | `upstream/main`  | ja             | PR #54                                                                                     |
| `feature/driver-list-fleets`                                                            | `v0.1.49`        | ja             | aus `f9ce7a1f` neu aufgebaut (06.11.2026)                                                  |
| `feature/pdf-letterhead`                                                                | `v0.1.49`        | ja             | enthält seit 06.11.2026 den CSP-Fix (`c63d8e57`, aus `80cbc120`)                           |
| `feature/invoice-seller-snapshot` … `driver-employee-number`, `invoice-issuer-branding` | `v0.1.49`        | ja, als Stapel | Rechnungssteller                                                                           |
| `feature/ocpp16-signed-meter-data`                                                      | `v0.1.47-beta.1` | technisch ja   | bewusst nicht eingereicht; spätere Commits zum Messnachweis liegen direkt auf `rhiem/main` |
| `feature/issuer-letterhead`, `feature/invoice-session-table`                            | `rhiem/main`     | nein           | hängen an Fork-Features, siehe Tabelle oben                                                |
| `feature/session-report`, `fix/session-report-no-replaces`                              | `rhiem/main`     | nein           | zurückgebaut, für einen möglichen späteren PR aufbewahrt                                   |

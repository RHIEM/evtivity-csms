# EVtivity – Entwicklungsumgebung RHIEM

Lokale Entwicklung für den Feldversuch auf NixOS (WSL2). Ergänzt die offizielle [DEVELOPMENT.md](DEVELOPMENT.md); hier steht nur, was bei uns abweicht oder dazukommt.

## Voraussetzungen

- Docker nativ in NixOS (`virtualisation.docker.enable = true;`, User in Gruppe `docker`)
- `direnv` mit Shell-Hook
- Alles Weitere (Node 24, `psql`/`pg_restore`, `gh`, `jq`) liefert [shell.nix](shell.nix) – `direnv` lädt es beim Betreten des Ordners über `.envrc`.

## Einrichtung (einmalig)

```bash
git clone https://github.com/RHIEM/evtivity-csms.git && cd evtivity-csms
git remote add upstream https://github.com/EVtivity/evtivity-csms.git
git switch rhiem/main
direnv allow .
cp .env.example .env    # BIND_IP=127.0.0.1 setzen
npm ci                  # nicht npm install: ändert sonst package-lock.json
```

## Starten und Stoppen

```bash
npm run dev:infra        # PostgreSQL, Redis, Migration, Mailpit, Monitoring
                         # warten, bis evtivity-migrate-1 mit Exit 0 endet
npm run dev:api          # je ein eigenes Terminal
npm run dev:ocpp
npm run dev:worker
npm run dev:csms
npm run dev:portal
npm run dev:css          # optional: Ladestationssimulator
```

Stoppen: Dienste mit `Ctrl+C` beenden (oder `pkill -f "npm run dev:"`), dann `docker compose --profile tools --profile monitoring down` (`npm run dev:infra:down` lässt das Monitoring laufen).

## Adressen

| Dienst              | URL                             | Zugang (nur lokal)                |
| ------------------- | ------------------------------- | --------------------------------- |
| Betreiberoberfläche | http://localhost:7100           | admin@evtivity.local / admin123   |
| Fahrerportal        | http://localhost:7101           | driver@evtivity.local / driver123 |
| API                 | http://localhost:7102/v1/health | –                                 |
| OCPP                | ws://localhost:7103             | –                                 |
| Mailpit             | http://localhost:7108           | –                                 |
| Grafana             | http://localhost:7107           | admin / admin                     |

Alle Mails landen in Mailpit, nichts wird tatsächlich versendet.

## Git-Workflow

Details und Begründung: [ADR 0001](docs/rhiem/adr/0001-fork-und-branch-strategie.md).

- `rhiem/main` ist unser Release-Zweig: ein EVtivity-Release-Tag (derzeit `v0.1.27`) plus RHIEM-eigene Dateien (`CLAUDE.md`, `README.rhiem.md`, `docs/rhiem/`, `shell.nix`, `.envrc`, `.direnv/` in `.gitignore`). Diese gehen nie in Pull-Requests an EVtivity.
- Features zweigen deshalb vom **Upstream-Tag** ab, auf dem `rhiem/main` steht – nicht von `rhiem/main`.

| Zweck                                    | Abzweigen von                 | Präfix               |
| ---------------------------------------- | ----------------------------- | -------------------- |
| Feature/Fix, der als PR zu EVtivity soll | Upstream-Tag von `rhiem/main` | `feature/…`, `fix/…` |
| Nur für uns                              | `rhiem/main`                  | `rhiem/…`            |

```bash
# Feature anlegen und in unseren Stand übernehmen
git switch -c feature/<name> v0.1.27
git switch rhiem/main && git merge --no-ff feature/<name>

# Später als PR an EVtivity: auf aktuellen Upstream bringen
git fetch upstream && git switch feature/<name> && git rebase upstream/main
git diff --stat upstream/main...HEAD   # darf keine RHIEM-Dateien zeigen

# Neues Upstream-Release übernehmen
git fetch upstream --tags
git switch rhiem/main && git merge v0.1.xx
```

### Eigene Datenbankmigrationen

Details: [ADR 0002](docs/rhiem/adr/0002-eigene-datenbankmigrationen.md). Migrationen von Hand anlegen (`db:generate` ist nicht nutzbar): `rhiem_NNNN_name.sql` mit eigener, fortlaufender Nummer plus Journaleintrag am Ende mit `idx` und `when` jeweils +1, dann `npm run check:migrations`. Bringt ein Upstream-Release neue Migrationen, entsteht ein Konflikt am Ende von `_journal.json`: Upstream-Einträge übernehmen, unsere dahinter setzen, `idx` und `when` weiterzählen. Dateiname und Inhalt bleiben unverändert.

## Hinweise

- PostgreSQL (5433) und Redis (6379) ignorieren `BIND_IP` und lauschen auf allen Adressen – innerhalb von WSL unkritisch.
- Die Umgebung ist vom Dokploy-Piloten (`../evtivity-pilot/`) vollständig getrennt. Deployment, Datenbanksicherung und Wiederherstellung des Piloten beschreibt `../evtivity-pilot/Deployment.md` (außerhalb des Repos, enthält interne Hostnamen); Dumps bleiben dort auf dem Server und werden nicht auf Arbeitsrechner kopiert.
- KEBA KC-P30 spricht OCPP 1.6J – Tests mit dem Simulator bzw. `npm run octt:1.6` entsprechend auf 1.6 ausrichten.

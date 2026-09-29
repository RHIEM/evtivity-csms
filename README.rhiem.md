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

Stoppen: Dienste mit `Ctrl+C` beenden (oder `pkill -f "npm run dev:"`), dann `npm run dev:infra:down`.

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

`rhiem/main` ist unser Stand: ein EVtivity-Release-Tag (derzeit `v0.1.25`) plus die RHIEM-eigenen Dateien `README.rhiem.md`, `shell.nix`, `.envrc` (plus `.direnv/` in `.gitignore`). Diese Änderungen gehen nie in Pull-Requests an EVtivity – deshalb zweigen Features für Upstream **nicht** von `rhiem/main` ab:

| Zweck                                          | Abzweigen von   | Präfix               |
| ---------------------------------------------- | --------------- | -------------------- |
| Feature/Fix, der als PR zu EVtivity soll       | `upstream/main` | `feature/…`, `fix/…` |
| Nur für uns (z. B. Konfiguration, Anpassungen) | `rhiem/main`    | `rhiem/…`            |

```bash
# Upstream-fähiges Feature
git fetch upstream
git switch -c feature/laden-auf-rechnung upstream/main
# … entwickeln, dann in unseren Stand übernehmen:
git switch rhiem/main && git merge feature/laden-auf-rechnung
# PR an EVtivity aus feature/laden-auf-rechnung stellen

# Neues Upstream-Release übernehmen
git fetch upstream --tags
git switch rhiem/main && git merge v0.1.xx
```

Vor einem PR prüfen: `git diff --stat upstream/main...HEAD` darf keine RHIEM-Dateien zeigen.

## Hinweise

- PostgreSQL (5433) und Redis (6379) ignorieren `BIND_IP` und lauschen auf allen Adressen – innerhalb von WSL unkritisch.
- Die Umgebung ist vom Dokploy-Piloten vollständig getrennt; Pilot-Dumps lassen sich bei Bedarf mit `pg_restore` in die lokale Datenbank einspielen.
- KEBA KC-P30 spricht OCPP 1.6J – Tests mit dem Simulator bzw. `npm run octt:1.6` entsprechend auf 1.6 ausrichten.

# RHIEM-Dokumentation

Konzepte und Architekturentscheidungen für den RHIEM-Fork. Liegt nur auf `rhiem/main` und geht nicht in Pull-Requests an EVtivity.

| Ordner                 | Inhalt                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| [adr/](adr/)           | Architekturentscheidungen, fortlaufend nummeriert: `NNNN-kurztitel.md`      |
| [konzepte/](konzepte/) | Fachliche und technische Konzepte je Feature, z. B. `laden-auf-rechnung.md` |

## Ablauf

1. Konzept in `konzepte/` entwerfen (Status **Entwurf**), gemeinsam abstimmen.
2. Nach Freigabe Status auf **Freigegeben** setzen, dann umsetzen.
3. Grundsätzliche Entscheidungen, die über ein Feature hinausgehen, zusätzlich als ADR festhalten.

## Entscheidungen

| Nr.                                             | Titel                                      | Status     |
| ----------------------------------------------- | ------------------------------------------ | ---------- |
| [0001](adr/0001-fork-und-branch-strategie.md)   | Eigener Fork und Branch-Strategie          | Angenommen |
| [0002](adr/0002-eigene-datenbankmigrationen.md) | Eigene Datenbankmigrationen neben Upstream | Angenommen |

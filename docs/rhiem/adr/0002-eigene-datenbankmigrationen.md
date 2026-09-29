# ADR 0002: Eigene Datenbankmigrationen neben Upstream

- **Status:** Angenommen
- **Datum:** 29.09.2026

## Kontext

Unsere Features bringen eigene Migrationen mit (zuerst `payment_mode` für „Laden auf Rechnung“). Sie laufen in der Pilot-Datenbank, lange bevor EVtivity sie übernimmt. Upstream nummeriert seine Migrationen fortlaufend (`NNNN_name.sql`, `idx` im Journal) und vergibt das Journal-`when` zuletzt meist von Hand mit +1. Unsere Migrationen kollidieren deshalb mit künftigen Upstream-Migrationen, sowohl bei Nummer und `idx` als auch beim `when`.

Bis `v0.1.25` galt eine Migration als offen, wenn ihr `when` größer war als das höchste bereits angewendete. Im Test (alte Skripte, Wegwerf-Datenbank) führte das nach einem Upstream-Merge dazu, dass die Upstream-Migration übersprungen und unsere umnummerierte Migration erneut ausgeführt wurde. Der Lauf brach mit `already exists` ab, und der Deploy wäre blockiert gewesen.

## Entscheidung

- **Offene Migrationen werden am Hash erkannt, nicht am `when`** (`fix/hash-based-migrations`, in `rhiem/main` gemergt, Kandidat für einen Upstream-PR). Offen ist jede Datei, deren SHA-256 nicht in `drizzle.__drizzle_migrations` steht. Offene Dateien laufen in Journalreihenfolge. Nachgeholte Dateien werden mit ihrem Journal-`when` eingetragen, nicht mit `Date.now()`.
- **Unsere Migrationen stehen im Journal immer am Ende.** Neue Migrationen schließen an die letzte an, mit `idx` und `when` jeweils +1 (wie Upstream zuletzt).
- **Beim Übernehmen eines Upstream-Releases werden unsere Migrationen hinter die Upstream-Migrationen umnummeriert:** Datei umbenennen, `idx`, `tag` und `when` im Journal anpassen, dann `npm run check:migrations`. Der Inhalt der Datei bleibt unverändert, denn der Hash und damit der Status in bestehenden Datenbanken hängt nur am Inhalt.
- **Keine Migration in die Pilot-Datenbank ohne den Hash-Fix auf `rhiem/main`.**
- `npm run db:generate` ist bei uns nicht nutzbar: Die Drizzle-Snapshots enden bei `0030`, Upstream schreibt Migrationen seitdem von Hand. Wir folgen dem.

## Erwogene Alternativen

Geprüft am 29.09.2026 anhand der veröffentlichten npm-Pakete (Quelltext des Migrators gelesen).

- **Update auf die aktuelle stabile Drizzle-Version** (`drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11): löst nichts. Der Migrator entscheidet unverändert über den Zeitstempel (`pg-core/dialect.js`: `created_at < migration.folderMillis`).
- **Update auf Drizzle 1.0** (derzeit nur Release Candidate `1.0.0-rc.4`): löst das Problem grundsätzlich. Das Journal entfällt, jede Migration ist ein Ordner `JJJJMMTTHHMMSS_name/migration.sql`, und offen ist jede Migration, deren Name nicht in `__drizzle_migrations` steht (`migrator.utils.js`, `getMigrationsToRun`). Nummernkollisionen und das Umnummerieren entfallen. Für bestehende Datenbanken gibt es einen Upgrade-Pfad, der vorhandene Einträge über Zeitstempel oder Hash den Ordnern zuordnet. Dagegen spricht derzeit:
  - Noch kein stabiles Release.
  - EVtivity nutzt den Drizzle-Migrator nicht, sondern `run-migrations.mjs`, das `_journal.json` selbst liest. Ein Paket-Update allein ändert daran nichts; der 1.0-Migrator lehnt Ordner mit `_journal.json` ab.
  - Der 1.0-Migrator führt alle offenen Migrationen in einer Transaktion aus. Genau das hat EVtivity wegen `ALTER TYPE … ADD VALUE` durch Transaktionen pro Datei ersetzt (Fall `0032`/`0035`). Ein eigener Runner bliebe nötig.
  - Aufwand: 89 Migrationen umwandeln (`drizzle-kit up`), Migrations- und Prüfskripte sowie Dockerfiles umbauen, Major-Update von `drizzle-orm` in der ganzen Codebasis (Umfang nicht untersucht).
  - Nur im Fork umgesetzt, müsste jede neue Upstream-Migration von Hand ins neue Format übertragen werden. Sinnvoll ist der Umstieg nur, wenn EVtivity ihn selbst vollzieht.
- **Anderes Migrationswerkzeug** (Flyway mit `outOfOrder`, Liquibase, node-pg-migrate, Knex): lösen das Problem, weil sie jede angewendete Migration einzeln führen. Ein Wechsel würde das Datenbankpaket dauerhaft von Upstream trennen und scheidet deshalb aus.
- **`when`-Werte geschickt wählen:** nicht möglich. Upstream zählt zuletzt in +1-Schritten, ein echter Zeitstempel für unsere Migration würde alle späteren Upstream-Migrationen blockieren.

Der Hash-Fix folgt demselben Prinzip wie Drizzle 1.0 (angewendete Migrationen einzeln erkennen), nur über den Hash, weil das Journal-Format keine stabilen Namen kennt. Wir schlagen EVtivity vor, auf das 1.0-Format umzusteigen, sobald es stabil ist. Dann entfallen unser Fix und die Regel zum Umnummerieren.

## Konsequenzen

- Upstream-Migrationen werden nach einem Merge zuverlässig angewendet, unabhängig von unseren `when`-Werten.
- Eine bereits ausgelieferte Migration darf inhaltlich nie mehr verändert werden, sonst gilt sie als neu und läuft erneut. Upstream verlangt das ohnehin („shipped migrations are immutable“).
- Jeder Upstream-Merge mit neuen Migrationen erfordert das Umnummerieren unserer Migrationen. Der Journal-Konflikt macht diesen Schritt sichtbar.
- Übernimmt EVtivity ein Feature, bekommt dessen Migration dort in der Regel eine andere Nummer und oft einen anderen Inhalt. Dann entfernen wir unsere Variante und prüfen, dass die Upstream-Migration auf bereits migrierten Datenbanken idempotent läuft (`IF NOT EXISTS`), oder wir stimmen den Inhalt vorab mit EVtivity ab.
- Wird der Hash-Fix upstream nicht übernommen, müssen wir ihn bei jedem Release-Merge erhalten.

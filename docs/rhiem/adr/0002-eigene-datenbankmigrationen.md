# ADR 0002: Eigene Datenbankmigrationen neben Upstream

- **Status:** Angenommen
- **Datum:** 29.09.2026, geändert 30.09.2026 (eigener Namenskreis `rhiem_`)

## Kontext

Unsere Features bringen eigene Migrationen mit (zuerst `payment_mode` für „Laden auf Rechnung“). Sie laufen in der Pilot-Datenbank, lange bevor EVtivity sie übernimmt. Upstream nummeriert seine Migrationen fortlaufend (`NNNN_name.sql`, `idx` im Journal) und vergibt das Journal-`when` zuletzt meist von Hand mit +1. Unsere Migrationen kollidieren deshalb mit künftigen Upstream-Migrationen, sowohl bei Nummer und `idx` als auch beim `when`.

Bis `v0.1.25` galt eine Migration als offen, wenn ihr `when` größer war als das höchste bereits angewendete. Im Test (alte Skripte, Wegwerf-Datenbank) führte das nach einem Upstream-Merge dazu, dass die Upstream-Migration übersprungen und unsere umnummerierte Migration erneut ausgeführt wurde. Der Lauf brach mit `already exists` ab, und der Deploy wäre blockiert gewesen.

## Entscheidung

- **Offene Migrationen werden am Hash erkannt, nicht am `when`** (Upstream-PR [EVtivity/evtivity-csms#14](https://github.com/EVtivity/evtivity-csms/pull/14), seit `v0.1.27` in EVtivity enthalten). Offen ist jede Datei, deren SHA-256 nicht in `drizzle.__drizzle_migrations` steht. Offene Dateien laufen in Journalreihenfolge. Nachgeholte Dateien werden mit ihrem Journal-`when` eingetragen, nicht mit `Date.now()`.
- **Unsere Migrationen haben einen eigenen Namenskreis:** `rhiem_NNNN_name.sql`, fortlaufend ab `rhiem_0001`. Der Runner liest nur den `tag` aus dem Journal, die Upstream-Nummer ist für ihn bedeutungslos. Dateien werden nie umbenannt, auch nicht bei Upstream-Merges.
- **Unsere Migrationen stehen im Journal immer am Ende**, mit `idx` und `when` jeweils +1 (von `check:migrations` verlangt). Bringt ein Upstream-Release neue Migrationen, entsteht ein Konflikt am Ende von `_journal.json`: Upstream-Einträge übernehmen, unsere dahinter setzen, `idx` und `when` weiterzählen, dann `npm run check:migrations`. Der Inhalt der Dateien bleibt unverändert, denn der Hash und damit der Status in bestehenden Datenbanken hängt nur am Inhalt.
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
- **Eigener Ordner mit eigenem Journal:** vermeidet auch den Journal-Konflikt. Dafür müssten `run-migrations.mjs`, `verify-migrations-applied.mjs`, `check-migrations.mjs` und das Datenbank-Dockerfile einen zweiten Ordner kennen. Nur im Fork umgesetzt, wäre das eine dauerhafte Abweichung von Upstream. Kommt als Vorschlag an EVtivity in Frage, falls der Journal-Konflikt lästig wird.
- **Weiter Upstream-Nummern verwenden und bei jedem Merge umnummerieren** (Stand bis 30.09.2026): funktioniert dank Hash-Fix, erfordert aber bei jeder neuen Upstream-Migration Umbenennen und Anpassen von `tag` im Journal.

Der Hash-Fix folgt demselben Prinzip wie Drizzle 1.0 (angewendete Migrationen einzeln erkennen), nur über den Hash, weil das Journal-Format keine stabilen Namen kennt. Wir schlagen EVtivity vor, auf das 1.0-Format umzusteigen, sobald es stabil ist ([EVtivity/evtivity-csms#13](https://github.com/EVtivity/evtivity-csms/issues/13)). Dann entfallen der eigene Namenskreis und der Journal-Konflikt.

## Konsequenzen

- Upstream-Migrationen werden nach einem Merge zuverlässig angewendet, unabhängig von unseren `when`-Werten.
- Eine bereits ausgelieferte Migration darf inhaltlich nie mehr verändert werden, sonst gilt sie als neu und läuft erneut. Upstream verlangt das ohnehin („shipped migrations are immutable“).
- Jeder Upstream-Merge mit neuen Migrationen erzeugt einen Konflikt am Ende von `_journal.json`. Die Auflösung ist mechanisch, Dateien werden nicht angefasst.
- Geht ein Feature als PR an EVtivity, bekommt seine Migration dort die nächste Upstream-Nummer. Ist der Inhalt gleich, erkennen bestehende Datenbanken sie am Hash als angewendet.
- Übernimmt EVtivity ein Feature mit eigener Migration, hat diese in der Regel eine andere Nummer und oft einen anderen Inhalt. Dann entfernen wir unsere Variante und prüfen, dass die Upstream-Migration auf bereits migrierten Datenbanken idempotent läuft (`IF NOT EXISTS`), oder wir stimmen den Inhalt vorab mit EVtivity ab.

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

## Konsequenzen

- Upstream-Migrationen werden nach einem Merge zuverlässig angewendet, unabhängig von unseren `when`-Werten.
- Eine bereits ausgelieferte Migration darf inhaltlich nie mehr verändert werden, sonst gilt sie als neu und läuft erneut. Upstream verlangt das ohnehin („shipped migrations are immutable“).
- Jeder Upstream-Merge mit neuen Migrationen erfordert das Umnummerieren unserer Migrationen. Der Journal-Konflikt macht diesen Schritt sichtbar.
- Übernimmt EVtivity ein Feature, bekommt dessen Migration dort in der Regel eine andere Nummer und oft einen anderen Inhalt. Dann entfernen wir unsere Variante und prüfen, dass die Upstream-Migration auf bereits migrierten Datenbanken idempotent läuft (`IF NOT EXISTS`), oder wir stimmen den Inhalt vorab mit EVtivity ab.
- Wird der Hash-Fix upstream nicht übernommen, müssen wir ihn bei jedem Release-Merge erhalten.

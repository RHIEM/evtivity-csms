# ADR 0001: Eigener Fork und Branch-Strategie

- **Status:** Angenommen
- **Datum:** 29.09.2026

## Kontext

Für den Feldversuch Mitarbeiterladen brauchen wir Erweiterungen an EVtivity (zuerst „Laden auf Rechnung“), schneller als ein Upstream-Review sie liefern kann. Der Dokploy-Pilot wurde bisher direkt aus einem festen EVtivity-Commit gebaut. Gleichzeitig sollen unsere Erweiterungen später als Pull-Request an EVtivity gehen können – ohne RHIEM-spezifische Dateien.

## Entscheidung

- Wir arbeiten im Fork [RHIEM/evtivity-csms](https://github.com/RHIEM/evtivity-csms); der Pilot wird künftig aus diesem Fork gebaut.
- `rhiem/main` ist unser Release-Zweig: ein EVtivity-Release-Tag plus RHIEM-eigene Dateien.
- Features entstehen als `feature/…` bzw. `fix/…` vom Upstream-Tag, auf dem `rhiem/main` steht, und werden mit `--no-ff` in `rhiem/main` gemergt.
- Für einen PR an EVtivity wird der Feature-Zweig auf `upstream/main` rebased und nach den Regeln aus `CONTRIBUTING.md` eingereicht.
- Beiträge an EVtivity (Issues und PRs) unterliegen dem [CLA](../../../CLA.md): Übertragung des Urheberrechts an EVtivity, Patentlizenz, Zusicherung der Urheberschaft und der Arbeitgeberfreigabe. Die Freigabe durch RHIEM liegt vor (29.09.2026). Unterschrieben wird per PR-Kommentar mit exakt `I have read the CLA Document and I hereby sign the CLA` (die Checkbox im PR-Template wertet der Bot nicht aus). Der CLA-Workflow bei EVtivity kann Unterschriften derzeit nicht speichern (`contents: read`); bis das behoben ist, ist der Kommentar in jedem PR nötig und der Check bleibt rot.
- Neue EVtivity-Releases werden per Merge des Tags in `rhiem/main` übernommen.
  - Ausnahme 29.09.2026: `upstream/main` (`4de16e7`, noch ohne Release) wurde gemergt. v0.1.25 lässt sich ohne diesen Fix nicht als Docker-Image bauen: Das Portal-Image kopiert `packages/lib` nicht, obwohl das Portal seit v0.1.25 `@evtivity/lib/currency` importiert. Mit dem nächsten Release-Tag wird wieder regulär übernommen.

## Konsequenzen

- Feature-Zweige bleiben frei von RHIEM-Dateien und sind direkt PR-fähig.
- Beim Übernehmen neuer Releases können Konflikte mit unseren gemergten Features entstehen; sobald ein Feature upstream angenommen ist, entfällt unsere Variante.
- Der Fork ist öffentlich – Konzepte und Code dürfen keine vertraulichen Informationen enthalten.

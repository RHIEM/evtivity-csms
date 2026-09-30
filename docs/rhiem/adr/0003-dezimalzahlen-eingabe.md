# ADR 0003: Dezimalzahlen je nach Sprache eingeben, API nur mit „.“

- **Status:** Angenommen
- **Datum:** 30.09.2026

## Kontext

Auf der Tarifseite ließen sich Preise nur mit „.“ speichern. `"0,49"` (deutsche Handytastatur) ergab einen HTTP 500. Die Ursache lag an zwei Stellen:

- **Backend:** Die Preisprüfung in `routes/pricing.ts` nutzte Zod `.refine()`. Fastify prüft Anfragen aber gegen das JSON-Schema, das `zodSchema()` erzeugt, und `zod-to-json-schema` lässt `.refine()` dabei weg. Der Wert kam ungeprüft bei Postgres an (`numeric`), das ihn ablehnte. Upstream kennt das Problem bereits (Kommentare in `carbon.ts`, `notifications.ts`). Rund 20 weitere `.refine()` in den Routen sind aus demselben Grund wirkungslos.
- **Frontend:** Die Tarifpreise und die Stations-Koordinaten waren einfache Textfelder, deren Inhalt unverändert gesendet wurde. Die übrigen Dezimalfelder nutzten `type="number"`. Dort bestimmt die Browser-Sprache das Trennzeichen, nicht die in der App gewählte. Nicht lesbare Eingaben liefert der Browser als leeren Wert, was bei uns zu `null` wird und einen Preis stillschweigend löschen würde.

i18next und `Intl` können Zahlen nur formatieren, nicht einlesen. Ein `Intl.NumberFormat.prototype.parse` gibt es nicht.

## Entscheidung

- **Die API kennt nur „.“ als Dezimaltrennzeichen.** JSON, Postgres, OCPI, KI-Tools und Integrationen erwarten dieses Format. Sprachabhängig umgerechnet wird ausschließlich in der Oberfläche.
- **Maßgeblich ist die in i18n gewählte Sprache** (`i18n.language`), nicht die Browser-Sprache.
- **Alle Dezimalfelder im CSMS nutzen `DecimalInput`** (`packages/csms/src/components/ui/decimal-input.tsx`). Die Komponente baut auf [react-number-format](https://github.com/s-yadav/react-number-format) (MIT) auf und hält den Wert als String. So entstehen keine Rundungsfehler, und der Zustand im Formular bleibt kanonisch (`"0.49"`).
  - Beim Tippen und Einfügen gelten „.“ und „,“ als Dezimaltrennzeichen.
  - **Tausendertrennzeichen werden nicht unterstützt.** Sonst wäre „1.000“ mehrdeutig. Eingefügter Text mit mehreren Trennzeichen (z. B. „1.000,00“) wird verworfen statt geraten.
  - Wertebereiche (`min`/`max`) prüft das jeweilige Formular im Code. Die Browser-Prüfung von `type="number"` entfällt; die meisten Formulare nutzten ohnehin `noValidate`.
- **Grenzen in Zod-Routen werden als `.regex()` bzw. `.min()`/`.max()` formuliert, nicht als `.refine()`**, solange Fastify nur das erzeugte JSON-Schema prüft.
- Umgesetzt in `fix/locale-decimal-input` (API, Komponente, alle Dezimalfelder), vorgesehen als PR an EVtivity.

## Erwogene Alternativen

- **`<input type="number">` beibehalten:** Das Trennzeichen folgt der Browser-Sprache, und ungültige Eingaben kommen als leerer Wert an (Preis wird gelöscht). Verworfen.
- **Eigene Umrechnung ohne Bibliothek:** Cursor-Position, Einfügen, Minus und Nachkommastellen müssten selbst gelöst werden. Verworfen zugunsten eines verbreiteten Standards.
- **react-aria `NumberField` / `@internationalized/number` (Adobe):** Liest am gründlichsten nach Sprachregeln (CLDR, Ziffernsysteme, Barrierefreiheit). Aber der Wert ist eine Gleitkommazahl statt eines Strings, und es käme ein zweites Komponentenmodell neben Radix/shadcn hinzu. Verworfen.
- **Mantine/MUI `NumberInput`:** Das wäre ein anderes UI-Framework. Verworfen.
- **`fastify-type-provider-zod` als Validator:** Ist bereits in `packages/api/package.json` eingetragen, aber ungenutzt. Damit würden alle `.refine()` wirksam. Das erfordert aber den Umbau aller Routen und der OpenAPI-Erzeugung (und für die aktuelle Version Zod 4). Es ist eine eigene Upstream-Änderung und nicht Teil dieses Fixes.

## Konsequenzen

- Neue Dezimalfelder im CSMS nutzen `DecimalInput`, nicht `Input type="number"`.
- `react-number-format` ist eine neue Abhängigkeit von `packages/csms`.
- **Anzeige von Zahlen** (seit `fix/locale-number-display`): CSMS und Fahrerportal formatieren alle angezeigten Zahlen und Beträge in der Sprache von `i18n.language` (`@evtivity/lib/number`, `formatCurrencyAmount` mit optionalem `locale`). Gespeicherte Dezimalwerte wie Tarifpreise werden ohne Rundung nur mit dem Trennzeichen der Sprache gezeigt (`formatDecimal`). Werte für Eingabefelder, die API und CSV-Exporte bleiben kanonisch mit „.“.
- **Offen, nur bei uns vermerkt:** Serverseitige Ausgaben formatieren weiterhin fest mit `en-US`. Betroffen sind Berichte (`report-generators/sessions-report.ts`, `driver-activity-report.ts`, `revenue-report.ts`), OCPP-Stationsnachrichten und Preisanzeigen an der Ladestation (`ocpp/src/server/event-projections.ts`, `lib/src/pricing-display.ts`, `station-message.service.ts`), `routes/reservations.ts`, `routes/portal/charger.ts` und E-Mail-Vorlagen. Hier müsste die Sprache des Empfängers gelten (Fahrer, Betreiber oder Station), nicht die UI-Sprache. Vor einem Upstream-Vorschlag klären, woher diese Sprache jeweils kommt.
- Die wirkungslosen `.refine()` in den übrigen Routen (u. a. Koordinaten in `sites.ts`, `panels.ts`, `smart-charging.ts`) bleiben ein eigenes Issue.

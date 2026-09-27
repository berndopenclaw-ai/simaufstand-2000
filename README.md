# SimAufstand 2000

Satirische, isometrische Browser-Strategie im Stil der 90er-Jahre-Städtebauspiele:
**Polizei gegen Demonstranten** in der fiktiven Stadt *Neustadt*. Du spielst eine Seite, die KI die andere.
Alle Personen, Orte und Anliegen sind frei erfunden.

## Spielen

```bash
npm install
npm run dev        # http://localhost:5173
```

Oder die gebaute Version: `npm run build && npm run preview`.

### Steuerung

| Aktion | Eingabe |
| --- | --- |
| Auswählen | Linksklick, Rahmen ziehen, Umschalt = hinzufügen, Doppelklick = alle gleichen Typs |
| Bewegen | Rechtsklick |
| Karte verschieben | Pfeiltasten, mittlere Maustaste, Alt + Ziehen, Zwei-Finger-Wischen, Klick auf Stadtplan |
| Zoom | Mausrad, Zwei-Finger-Zoom, `+` / `−` |
| Gruppen | `Strg+1…9` speichern, `1…9` wählen (2× = hinspringen) |
| Fähigkeiten | `Q` Hinsetzen · `E` Festkleben · `R` Auto querstellen · `F` Auto anzünden · `G` Megafon · `T` Zugriff an/aus |
| Sonstiges | `Leertaste` Pause · `M` Musik · `H` Hilfe · `Esc` Auswahl aufheben |

### Kernidee

Beide Seiten kämpfen um die **öffentliche Meinung**. Sie bestimmt das Einkommen (Verstärkung bzw.
neue Unterstützer). Eskalation bringt kurzfristig Vorteile, kostet aber Ansehen – vor laufender
Kamera (Fernsehteam in der Nähe) dreifach.

### Einheiten

- **Polizei:** Polizist, Bereitschaftspolizei, Reiterstaffel, Wasserwerfer, Gefangenentransporter, Lösetrupp
- **Demonstranten:** Demonstrant, Klebe-Aktivist, Organisator (Megafon), Autotrupp
- **Neutral:** Passanten (anwerbbar), Fernsehteams, Verkehr

### Szenarien

1. **Die Taubensteuer** – Kreuzungsblockaden im Berufsverkehr
2. **Der Kuhglocken-Marsch** – Marsch auf den Rathausplatz
3. **Der Gartenzwerg-Gipfel** – Proteste an der roten Zone

## Technik

- TypeScript + Vite, Rendering mit PixiJS (WebGL), keine externen Assets
- Deterministische Simulation (10 Hz) in einem Web Worker, Befehlswarteschlange für Spieler und KI
- KI: Utility-Planer pro Seite, sieht nur, was ihre Einheiten sehen (Fog of War)
- Musik & Soundeffekte: eigener General-MIDI-artiger Synthesizer + Step-Sequencer (Web Audio API),
  eigene Kompositionen („Neustädter Boulevard“, „Einsatzleitung“, „Eskalation“)
- Alle Texte in `src/i18n/de.ts`

```
src/
  sim/      Simulation (Karte, Pfadsuche, Verkehr, Einheiten, KI, Szenarien, Worker)
  render/   Isometrischer Renderer, prozedurale Pixel-Texturen
  audio/    Synthesizer, Sequencer, Musikstücke, Soundeffekte
  ui/       Minimap
  game.ts   Spielablauf, Eingabe, HUD
```

## Tests

```bash
npm run typecheck
npm test             # Unit-, Regressions- (Replay mit Golden-Hash) und KI-gegen-KI-Tests (Vitest)
npm run test:e2e     # Browser-Tests (Playwright)
npm run test:all     # alles
```

Ändert sich das Spielverhalten absichtlich, den Replay-Snapshot mit `npx vitest run -u` aktualisieren.

URL-Parameter für Tests: `?lowgfx` (Auflösung 1), `?fps=N` (Bildrate begrenzen), `?debug` (Test-Hooks).

## Deployment

Die GitHub-Actions-Dateien liegen im Ordner `workflows/`. Einmalig an ihren Platz verschieben:

```bash
mkdir -p .github && git mv workflows .github/workflows && git commit -m "CI und Pages-Deployment aktivieren"
```

Danach: jeder Push auf `main` baut das Spiel und veröffentlicht es über GitHub Pages
(`.github/workflows/deploy.yml`, Tests in `ci.yml`). Einmalig in den Repo-Einstellungen unter
*Settings → Pages → Source* „GitHub Actions“ auswählen.

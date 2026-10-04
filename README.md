# CRASH JUNCTION

Mobile-first 3D Crash-Mode (Burnout-3-Stil) als Web-App – Three.js, ohne externe Assets.

- **Zielen**: Wischen → LAUNCH → Power-Balken im gelben Bereich stoppen
- **Crash**: Finger ziehen = Aftertouch, roter Button = CRASHBREAKER
- Multiplikator-Ketten, Pile-Ups, Tanker-Explosionen, Coins, Medaillen
- Garage: Upgrades, 3 Fahrzeuge, Farben (Fortschritt in `localStorage`)
- PWA (installierbar, offline), Fahrzeuge/Stadt komplett prozedural (Low-Poly)

```
npm install
npm run build   # bündelt src/ -> game.js
python3 -m http.server   # dann http://localhost:8000
```

## Look & Feel
- Karosserien als geglättete Loft-Meshes (Fenster/Säulen/Streifen per Vertex-Farbe), PBR-Lack mit Env-Map
- Schadens-Shader: Dellen, Stauchung, Verbrennungen pro Auto
- Dynamische Kamera: Hero-Cam beim Zielen, Chase-Cam beim Launch (FOV-Kick, Speed-Lines), Overhead-Action-Cam,
  Crashbreaker-Cinematic, Verdeckungs-Check gegen Gebäude, Shake/Roll/Zoom-Punch bei Treffern
- VFX: Feuerball + Schockwelle + Punktlicht, Rauchsäulen, Funken, Glassplitter, abfliegende Räder, Reifenspuren,
  Brandflecken, Rücklicht-/Ampel-Glow, Schatten (adaptiv abschaltbar)
- `?hq` in der URL erzwingt Schatten & volle Auflösung

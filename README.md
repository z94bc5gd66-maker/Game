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

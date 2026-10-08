# Windows 10 Speedup

Entschlackt Windows 10 (Telemetrie, Bloat, Hintergrundlast) und ersetzt die Windows-Suche durch
**Everything** + **EverythingToolbar**: eine Suchleiste in der Taskleiste, die per NTFS-Index in
Millisekunden sucht, so wie die Windows-7-Suche früher.

## Benutzen

1. Ordner `win10-speedup` auf den Windows-PC kopieren (am besten nach `C:\Tools\win10-speedup`).
2. **`START.bat`** doppelklicken. Sie fragt selbst nach Admin-Rechten.
3. **[1] Auswahlmenü** wählen, die Liste ansehen, mit Nummern umschalten, **ENTER** startet.
4. Das Skript legt zuerst einen **Wiederherstellungspunkt** an und merkt sich jeden geänderten Wert.
5. Danach **PC neu starten**.

| Menüpunkt | Was passiert |
|---|---|
| [1] Auswahlmenü | Liste mit 27 Tweaks, du schaltest ein und aus |
| [2] Nur schnelle Suche | Everything, Toolbar und Win+S-Umleitung installieren, Windows-Suche abschalten |
| [3] Automatisch | Alle "sicheren" und "harten" Tweaks ohne Rückfragen |
| [4] Rückgängig | Dreht alles zurück, was das Skript geändert hat |

Direkt aus PowerShell geht es auch: `.\Win10-Speedup.ps1 -Mode Safe`, `-NoMenu`, `-OnlySearch`, `-Undo`, `-SkipRestorePoint`, `-KeepWindowsSearch`.

## Was gemacht wird

**Sicher** (vorausgewählt):
- Telemetrie, Aktivitätsverlauf, Werbe-ID, Fehlerberichte und CEIP aus. Dazu die Dienste `DiagTrack` und `dmwappushservice` und rund 30 Diagnose-Aufgaben.
- Werbung, Vorschläge, Spotlight und Konsum-Features aus.
- Cortana, Bing-Websuche und News-Widget aus. Suchfeld, Aufgabenansicht und "Meet now" verschwinden aus der Taskleiste.
- Unnötige Dienste aus. `SysMain` wird nur auf einer SSD abgeschaltet, `DoSvc` (Delivery Optimization) läuft nur noch bei Bedarf.
- Vorinstallierte Apps weg (News, Wetter, Solitaire, Teams, Candy Crush und so weiter). **Store, Rechner, Fotos, Terminal und Snipping bleiben**, damit `winget` und der Store funktionieren.
- Hintergrund-Apps, Game-DVR und Game-Bar-Popups aus. Der Spielmodus bleibt an.
- Animationen, Transparenz und Schatten aus. Schriftglättung (ClearType) bleibt. Wirkt komplett nach Neuanmeldung.
- Energieplan "Ultimative Leistung" (nur Desktop) und schnelleres Herunterfahren.
- Explorer zeigt Dateiendungen und startet in "Dieser PC".
- Autostart-Ballast raus (OneDrive, Teams, Skype, Edge).
- Edge ohne Hintergrundmodus und Startup-Boost.
- VS Code: Telemetrie aus.
- Temp-Ordner und Update-Cache aufräumen.
- **Schnelle Suche** (siehe unten).

**Hart** (nur im Modus Max vorausgewählt): Xbox-Apps und Game Bar entfernen, Mail, Kalender und Sticky Notes entfernen, OneDrive deinstallieren, alte Features entfernen (IE11, PowerShell 2, SMB1, Fax, XPS, WMP), Ruhezustand und Schnellstart aus, Standortdienste aus, UPnP und Hotspot aus, Brave-Richtlinien (Rewards, Wallet, VPN, KI-Chat, Metriken), DISM-Bereinigung, feste Auslagerungsdatei mit Speicherkomprimierung (Nr. 24, siehe unten) und Win+S auf die Taskleisten-Suche (Nr. 25).

**Riskant** (nie vorausgewählt): Edge deinstallieren (nicht umkehrbar), Druckwarteschlange abschalten.

### Absichtlich NICHT angefasst
- **Defender, Firewall, SmartScreen und Windows Update bleiben an.** Windows 10 hat seit dem 14.10.2025 keinen regulären Support mehr, Sicherheitsupdates gibt es nur noch mit ESU. Ein ungeschützter Rechner ist das größere Problem als ein paar MB RAM.
- Keine Placebo-Tweaks (TCP-Registry-Spielereien, "RAM-Cleaner", Prefetch-Löschen).
- Keine Hosts-Datei-Blocklisten.

## Die schnelle Suche

Installiert per `winget` zwei Pakete: `voidtools.Everything` und `srwi.EverythingToolbar.Deskband`. Bei Bedarf kommt die .NET-Desktop-Runtime dazu.

- Der Everything-**Dienst** liest den NTFS-Index mit Adminrechten. Everything selbst läuft normal und ohne UAC-Abfrage.
- Autostart im Hintergrund ist eingerichtet.
- Zwei Startmenü-Einträge: **"Neue Dateien (heute)"** und **"Neue Dateien (7 Tage)"**. Sie zeigen zuletzt erstellte Dateien, neueste zuerst.
- Die Windows-Suche (`WSearch`) wird **erst abgeschaltet, wenn beide Pakete nachweislich installiert sind**. Sonst bleibt sie an.

**Einmal von Hand:** Rechtsklick auf die Taskleiste (die "Startleiste" mit dem Startknopf) → **Symbolleisten → EverythingToolbar** (ggf. zweimal öffnen). Die Suchleiste erscheint dann in der Taskleiste. Mit entsperrter Taskleiste ziehst du sie direkt neben den Startknopf und passt die Breite an. Das Windows-Suchfeld ist ab dann weg (Tweak 3).

**Tastenkürzel:** Die Toolbar bringt **Win + Alt + S** mit. Tweak 25 installiert zusätzlich AutoHotkey und biegt **Win + S** darauf um. Die Win-Taste allein öffnet weiter das normale Startmenü. Dessen Suchfeld liefert ohne den Windows-Suchdienst allerdings kaum noch Treffer, für Suchen nimmst du also die Toolbar.

### Suchsyntax (Everything)

| Eingabe | Findet |
|---|---|
| `*abc*.exe` | alle `.exe` mit "abc" im Namen (Wildcards) |
| `abc ext:exe` | dasselbe über die Endung |
| `dc:today` | heute **erstellte** Dateien |
| `dc:last7days` | in den letzten 7 Tagen erstellt |
| `dm:today` | heute **geändert** |
| `size:>100mb ext:iso` | große Dateien eines Typs |
| `path:C:\Projekte readme` | nur in einem Ordner |
| `file:` / `folder:` | nur Dateien oder nur Ordner |
| `"genau so"`, `!wort` | exakte Phrase, Ausschluss |
| `regex:^abc\d+\.exe$` | reguläre Ausdrücke |

Nach "Datum erstellt" sortierst du per Klick auf die Spaltenüberschrift. Falls das langsam ist, in Everything unter *Extras → Optionen → Indizes* **Erstellungsdatum** indizieren und unter *Schnellsortierung* aktivieren. Das Skript versucht das schon in der `Everything.ini` zu setzen.

## Swap unter Windows: Auslagerungsdatei

Windows hat das Gegenstück zum Linux-Swap schon eingebaut: die **Auslagerungsdatei** `pagefile.sys`. Dazu kommt die **Speicherkomprimierung**, das Gegenstück zu zram. Windows komprimiert dabei selten genutzte RAM-Seiten, bevor es überhaupt auf die Platte auslagert.

Was Swap kann und was nicht:
- Er ist **kein schneller Ersatz für RAM**. Eine SSD braucht für einen Zugriff Mikrosekunden, RAM Nanosekunden, das ist ein Faktor von etwa hundert. Läuft Windows dauernd im Swap, wird alles zäh.
- Er schützt vor **Abstürzen bei vollem RAM** und lässt Windows ungenutzte Seiten auslagern. Das gewonnene RAM nutzt es als Dateicache, und genau das macht Dateioperationen schneller.
- Eine Auslagerungsdatei abzuschalten bringt nichts und führt zu Abstürzen und fehlenden Absturzberichten. Das Skript tut es nie.

**Tweak 24** macht Folgendes:
- Die Datei bekommt eine **feste Größe** (Start = Maximum) auf dem Systemlaufwerk, also auf deiner SSD. Bis 8 GB RAM sind das 1,5 × RAM, darüber 1 × RAM, immer zwischen 4 und 16 GB. Eine feste Größe verhindert Wachsen und Schrumpfen zur Laufzeit, die Fragmentierung und die Ruckler dabei.
- Die **Speicherkomprimierung** wird eingeschaltet, falls sie aus ist.
- **TRIM** wird geprüft und bei Bedarf eingeschaltet. Das hält die SSD schnell.
- Das Skript legt die Datei nur an, wenn mindestens 10 GB Reserve auf dem Laufwerk bleiben.
- Die Änderung wirkt nach dem Neustart. `-Undo` stellt die automatische Verwaltung wieder her.

Wenn dein Windows trotzdem ständig im Swap hängt, hilft nur **mehr RAM**. Im Task-Manager unter *Leistung → Arbeitsspeicher* siehst du, wie voll er ist.

## Rückgängig machen

- **START.bat → [4]** oder `.\Win10-Speedup.ps1 -Undo` stellt alle Registry-Werte, Dienst-Startmodi, Aufgaben, Features, den Energieplan und angelegte Verknüpfungen auf den **Originalzustand** zurück. Gemerkt wird immer der Wert von vor dem allerersten Lauf.
- Zustand und Logs liegen in `C:\ProgramData\Win10Speedup`.
- **Nicht** automatisch umkehrbar: entfernte Apps (Store), deinstalliertes OneDrive (`winget install Microsoft.OneDrive`) und Edge.
- Gründlicher Rollback: Systemwiederherstellung → "Win10-Speedup (vor den Aenderungen)".

## Ehrliche Hinweise

- **Das Skript wurde auf Linux geschrieben und geprüft** (PowerShell-Parser, Tests der Hilfsfunktionen wie INI-/JSON-Bearbeitung, Zustandsdatei und Menülogik). Ein echter Lauf auf Windows 10 ist **nicht** erfolgt. Deshalb: erst Wiederherstellungspunkt (macht das Skript), dann ausprobieren, und die Ausgabe am Ende lesen. Warnungen werden dort gesammelt.
- Einige Everything-Kommandozeilenoptionen (`-install-service`, `-sort "Date Created"`) konnte ich nicht gegen die Doku prüfen (voidtools.com war aus meiner Umgebung nicht erreichbar). Das Skript prüft nach, ob der Dienst existiert, und nutzt sonst einen Fallback. Sollte eine Verknüpfung "Neue Dateien" nicht sortiert öffnen, ist nur die Sortierung betroffen, nicht die Suche.
- Die Win+S-Umleitung (Tweak 25) nutzt AutoHotkey v2. Den genauen Installationspfad habe ich nicht belegt, das Skript sucht die `AutoHotkey64.exe` selbst und warnt, wenn es sie nicht findet. Die Taste funktioniert nur, wenn die Toolbar in der Taskleiste aktiviert ist.
- Ein Gewinn bei Boot und RAM ist realistisch, "doppelt so schnell" nicht. Der größte Effekt kommt von den Animationen und der Transparenz, den Hintergrund-Apps und dem Autostart.
- Läuft das Skript unter einem anderen Admin-Konto als dem, mit dem du angemeldet bist, gelten die Benutzer-Tweaks (HKCU) für das Admin-Konto. Am besten startest du es als dein eigener Benutzer mit Adminrechten.
- Brave nutzt nach Tweak 22 Richtlinien und zeigt "Wird von deiner Organisation verwaltet". Das ist nur der Hinweis auf die Richtlinie.
- Discord und Brave haben eigene Autostart- und Hintergrund-Optionen. Die lassen sich in deren Einstellungen abschalten.

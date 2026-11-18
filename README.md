# TuX-Wetter für GNOME

Diese GNOME-Shell-Erweiterung ist ein Fork des KDE-Plasma-Widgets
**TuX-Wetter 1.5 von Mastertac**, angepasst für GNOME. Für aktuelle Bedingungen sowie Stunden- und
Tagesvorhersagen sind mehrere Wetterdienste auswählbar; die Ortssuche verwendet
Open-Meteo.
Diese Ausgabe trägt die Release-Version **0.2**. Die Oberfläche und die
mehrsprachigen Warntexte folgen der eingestellten Systemsprache (Deutsch oder
Englisch).

## Voraussetzungen

- Ubuntu 26.04.1 LTS mit GNOME Shell 50 (getestet mit GNOME Shell 50.1)
- Internetverbindung für Wetterdaten und die GitHub-Updateprüfung
- GJS, GNOME Shell, libsoup 3, GTK 4 und libadwaita
- `gnome-extensions` zum Installieren; `dconf` für die optionale Sicherung

Auf Ubuntu lassen sich die benötigten Pakete bei Bedarf installieren:

```sh
sudo apt update
sudo apt install gnome-shell gnome-shell-extension-prefs gjs gir1.2-soup-3.0 \
  gir1.2-gtk-4.0 gir1.2-adw-1 dconf-cli
```

Optional: `sudo apt install gnome-shell-extension-manager`. Zum Testen und
Paketieren aus dem Quellcode wird außerdem `libglib2.0-bin` benötigt.
Die GNOME-Shell-Version lässt sich mit `gnome-shell --version` prüfen. Andere
GNOME-Shell-Versionen werden von diesem Paket nicht unterstützt.

Die GNOME-Shell stellt die UI-Bibliotheken `St` und `Clutter` bereit. GTK 4 und
libadwaita werden für das Einstellungsfenster verwendet.

## Wetterdienste

Der Anbieter lässt sich in den Einstellungen auswählen:

- Open-Meteo mit automatischer Modellwahl
- DWD ICON-D2 und MeteoSwiss ICON-CH2, jeweils über die Open-Meteo-API
- GeoSphere Austria, direkt über das stündliche 1-km-Modell für den erweiterten Alpenraum
- MET Norway / Yr über Locationforecast

Die DWD-, GeoSphere- und MeteoSwiss-Modelle sind regional begrenzt. Die
GeoSphere-Prognose-API ist derzeit als Vorabversion gekennzeichnet. Bei
MET Norway werden Prognosewerte statt direkter Messwerte verwendet. Die
Datenquelle wird in der Wetterkarte angezeigt und ist anklickbar.

Open-Meteo ist in der kostenlosen API nur für nicht-kommerzielle Nutzung
vorgesehen. GeoSphere-Daten stehen unter CC BY 4.0; bei MET Norway gelten
CC BY 4.0 und NLOD 2.0. wetter.com ist nicht enthalten: Die API erfordert einen
eigenen Schlüssel und dessen kostenlose Quote reicht nicht für regelmäßige
Aktualisierungen. Ein gemeinsamer Schlüssel wird nicht in der Extension verteilt.

## Amtliche Wetterwarnungen

Warnungen werden unabhängig vom ausgewählten Prognosedienst für gespeicherte
Orte angezeigt:

- Deutschland: DWD-Warnungen, zugeordnet über die amtlichen Gemeinde-Warngebiete
- Österreich: GeoSphere Austria Warn API
- Schweiz: MeteoSwiss-App-Schnittstelle (inoffiziell und undokumentiert; kann
  sich ändern oder ausfallen)

Die Warnkarte zeigt die stärkste aktive Warnung, weitere Warnungen als Anzahl
und alle Details im Tooltip. Bei nicht erreichbaren Quellen wird der Status als
nicht verfügbar angezeigt, nicht fälschlich als warnungsfrei. Desktopmeldungen
für neue oder stärkere Warnungen lassen sich ab einer wählbaren Stufe aktivieren.
Sie ersetzen keine amtlichen Warn-Apps.

## Zusatzdaten und Anzeige

Zusätzlich zum gewählten Prognosedienst werden Mondphase und Mondzeiten,
europäischer Luftqualitätsindex, sechs Pollenarten und eine Regenvorschau in
15-Minuten-Schritten über Open-Meteo bezogen. Diese Anzeigeoptionen lassen sich
einzeln abschalten. Zusatzdaten und die letzte Prognose werden im
XDG-Benutzer-Cache zwischengespeichert; Luftqualität wird stündlich, Regen
viertelstündlich und die Mondphase höchstens täglich aktualisiert. Ein Klick
auf einen Vorhersagetag zeigt seine verfügbare Temperaturkurve.

Die Prognosekarte unterstützt mehrere gespeicherte Orte, Umschalten per
Pfeiltasten, Mausrad und Rechtsklick, eine helle Karte sowie acht Farbschemata.
IP-basierte Ortung bleibt optional und standardmässig ausgeschaltet.

Eine echte Stationsmessung der nächstgelegenen Wetterstation ist noch nicht
integriert; aktuelle Temperaturwerte von Forecast-Anbietern werden weiterhin
als Prognose-/Modellwerte behandelt und nicht als Messung ausgegeben.

## Einstellungen und Standort

Einstellungen und gespeicherte Orte liegen in GNOME Settings/dconf ausserhalb
des Erweiterungsordners und bleiben deshalb bei einem normalen Extension-Update
erhalten. Für eine manuelle Sicherung:

```sh
bash scripts/tuxwetter-settings.sh export "$HOME/tuxwetter-settings.dconf"
bash scripts/tuxwetter-settings.sh import "$HOME/tuxwetter-settings.dconf"
```

Die optionale automatische Standortbestimmung ist standardmässig ausgeschaltet.
Bei Aktivierung wird die öffentliche IP-Adresse an `ipapi.co` gesendet, um den
ungefähren Standort zu ermitteln. Die Ortssuche versteht unter anderem
Länderhinweise wie `Luzern (CH)` und verbreitete Schreibweisen wie `Zuerich`.

## Prüfen und paketieren

```sh
glib-compile-schemas --strict --dry-run gnome-extension/schemas
gjs -m tests/weather.test.js
gjs -m tests/location.test.js
gjs -m tests/warnings.test.js
gjs -m tests/supplementary.test.js
gjs -m tests/updates.test.js
gjs -m tests/providers.test.js
gnome-extensions pack gnome-extension \
  --extra-source=weather.js \
  --extra-source=providers.js \
  --extra-source=warnings.js \
  --extra-source=location.js \
  --extra-source=errors.js \
  --extra-source=ui-language.js \
  --extra-source=background-update.js \
  --extra-source=update-service.js \
  --extra-source=supplementary.js \
  --extra-source=updates.js \
  --extra-source=stylesheet.css \
  --extra-source=LICENSE \
  --extra-source=icons \
  --extra-source=schemas \
  --out-dir . \
  --force
```

## Von GitHub installieren oder aktualisieren

1. Öffne die [TuX-Wetter-Releases](https://github.com/19nkn80/Tux-Wetter-Gnome/releases/latest).
2. Lade unter „Assets“ die Datei `tuxwetter@tuxwetter.ch.shell-extension.zip`
   herunter. Das von GitHub angebotene Quellcode-ZIP ist kein installierbares
   Erweiterungspaket.
3. Installiere das Paket (bei einem anderen Download-Ort den Pfad anpassen):

```sh
gnome-extensions install --force "$HOME/Downloads/tuxwetter@tuxwetter.ch.shell-extension.zip"
```

Melde dich danach unter Wayland ab und wieder an, damit GNOME die installierte
Version einliest. Bei einer Neuinstallation aktiviere sie anschliessend:

```sh
gnome-extensions enable tuxwetter@tuxwetter.ch
```

Öffne die Einstellungen über den Extension Manager oder mit:

```sh
gnome-extensions prefs tuxwetter@tuxwetter.ch
```

Wähle dort den Wetterdienst und suche deinen Ort. Zum Aktualisieren denselben
Installationsbefehl mit dem neu heruntergeladenen ZIP ausführen und danach
ab- und wieder anmelden. Einstellungen und Orte bleiben dabei erhalten.

TuX-Wetter prüft nach dem Start und anschließend täglich im Hintergrund auf
GitHub, ob eine neuere Version verfügbar ist. Ist der Bildschirm gesperrt,
wird der Dialog bis zur Entsperrung zurückgestellt. In den Einstellungen wird
ebenfalls beim Öffnen geprüft; mit „Jetzt suchen“ kann die Prüfung erneut
gestartet werden. Bei einem Treffer öffnet sich ein Dialog mit „Update“ und
„Abbrechen“. Nur nach Zustimmung wird das Release-ZIP heruntergeladen, anhand
der GitHub-SHA-256-Prüfsumme geprüft und mit `gnome-extensions install --force`
installiert. Nach erfolgreicher Prüfung der installierten Version meldet ein
Dialog den Erfolg und bietet „Abmelden“ oder „Jetzt nicht abmelden“ an.
„Abmelden“ öffnet den regulären GNOME-Abmeldedialog; danach wieder anmelden.
Bei einem Fehler wird dieser angezeigt; bei „Abbrechen“ wird nichts installiert.
Alternativ lässt sich das Release weiterhin manuell öffnen.
Der Update-Check verwendet öffentliche GitHub-Releases; bei einem privaten
Repository oder ohne veröffentlichtes Release meldet er, dass kein Release
gefunden wurde. Ein veröffentlichtes Release braucht einen numerischen Tag,
beispielsweise `v0.3`, und das installierbare ZIP als Asset.

## Ein Release erstellen

Erzeuge das Paket mit dem obigen `gnome-extensions pack`-Befehl und veröffentliche
es als Asset eines GitHub-Releases. Version 0.2 trägt den Tag `v0.2`.
Folgende Releases müssen einen höheren numerischen Tag erhalten, zum Beispiel
`v0.3`. Der GitHub-Actions-Workflow veröffentlicht beim Push eines Versions-Tags
das im Repository enthaltene ZIP als Release-Asset, nachdem er Paketinhalt und
Versionsnummer gegen den Quellcode geprüft hat. Dafür muss GitHub Actions im
Repository aktiviert sein. Zuvor das ZIP neu erzeugen und mit dem Quellcode
committen.

## Inhalt

- `gnome-extension/`: Erweiterung, Einstellungen, Wetterparser, Schema und Symbole
- `scripts/tuxwetter-settings.sh`: dconf-Sicherung und Wiederherstellung
- `tests/`: Tests für Wetterdaten, Warnungen, Ortssuche, Standort und Updates

Der berechnete Böen-Windhinweis ist keine amtliche Warnung.

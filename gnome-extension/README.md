# TuX-Wetter für GNOME

TuX-Wetter **0.2** ist eine native GNOME-Shell-Erweiterung für GNOME 50 unter
Ubuntu 26.04.1. Die Wetterkarte verwendet die originalen TuX-Wetter-Symbole, zeigt das aktuelle Wetter,
gefühlt, Wind, Regenwahrscheinlichkeit, Luftfeuchtigkeit, sechs Stundenwerte, eine
Fünf-Tage-Vorschau mit Temperaturspanne und Niederschlag sowie Sonnenzeiten und UV-Index.
Es handelt sich um einen GNOME-Fork des KDE-Widgets **TuX-Wetter 1.5 von
Mastertac**. Die Oberfläche ist unabhängig von der Systemsprache auf Deutsch.
Orte lassen sich über die Open-Meteo-Geocodierung suchen und speichern; Farbschema,
Temperatureinheit und Aktualisierungsintervall sind einstellbar.
In den Einstellungen kann auf GitHub nach neueren Releases gesucht werden. Der
Benutzer öffnet und installiert ein gefundenes Release selbst.
Auswählbar sind Open-Meteo, DWD ICON-D2 und MeteoSwiss ICON-CH2 (beide über
Open-Meteo), GeoSphere Austria sowie MET Norway / Yr. Die Anbieterauswahl und
die dazugehörigen Prognose-APIs bleiben unverändert. GeoSphere deckt den
erweiterten Alpenraum ab; seine Vorhersage-API ist eine Vorabversion.

Die Erweiterung zeigt amtliche Warnungen von DWD, GeoSphere Austria und
MeteoSwiss. Die MeteoSwiss-Warnungen verwenden eine undokumentierte App-API,
die sich jederzeit ändern kann. Nicht erreichbare Quellen werden als
nicht verfügbar angezeigt. Desktop-Benachrichtigungen sind optional.
Zusätzliche, einzeln abschaltbare Anzeigen sind Mondphase/-zeiten, europäische
Luftqualität, sechs Pollenarten und eine 15-Minuten-Regenvorschau. Die
Vorhersagedaten werden lokal zwischengespeichert; Tageskarten öffnen eine
Temperaturkurve. Gespeicherte Orte lassen sich per Pfeiltasten, Mausrad oder
Rechtsklick wechseln. Helle Karte und acht Farbschemata sind verfügbar.

Die optionale IP-Standortbestimmung ist standardmässig ausgeschaltet und sendet
die öffentliche IP an ipapi.co. Einstellungen liegen in GSettings/dconf und
überleben damit normale Erweiterungsupdates; zusätzlich liegt ein Skript für
den manuellen Export und Import bei (`scripts/tuxwetter-settings.sh`).

Eine Stationsmessung der nächstgelegenen Wetterstation ist noch nicht
integriert. Prognosewerte werden nicht als Messwerte ausgegeben. Der
Windhinweis basiert auf vorhergesagten Böen und ist keine amtliche Warnung.

## Prüfen und paketieren

Im Projektordner:

```sh
glib-compile-schemas --strict --dry-run gnome-extension/schemas
gjs -m tests/weather.test.js
gjs -m tests/updates.test.js
gjs -m tests/providers.test.js
gjs -m tests/warnings.test.js
gjs -m tests/location.test.js
gjs -m tests/supplementary.test.js
gnome-extensions pack gnome-extension \
  --extra-source=weather.js \
  --extra-source=providers.js \
  --extra-source=warnings.js \
  --extra-source=location.js \
  --extra-source=errors.js \
  --extra-source=ui-language.js \
  --extra-source=supplementary.js \
  --extra-source=updates.js \
  --extra-source=stylesheet.css \
  --extra-source=LICENSE \
  --extra-source=icons \
  --extra-source=schemas \
  --out-dir . \
  --force
```

Für Installation oder Update wird das ZIP von der
[GitHub-Releases-Seite](https://github.com/19nkn80/Tux-Wetter-Gnome/releases)
heruntergeladen:

```sh
gnome-extensions install --force "$HOME/Downloads/tuxwetter@tuxwetter.ch.shell-extension.zip"
```

Danach unter Wayland ab- und wieder anmelden, damit GNOME das Paket einliest.
Bei einer Neuinstallation die Extension anschliessend aktivieren:

```sh
gnome-extensions enable tuxwetter@tuxwetter.ch
```

Zum Aktualisieren denselben Installationsbefehl mit dem neuen ZIP ausführen und
danach ab- und wieder anmelden. Die Einstellungen öffnen sich über Extension
Manager oder mit:

```sh
gnome-extensions prefs tuxwetter@tuxwetter.ch
```

Ortsnamen werden weiterhin über Open-Meteo gesucht.
Die vollständigen Voraussetzungen und die Installationsanleitung stehen in der
[Projektanleitung](../README.md).

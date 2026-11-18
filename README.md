# TuX-Wetter für GNOME

Eine GNOME-Shell-Erweiterung mit einer Wetterkarte im Stil des ursprünglichen
KDE-Plasma-Widgets TuX-Wetter. Die Erweiterung verwendet Open-Meteo für aktuelle
Bedingungen, Stunden- und Tagesvorhersagen sowie die Ortssuche.
Sie ist ein Fork von `tux-wetter-1.5-kde_widget` von Mastertac.

## Voraussetzungen

- GNOME Shell 46 oder kompatibel (getestet unter Zorin OS 18.1)
- GJS und die GNOME-Shell-Bibliotheken
- libsoup 3 für Wetter- und Geocoding-Anfragen
- `glib-compile-schemas` und `gnome-extensions` zum Prüfen und Installieren

Die GNOME-Shell stellt die UI-Bibliotheken `St` und `Clutter` bereit. GTK 4 und
libadwaita werden für das Einstellungsfenster verwendet.

## Prüfen und paketieren

```sh
glib-compile-schemas --strict --dry-run gnome-extension/schemas
gjs -m tests/weather.test.js
gjs -m tests/update.test.js
gnome-extensions pack gnome-extension \
  --extra-source=weather.js \
  --extra-source=update.js \
  --extra-source=LICENSE \
  --extra-source=icons \
  --out-dir . \
  --force
```

Das Paket `tuxwetter@tuxwetter.ch.shell-extension.zip` liegt auch bereits im
Projektstamm.

## Installieren

```sh
gnome-extensions install --force ./tuxwetter@tuxwetter.ch.shell-extension.zip
gnome-extensions enable tuxwetter@tuxwetter.ch
```

Die Erweiterung erscheint im Panel. Einstellungen lassen sich über Extension
Manager oder mit `gnome-extensions prefs tuxwetter@tuxwetter.ch` öffnen. Bei
Aktualisierungen in einer Wayland-Sitzung kann ein Ab- und Anmelden nötig sein,
damit GNOME den neuen JavaScript-Code lädt.

## Updates

Die Erweiterung prüft kurz nach dem Start und danach täglich den Branch
`Zorin181` auf GitHub. Eine neuere Version wird in einem Dialog mit **Update**
und **Abbrechen** angeboten. Erst nach Bestätigung wird das Paket desselben
GitHub-Commits heruntergeladen und mit `gnome-extensions install --force`
installiert. Falls die Prüfung oder Installation fehlschlägt, wird der Fehler
angezeigt und im GNOME-Shell-Protokoll vermerkt.
Die Schaltfläche **Auf Updates prüfen** in der Wetterkarte startet die Prüfung
auch manuell und meldet, wenn bereits die aktuelle Version installiert ist.
Die Wetterkarte zeigt außerdem die Versionsnummer und den Ursprung des Forks an.

Nach der Installation ist unter Wayland gegebenenfalls Ab- und Anmelden nötig,
um den neuen Code zu laden. Dies geschieht nicht automatisch; offene Programme
bleiben bis zum regulären Abmelden erhalten. Die Prüfung sendet eine Anfrage an
GitHub. Die Version `0.1` ist für den Test des Updates auf `0.2` vorgesehen.

## Inhalt

- `gnome-extension/`: Erweiterung, Einstellungen, Wetterparser, Schema und Symbole
- `tests/`: Tests für Wetterdaten, Wettercodes und Ortssuche
- `tuxwetter@tuxwetter.ch.shell-extension.zip`: installierbares Erweiterungspaket

Wetterdaten und Ortsnamen werden direkt von Open-Meteo abgerufen. Der berechnete
Windhinweis ist keine amtliche Warnung.

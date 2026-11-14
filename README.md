# TuX-Wetter für GNOME

Eine GNOME-Shell-Erweiterung mit einer Wetterkarte im Stil des ursprünglichen
KDE-Plasma-Widgets TuX-Wetter. Die Erweiterung verwendet Open-Meteo für aktuelle
Bedingungen, Stunden- und Tagesvorhersagen sowie die Ortssuche.

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
gnome-extensions pack gnome-extension \
  --extra-source=weather.js \
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

## Inhalt

- `gnome-extension/`: Erweiterung, Einstellungen, Wetterparser, Schema und Symbole
- `tests/`: Tests für Wetterdaten, Wettercodes und Ortssuche
- `tuxwetter@tuxwetter.ch.shell-extension.zip`: installierbares Erweiterungspaket

Wetterdaten und Ortsnamen werden direkt von Open-Meteo abgerufen. Der berechnete
Windhinweis ist keine amtliche Warnung.

# TuX-Wetter für GNOME

Eine native GNOME-Shell-Erweiterung für GNOME 46. Die Wetterkarte verwendet die originalen TuX-Wetter-Symbole, zeigt das aktuelle Wetter,
gefühlt, Wind, Regenwahrscheinlichkeit, Luftfeuchtigkeit, sechs Stundenwerte, eine
Fünf-Tage-Vorschau mit Temperaturspanne und Niederschlag sowie Sonnenzeiten und UV-Index.
Orte lassen sich über die Open-Meteo-Geocodierung suchen und speichern; Farbschema,
Temperatureinheit und Aktualisierungsintervall sind einstellbar.
Die Erweiterung ist ein Fork von `tux-wetter-1.5-kde_widget` von Mastertac;
Versionsnummer und Herkunft stehen auf der Wetterkarte.

Noch nicht portiert sind weitere Wetteranbieter, amtliche Warnungen, Luftqualität und Pollen,
automatische Standortermittlung, animierte Symbole und die Tageskurven.
Der angezeigte Windhinweis wird aus vorhergesagten Böen berechnet und ist keine amtliche Warnung.

## Prüfen und paketieren

Im Projektordner:

```sh
glib-compile-schemas --strict --dry-run gnome-extension/schemas
gnome-extensions pack gnome-extension \
  --extra-source=weather.js \
  --extra-source=update.js \
  --extra-source=LICENSE \
  --extra-source=icons \
  --out-dir .
```

Zur Installation und Aktivierung kann das erzeugte Paket verwendet werden:

```sh
gnome-extensions install --force ./tuxwetter@tuxwetter.ch.shell-extension.zip
gnome-extensions enable tuxwetter@tuxwetter.ch
```

Nach einer Aktualisierung in der Wayland-Sitzung ab- und wieder anmelden, damit GNOME den
neuen JavaScript-Code lädt. Das schliesst Programme; deshalb Erweiterung erst installieren,
wenn ein reguläres Abmelden ohnehin passt.
Die Einstellungen öffnet man über Extension Manager oder mit:

```sh
gnome-extensions prefs tuxwetter@tuxwetter.ch
```

Wetterdaten und Ortsnamen werden direkt von Open-Meteo abgerufen.

Die Erweiterung prüft beim Start und danach täglich auf Updates im GitHub-Branch
`Zorin181`. Ein Update wird erst nach Bestätigung im Dialog installiert; eine
abgelehnte Version wird bei der nächsten Prüfung wieder angeboten. Fehler werden
angezeigt und protokolliert. Das Neuladen der GNOME-Sitzung erfolgt nicht
automatisch.
Über **Auf Updates prüfen** auf der Wetterkarte kann die Prüfung auch manuell
gestartet werden. Ist keine neuere Version verfügbar, erscheint eine Meldung.

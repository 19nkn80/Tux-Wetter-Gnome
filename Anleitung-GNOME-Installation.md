# TuX-Wetter für GNOME – Schritt für Schritt installieren

TuX-Wetter ist eine GNOME-Shell-Erweiterung. Sie wird als **ZIP-Datei**
installiert; das ZIP muss nicht entpackt werden. Die `.plasmoid`-Datei und
das Skript `Tux-Wetter-installieren.sh` gehören zur KDE-Version und werden
für GNOME nicht benötigt.

## 1. Voraussetzungen prüfen

Du brauchst eine GNOME-Sitzung mit **GNOME Shell 46** (getestet mit Zorin OS
18.1) und eine Internetverbindung für Wetterdaten und Updates. Andere
GNOME-Shell-Versionen sind in diesem Paket nicht freigegeben.

Öffne das Terminal, zum Beispiel mit **Strg + Alt + T**, und gib ein:

```sh
gnome-shell --version
```

Die Ausgabe muss mit `GNOME Shell 46` beginnen. Wichtig: Die Versionsnummer
deiner Linux-Distribution ist nicht unbedingt die GNOME-Shell-Version.

Prüfe auch, ob das Installationswerkzeug vorhanden ist:

```sh
gnome-extensions version
```

Falls `gnome-extensions` fehlt, kannst du unter Zorin OS bzw. Ubuntu die
benötigten Komponenten mit folgendem Befehl installieren:

```sh
sudo apt update
sudo apt install gnome-shell gnome-shell-extension-prefs gir1.2-soup-3.0 gir1.2-gtk-4.0 gir1.2-adw-1 curl
```

`sudo` fragt nach deinem Anmeldepasswort; während der Eingabe werden keine
Zeichen angezeigt. Bei anderen Distributionen heißen die Pakete möglicherweise
anders. Installiere GNOME Shell nicht als Ersatz für einen anderen Desktop,
ohne vorher dessen Dokumentation zu beachten.

## 2. Installationsdatei herunterladen

Die Datei [TuX-Wetter für GNOME 0.2](https://raw.githubusercontent.com/19nkn80/Tux-Wetter-Gnome/dccaa24f6ad0ac65848d17879a143dd61881b04d/tuxwetter%40tuxwetter.ch.shell-extension.zip)
ist das fertige GNOME-Installationspaket. Falls du die Datei bereits mit
dieser Anleitung erhalten hast, kannst du direkt zu Schritt 3 gehen.

Alternativ kannst du sie im Terminal in deinem persönlichen Ordner herunterladen:

```sh
cd ~
curl -fL 'https://raw.githubusercontent.com/19nkn80/Tux-Wetter-Gnome/dccaa24f6ad0ac65848d17879a143dd61881b04d/tuxwetter%40tuxwetter.ch.shell-extension.zip' -o tuxwetter@tuxwetter.ch.shell-extension.zip
```

Falls `curl` fehlt, installiere es unter Zorin OS bzw. Ubuntu mit
`sudo apt install curl`. Der Link lädt gezielt Version 0.2 herunter;
spätere Versionen werden über die Updatefunktion angeboten.

## 3. ZIP installieren

Wenn du den Terminal-Download aus Schritt 2 verwendet hast, führe aus:

```sh
gnome-extensions install --force "$HOME/tuxwetter@tuxwetter.ch.shell-extension.zip"
```

Wenn du stattdessen die beiliegende Datei
`TuX-Wetter-GNOME-0.2.shell-extension.zip` verwendest, öffne im Dateimanager
den Ordner mit der Datei, wähle **Im Terminal öffnen** und führe aus:

```sh
gnome-extensions install --force ./TuX-Wetter-GNOME-0.2.shell-extension.zip
```

`--force` ersetzt eine bereits installierte Version. Für eine Installation
im eigenen Benutzerkonto ist kein `sudo` notwendig.

## 4. Aktivieren und anmelden

Aktiviere die Erweiterung im Terminal:

```sh
gnome-extensions enable tuxwetter@tuxwetter.ch
```

Melde dich anschließend einmal ab und wieder an, damit GNOME die installierte
Version sicher lädt. **Speichere vorher deine Arbeit:** Beim Abmelden werden
offene Programme geschlossen. Eine automatische Abmeldung findet nicht statt.

Nach der Anmeldung sollte oben im Panel ein Wettersymbol mit Temperatur
erscheinen. Ein Klick öffnet die Wetterkarte.

## 5. Ort einstellen

1. Öffne die Wetterkarte und klicke auf das Zahnrad für **Einstellungen**.
   Alternativ öffne das Terminal und gib ein:

   ```sh
   gnome-extensions prefs tuxwetter@tuxwetter.ch
   ```

2. Gib unter **Ort suchen** deinen Ort ein und klicke auf **Suchen**.
3. Wähle den passenden Treffer aus. Weitere Orte und Anzeigeoptionen lassen
   sich ebenfalls in den Einstellungen verwalten.

## Updates

Die Wetterkarte zeigt die installierte Versionsnummer. TuX-Wetter prüft kurz
nach dem Start und danach täglich auf GitHub, ob eine neuere Version verfügbar
ist. Mit **Auf Updates prüfen** kannst du die Prüfung auch selbst starten.
Ein Update wird nur installiert, wenn du im Dialog **Update** auswählst;
**Abbrechen** installiert nichts. Nach einer Installation musst du dich
gegebenenfalls ab- und wieder anmelden.

**Test mit Version 0.1:** Wenn du die Updatefunktion testen möchtest,
installiere nicht vorher das 0.2-Paket aus dieser Anleitung. Verwende deine
lokal vorbereitete 0.1, melde dich nach deren Installation neu an und starte
die Prüfung. Dann sollte 0.2 angeboten werden.

## Falls etwas nicht funktioniert

- **Erweiterung nicht sichtbar:** Prüfe mit
  `gnome-extensions info tuxwetter@tuxwetter.ch` den Status. Melde dich
  nach einer Installation oder Aktualisierung erneut an und aktiviere sie
  gegebenenfalls nochmals mit dem Befehl aus Schritt 4.
- **Alte Versionsnummer sichtbar:** Die laufende GNOME-Sitzung kann noch die
  alte Version geladen haben. Melde dich ab und wieder an.
- **Keine Wetterdaten oder kein Update:** Prüfe die Internetverbindung.
  Wetter und Ortssuche verwenden Open-Meteo; die Updateprüfung verwendet GitHub.
- **Falsche GNOME-Version:** Das Paket unterstützt laut Metadaten GNOME Shell
  46. Auf anderen Versionen kann es nicht regulär aktiviert werden.
- **Entfernen:** `gnome-extensions uninstall tuxwetter@tuxwetter.ch`
  entfernt die installierte Erweiterung.

TuX-Wetter für GNOME ist ein Fork von `tux-wetter-1.5-kde_widget` von
Mastertac.

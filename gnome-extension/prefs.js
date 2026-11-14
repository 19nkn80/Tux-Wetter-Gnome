// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {geocodingUrl, parseGeocodingResults} from './weather.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.tuxwetter';

function isGerman() {
    return GLib.get_language_names()[0]?.startsWith('de') ?? false;
}

function text(german, english) {
    return isGerman() ? german : english;
}

function parsePlaces(settings) {
    try {
        const places = JSON.parse(settings.get_string('places'));
        return Array.isArray(places)
            ? places.filter(place => place && typeof place.name === 'string'
                && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90
                && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180)
            : [];
    } catch (error) {
        console.error(`TuX-Wetter: Could not read saved locations: ${error.message}`);
        return [];
    }
}

export default class TuxWetterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_ID);
        const page = new Adw.PreferencesPage();
        const locationGroup = new Adw.PreferencesGroup({
            title: text('Ort suchen und einstellen', 'Find and set a location'),
            description: text(
                'Suche weltweit nach Städten und wähle den passenden Treffer.',
                'Search worldwide for cities and choose the matching result.'),
        });

        const searchRow = new Adw.EntryRow({title: text('Ort suchen', 'Search for a place')});
        const searchButton = new Gtk.Button({
            label: text('Suchen', 'Search'),
            valign: Gtk.Align.CENTER,
        });
        searchRow.add_suffix(searchButton);
        searchRow.activatable_widget = searchButton;
        locationGroup.add(searchRow);

        const searchStatus = new Adw.ActionRow();
        locationGroup.add(searchStatus);
        const resultsGroup = new Adw.PreferencesGroup({title: text('Suchergebnisse', 'Search results')});

        const name = new Adw.EntryRow({title: text('Angezeigter Ortsname', 'Displayed place name')});
        const latitude = new Adw.EntryRow({title: text('Breitengrad', 'Latitude')});
        const longitude = new Adw.EntryRow({title: text('Längengrad', 'Longitude')});
        name.text = settings.get_string('location-name');
        latitude.text = String(settings.get_double('latitude'));
        longitude.text = String(settings.get_double('longitude'));
        locationGroup.add(name);
        locationGroup.add(latitude);
        locationGroup.add(longitude);

        const saveRow = new Adw.ActionRow();
        const saveLocation = new Gtk.Button({label: text('Standort übernehmen', 'Apply location')});
        saveRow.add_suffix(saveLocation);
        saveRow.activatable_widget = saveLocation;
        locationGroup.add(saveRow);

        const savedGroup = new Adw.PreferencesGroup({
            title: text('Gespeicherte Orte', 'Saved locations'),
        });
        const saveCurrentRow = new Adw.ActionRow({
            title: text('Aktuellen Ort merken', 'Save current location'),
        });
        const saveCurrent = new Gtk.Button({label: text('Hinzufügen', 'Add')});
        saveCurrentRow.add_suffix(saveCurrent);
        saveCurrentRow.activatable_widget = saveCurrent;
        savedGroup.add(saveCurrentRow);

        const displayGroup = new Adw.PreferencesGroup({title: text('Anzeige', 'Display')});
        const fahrenheit = new Adw.SwitchRow({title: text('Fahrenheit verwenden', 'Use Fahrenheit')});
        settings.bind('use-fahrenheit', fahrenheit, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(fahrenheit);

        const feelsLike = new Adw.SwitchRow({title: text('Gefühlte Temperatur zeigen', 'Show feels-like temperature')});
        settings.bind('show-feels-like', feelsLike, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(feelsLike);

        const details = new Adw.SwitchRow({
            title: text('Sonnenzeiten und UV-Index zeigen', 'Show sunrise, sunset and UV index'),
        });
        settings.bind('show-details', details, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(details);

        const palettes = [
            ['violett', text('Violett', 'Violet')],
            ['blau', text('Blau', 'Blue')],
            ['petrol', text('Petrol', 'Teal')],
            ['gruen', text('Grün', 'Green')],
            ['bordeaux', 'Bordeaux'],
            ['sonnenuntergang', text('Sonnenuntergang', 'Sunset')],
            ['graphit', text('Graphit', 'Graphite')],
            ['nacht', text('Nacht', 'Night')],
        ];
        const paletteRow = new Adw.ComboRow({
            title: text('Farbschema', 'Color scheme'),
            model: Gtk.StringList.new(palettes.map(([, title]) => title)),
        });
        const paletteIndex = palettes.findIndex(([id]) => id === settings.get_string('color-scheme'));
        paletteRow.selected = paletteIndex < 0 ? 0 : paletteIndex;
        paletteRow.connect('notify::selected', () => {
            const selected = palettes[paletteRow.selected];
            if (selected)
                settings.set_string('color-scheme', selected[0]);
        });
        displayGroup.add(paletteRow);

        const intervals = [10, 15, 30, 60, 120];
        const intervalModel = Gtk.StringList.new(intervals.map(minutes =>
            text(`Alle ${minutes} Minuten`, `Every ${minutes} minutes`)));
        const intervalRow = new Adw.ComboRow({
            title: text('Aktualisierungsintervall', 'Update interval'),
            model: intervalModel,
        });
        intervalRow.selected = Math.max(0, intervals.indexOf(settings.get_int('update-interval')));
        intervalRow.connect('notify::selected', () => {
            const minutes = intervals[intervalRow.selected];
            if (minutes)
                settings.set_int('update-interval', minutes);
        });
        displayGroup.add(intervalRow);

        page.add(locationGroup);
        page.add(resultsGroup);
        page.add(savedGroup);
        page.add(displayGroup);
        window.add(page);

        const session = new Soup.Session();
        let searchCancellable = null;
        const clearResults = () => {
            let child = resultsGroup.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                resultsGroup.remove(child);
                child = next;
            }
        };
        const savePlace = () => {
            const lat = Number(latitude.text.trim());
            const lon = Number(longitude.text.trim());
            const placeName = name.text.trim();
            if (!placeName || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
                !Number.isFinite(lon) || lon < -180 || lon > 180) {
                saveRow.subtitle = text(
                    'Bitte Ortsname und gültige Koordinaten eingeben (Breite −90 bis 90, Länge −180 bis 180).',
                    'Enter a place name and valid coordinates (latitude −90 to 90, longitude −180 to 180).');
                return;
            }
            settings.set_string('location-name', placeName);
            settings.set_double('latitude', lat);
            settings.set_double('longitude', lon);
            saveRow.subtitle = text('Wetterdaten werden aktualisiert.', 'Weather is updating.');
        };
        const refreshSavedPlaces = () => {
            let child = saveCurrentRow.get_next_sibling();
            while (child) {
                const next = child.get_next_sibling();
                savedGroup.remove(child);
                child = next;
            }

            for (const place of parsePlaces(settings)) {
                const row = new Adw.ActionRow({
                    title: place.name,
                    subtitle: `${Number(place.latitude).toFixed(4)}, ${Number(place.longitude).toFixed(4)}`,
                });
                const use = new Gtk.Button({
                    label: text('Verwenden', 'Use'),
                    valign: Gtk.Align.CENTER,
                });
                const remove = new Gtk.Button({
                    label: text('Entfernen', 'Remove'),
                    valign: Gtk.Align.CENTER,
                });
                use.connect('clicked', () => {
                    name.text = place.name;
                    latitude.text = String(place.latitude);
                    longitude.text = String(place.longitude);
                    savePlace();
                });
                remove.connect('clicked', () => {
                    const places = parsePlaces(settings).filter(item =>
                        Math.abs(item.latitude - place.latitude) > 1e-4 ||
                        Math.abs(item.longitude - place.longitude) > 1e-4);
                    settings.set_string('places', JSON.stringify(places));
                    refreshSavedPlaces();
                });
                row.add_suffix(use);
                row.add_suffix(remove);
                savedGroup.add(row);
            }
        };
        const addCurrentPlace = () => {
            const lat = settings.get_double('latitude');
            const lon = settings.get_double('longitude');
            const placeName = settings.get_string('location-name').trim();
            if (!placeName) {
                saveCurrentRow.subtitle = text('Der Ortsname darf nicht leer sein.', 'Place name cannot be empty.');
                return;
            }
            const places = parsePlaces(settings);
            const existing = places.findIndex(place =>
                Math.abs(place.latitude - lat) < 1e-4 && Math.abs(place.longitude - lon) < 1e-4);
            const place = {name: placeName, latitude: lat, longitude: lon};
            if (existing >= 0)
                places[existing] = place;
            else
                places.push(place);
            settings.set_string('places', JSON.stringify(places));
            saveCurrentRow.subtitle = text('Ort gespeichert.', 'Location saved.');
            refreshSavedPlaces();
        };

        saveLocation.connect('clicked', savePlace);
        saveCurrent.connect('clicked', addCurrentPlace);
        searchButton.connect('clicked', () => {
            searchCancellable?.cancel();
            searchCancellable = new Gio.Cancellable();
            clearResults();
            searchStatus.subtitle = text('Suche läuft …', 'Searching …');
            searchButton.sensitive = false;
            const language = isGerman() ? 'de' : 'en';
            let url;
            try {
                url = geocodingUrl(searchRow.text, language);
            } catch (error) {
                searchButton.sensitive = true;
                searchStatus.subtitle = text(
                    'Bitte mindestens zwei Zeichen eingeben.',
                    'Enter at least two characters.');
                return;
            }
            const message = Soup.Message.new('GET', url);
            const cancellable = searchCancellable;
            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (httpSession, result) => {
                    try {
                        const bytes = httpSession.send_and_read_finish(result);
                        if (searchCancellable !== cancellable || cancellable.is_cancelled())
                            return;
                        searchButton.sensitive = true;
                        if (message.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP ${message.get_status()}: ${message.get_reason_phrase()}`);
                        const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        const matches = parseGeocodingResults(data);
                        clearResults();
                        if (!matches.length) {
                            searchStatus.subtitle = text('Keine Orte gefunden.', 'No places found.');
                            return;
                        }

                        searchStatus.subtitle = text(
                            `${matches.length} Treffer – einen auswählen und übernehmen.`,
                            `${matches.length} results – select one and apply it.`);
                        for (const place of matches) {
                            const address = [place.admin1, place.country].filter(Boolean).join(', ');
                            const row = new Adw.ActionRow({
                                title: place.name,
                                subtitle: address,
                                activatable: true,
                            });
                            row.connect('activated', () => {
                                name.text = place.name;
                                latitude.text = String(place.latitude);
                                longitude.text = String(place.longitude);
                                saveRow.subtitle = text(
                                    'Treffer ausgewählt. Mit „Standort übernehmen“ speichern.',
                                    'Place selected. Click “Apply location” to save it.');
                            });
                            resultsGroup.add(row);
                        }
                    } catch (error) {
                        if (searchCancellable !== cancellable || cancellable.is_cancelled())
                            return;
                        searchButton.sensitive = true;
                        searchStatus.subtitle = text(
                            `Suche fehlgeschlagen: ${error.message}`,
                            `Search failed: ${error.message}`);
                        console.error(`TuX-Wetter: ${error.message}`);
                    }
                });
        });

        refreshSavedPlaces();
        window.connect('close-request', () => {
            searchCancellable?.cancel();
            session.abort();
            return false;
        });
    }
}

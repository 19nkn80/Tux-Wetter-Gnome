// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {geocodingUrl, parseGeocodingResults} from './weather.js';
import {WEATHER_PROVIDERS} from './providers.js';
import {checkForUpdate, installUpdate, requestLogout} from './update-service.js';
import {IP_LOCATION_URL, parseIpLocation} from './location.js';
import {displayError} from './errors.js';
import {isGerman, text} from './ui-language.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.tuxwetter';

function parsePlaces(settings) {
    try {
        const places = JSON.parse(settings.get_string('places'));
        return Array.isArray(places)
            ? places.filter(place => place && typeof place.name === 'string'
                && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90
                && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180)
                .map(place => ({
                    ...place,
                    countryCode: typeof place.countryCode === 'string'
                        ? place.countryCode.toUpperCase()
                        : '',
                    postcodes: Array.isArray(place.postcodes)
                        ? place.postcodes.filter(code => typeof code === 'string')
                        : [],
                }))
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
        name.set_tooltip_text(text(
            'Dieses Feld ändert nur die Beschriftung, nicht die Koordinaten.',
            'This field changes only the label, not the coordinates.'));
        latitude.text = String(settings.get_double('latitude'));
        longitude.text = String(settings.get_double('longitude'));
        let selectedLatitude = settings.get_double('latitude');
        let selectedLongitude = settings.get_double('longitude');
        let selectedCountryCode = settings.get_string('location-country');
        let selectedPostcodes = [];
        try {
            const postcodes = JSON.parse(settings.get_string('location-postcodes'));
            if (Array.isArray(postcodes))
                selectedPostcodes = postcodes.filter(code => typeof code === 'string');
        } catch (error) {
            console.error(`TuX-Wetter: Could not read location postal codes: ${error.message}`);
        }
        locationGroup.add(name);
        locationGroup.add(latitude);
        locationGroup.add(longitude);

        const saveRow = new Adw.ActionRow();
        const saveLocation = new Gtk.Button({label: text('Standort übernehmen', 'Apply location')});
        saveRow.add_suffix(saveLocation);
        saveRow.activatable_widget = saveLocation;
        locationGroup.add(saveRow);

        const automaticLocation = new Adw.SwitchRow({
            title: text('Standort automatisch über IP bestimmen',
                'Determine location automatically using IP'),
            subtitle: text(
                'Optional: Die öffentliche IP-Adresse wird an ipapi.co gesendet. Standardmäßig aus.',
                'Optional: Your public IP address is sent to ipapi.co. Disabled by default.'),
        });
        settings.bind(
            'automatic-location',
            automaticLocation,
            'active',
            Gio.SettingsBindFlags.DEFAULT);
        locationGroup.add(automaticLocation);

        const locateRow = new Adw.ActionRow({
            title: text('Aktuellen Standort erkennen', 'Detect current location'),
        });
        const locateButton = new Gtk.Button({
            label: text('Jetzt erkennen', 'Detect now'),
            valign: Gtk.Align.CENTER,
        });
        locateRow.add_suffix(locateButton);
        locateRow.activatable_widget = locateButton;
        locationGroup.add(locateRow);

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

        const lightCard = new Adw.SwitchRow({
            title: text('Helle Karte verwenden', 'Use a light weather card'),
        });
        settings.bind('light-card', lightCard, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(lightCard);

        const showMoon = new Adw.SwitchRow({
            title: text('Mondphase und Mondzeiten zeigen', 'Show moon phase and moon rise/set'),
        });
        settings.bind('show-moon', showMoon, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showMoon);

        const showAirQuality = new Adw.SwitchRow({
            title: text('Luftqualität und Pollen zeigen', 'Show air quality and pollen'),
        });
        settings.bind('show-air-quality', showAirQuality, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showAirQuality);

        const showRainDetails = new Adw.SwitchRow({
            title: text('Regenvorschau in 15-Minuten-Schritten zeigen',
                'Show 15-minute rain outlook'),
        });
        settings.bind('show-rain-details', showRainDetails, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showRainDetails);

        const warningGroup = new Adw.PreferencesGroup({
            title: text('Amtliche Wetterwarnungen', 'Official weather warnings'),
            description: text(
                'DWD und GeoSphere werden über ihre Warn-APIs abgefragt. Für MeteoSwiss wird die undokumentierte App-Schnittstelle verwendet; sie kann sich ändern. Nicht erreichbare Quellen werden ausdrücklich als nicht verfügbar angezeigt.',
                'DWD and GeoSphere use their warning APIs. MeteoSwiss uses its undocumented app endpoint, which may change. Unreachable sources are explicitly reported as unavailable.'),
        });
        const showWarnings = new Adw.SwitchRow({
            title: text('Warnungen für alle gespeicherten Orte anzeigen',
                'Show warnings for all saved locations'),
        });
        settings.bind('show-warnings', showWarnings, 'active', Gio.SettingsBindFlags.DEFAULT);
        warningGroup.add(showWarnings);

        const warningNotifications = new Adw.SwitchRow({
            title: text('Bei neuen oder stärkeren Warnungen benachrichtigen',
                'Notify for new or stronger warnings'),
        });
        settings.bind(
            'warning-notifications',
            warningNotifications,
            'active',
            Gio.SettingsBindFlags.DEFAULT);
        warningGroup.add(warningNotifications);

        const warningLevels = [1, 2, 3];
        const warningLevelRow = new Adw.ComboRow({
            title: text('Mindestwarnstufe für Benachrichtigungen',
                'Minimum notification warning level'),
            model: Gtk.StringList.new(warningLevels.map(level =>
                text(`Stufe ${level}`, `Level ${level}`))),
        });
        warningLevelRow.selected = Math.max(
            0, warningLevels.indexOf(settings.get_int('minimum-warning-level')));
        warningLevelRow.connect('notify::selected', () => {
            const level = warningLevels[warningLevelRow.selected];
            if (level)
                settings.set_int('minimum-warning-level', level);
        });
        warningGroup.add(warningLevelRow);

        const providerGroup = new Adw.PreferencesGroup({
            title: text('Wetterdienst', 'Weather provider'),
            description: text(
                'DWD und MeteoSwiss verwenden Modelle über Open-Meteo. GeoSphere ist auf den Alpenraum begrenzt; dessen Prognose-API ist noch in der Vorabversion.',
                'DWD and MeteoSwiss use models through Open-Meteo. GeoSphere covers the Alpine region; its forecast API is still prerelease.'),
        });
        const providerRow = new Adw.ComboRow({
            title: text('Datenquelle', 'Data source'),
            model: Gtk.StringList.new(WEATHER_PROVIDERS.map(provider =>
                text(provider.labelDe, provider.labelEn))),
        });
        const providerIndex = WEATHER_PROVIDERS.findIndex(provider =>
            provider.id === settings.get_string('weather-provider'));
        providerRow.selected = providerIndex < 0 ? 0 : providerIndex;
        providerRow.connect('notify::selected', () => {
            const provider = WEATHER_PROVIDERS[providerRow.selected];
            if (provider)
                settings.set_string('weather-provider', provider.id);
        });
        providerGroup.add(providerRow);

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

        const updateGroup = new Adw.PreferencesGroup({
            title: text('Aktualisierungen', 'Updates'),
            description: text(
                'Prüft GitHub auf eine neuere Version. Ein Update wird nur nach deiner Zustimmung installiert.',
                'Checks GitHub for a newer version. Updates require your confirmation.'),
        });
        const installedVersion = this.metadata['version-name'] ?? String(this.metadata.version);
        const updateRow = new Adw.ActionRow({
            title: text('Installierte Version', 'Installed version'),
            subtitle: installedVersion,
        });
        const checkUpdates = new Gtk.Button({
            label: text('Jetzt suchen', 'Check now'),
            valign: Gtk.Align.CENTER,
        });
        updateRow.add_suffix(checkUpdates);
        updateRow.activatable_widget = checkUpdates;
        updateGroup.add(updateRow);

        const updateStatus = new Adw.ActionRow({
            subtitle: text('Noch nicht geprüft.', 'Not checked yet.'),
        });
        updateGroup.add(updateStatus);

        const releaseRow = new Adw.ActionRow();
        const openRelease = new Gtk.Button({
            label: text('Release auf GitHub öffnen', 'Open release on GitHub'),
            valign: Gtk.Align.CENTER,
            sensitive: false,
        });
        releaseRow.add_suffix(openRelease);
        releaseRow.activatable_widget = openRelease;
        updateGroup.add(releaseRow);

        page.add(locationGroup);
        page.add(resultsGroup);
        page.add(savedGroup);
        page.add(displayGroup);
        page.add(warningGroup);
        page.add(providerGroup);
        page.add(updateGroup);
        window.add(page);

        const session = new Soup.Session();
        let searchCancellable = null;
        let updateCancellable = null;
        let locationCancellable = null;
        let releaseUrl = null;
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
            const metadataMatchesPoint = Math.abs(lat - selectedLatitude) < 1e-4 &&
                Math.abs(lon - selectedLongitude) < 1e-4;
            settings.set_string('location-name', placeName);
            settings.set_double('latitude', lat);
            settings.set_double('longitude', lon);
            settings.set_string(
                'location-country',
                metadataMatchesPoint ? selectedCountryCode : '');
            settings.set_string(
                'location-postcodes',
                JSON.stringify(metadataMatchesPoint ? selectedPostcodes : []));
            selectedLatitude = lat;
            selectedLongitude = lon;
            if (!metadataMatchesPoint) {
                selectedCountryCode = '';
                selectedPostcodes = [];
            }
            saveRow.subtitle = text('Wetterdaten werden aktualisiert.', 'Weather is updating.');
        };
        const locateByIp = () => {
            locationCancellable?.cancel();
            locationCancellable = new Gio.Cancellable();
            const cancellable = locationCancellable;
            locateButton.sensitive = false;
            locateRow.subtitle = text('Standort wird ermittelt …', 'Detecting location …');
            const message = Soup.Message.new('GET', IP_LOCATION_URL);
            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (httpSession, result) => {
                    try {
                        const bytes = httpSession.send_and_read_finish(result);
                        if (locationCancellable !== cancellable || cancellable.is_cancelled())
                            return;
                        if (message.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP-Fehler ${message.get_status()}`);
                        const location = parseIpLocation(
                            JSON.parse(new TextDecoder().decode(bytes.get_data())));
                        name.text = location.name || name.text;
                        latitude.text = String(location.latitude);
                        longitude.text = String(location.longitude);
                        selectedCountryCode = location.countryCode;
                        selectedPostcodes = location.postcodes;
                        selectedLatitude = location.latitude;
                        selectedLongitude = location.longitude;
                        savePlace();
                        locateRow.subtitle = text(
                            `Standort von ${location.name || 'IP-Adresse'} übernommen.`,
                            `Location from ${location.name || 'IP address'} applied.`);
                    } catch (error) {
                        if (locationCancellable !== cancellable || cancellable.is_cancelled())
                            return;
                        locateRow.subtitle = text(
                            `Standortbestimmung fehlgeschlagen: ${displayError(error)}`,
                            `Location detection failed: ${error.message}`);
                        console.error(`TuX-Wetter: ${error.message}`);
                    } finally {
                        if (locationCancellable === cancellable)
                            locateButton.sensitive = true;
                    }
                });
        };
        locateButton.connect('clicked', locateByIp);
        automaticLocation.connect('notify::active', () => {
            if (automaticLocation.active)
                locateByIp();
        });
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
                    selectedLatitude = place.latitude;
                    selectedLongitude = place.longitude;
                    selectedCountryCode = place.countryCode;
                    selectedPostcodes = place.postcodes;
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
            const place = {
                name: placeName,
                latitude: lat,
                longitude: lon,
                countryCode: settings.get_string('location-country'),
                postcodes: (() => {
                    try {
                        const values = JSON.parse(settings.get_string('location-postcodes'));
                        return Array.isArray(values) ? values : [];
                    } catch (error) {
                        console.error(`TuX-Wetter: Could not read location postal codes: ${error.message}`);
                        return [];
                    }
                })(),
            };
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
        const showUpdateResult = (heading, body, offerLogout = false) => {
            const result = new Adw.AlertDialog({heading, body});
            result.add_response('later', offerLogout ? 'Jetzt nicht abmelden' : 'Schließen');
            result.set_default_response('later');
            result.set_close_response('later');
            if (offerLogout) {
                result.add_response('logout', 'Abmelden');
                result.connect('response', async (_dialog, response) => {
                    if (response !== 'logout')
                        return;
                    try {
                        await requestLogout();
                    } catch (error) {
                        console.error(`TuX-Wetter: Abmelden fehlgeschlagen: ${error.message}`);
                        updateStatus.subtitle = 'Abmelden fehlgeschlagen. Bitte das Systemmenü verwenden.';
                        showUpdateResult('Abmelden fehlgeschlagen',
                            'Bitte melde dich über das Systemmenü ab.');
                    }
                });
            }
            result.present(window);
        };
        const checkForUpdates = async () => {
            updateCancellable?.cancel();
            updateCancellable = new Gio.Cancellable();
            const cancellable = updateCancellable;
            checkUpdates.sensitive = false;
            openRelease.sensitive = false;
            releaseUrl = null;
            updateStatus.subtitle = text('GitHub wird geprüft …', 'Checking GitHub …');

            try {
                const release = await checkForUpdate(session, installedVersion, cancellable);
                if (updateCancellable !== cancellable || cancellable.is_cancelled())
                    return;
                if (!release) {
                    updateStatus.subtitle = 'Du verwendest bereits die aktuelle Version.';
                    return;
                }

                releaseUrl = release.url;
                updateStatus.subtitle = `Version ${release.version} ist verfügbar.`;
                openRelease.sensitive = true;
                const dialog = new Adw.AlertDialog({
                    heading: `TuX-Wetter ${release.version} ist verfügbar`,
                    body: 'Das Update von GitHub herunterladen und installieren? '
                        + 'Deine Einstellungen bleiben erhalten. Anschließend bitte ab- und wieder anmelden.',
                });
                dialog.add_response('cancel', 'Abbrechen');
                dialog.add_response('update', 'Update');
                dialog.set_default_response('cancel');
                dialog.set_close_response('cancel');
                dialog.connect('response', async (_dialog, response) => {
                    if (response !== 'update' || cancellable.is_cancelled())
                        return;
                    checkUpdates.sensitive = false;
                    updateStatus.subtitle = 'Update wird heruntergeladen und installiert …';
                    try {
                        await installUpdate(session, release, cancellable);
                        if (!cancellable.is_cancelled()) {
                            updateStatus.subtitle = 'Update installiert. Bitte ab- und wieder anmelden.';
                            showUpdateResult(
                                'Update erfolgreich',
                                `TuX-Wetter ${release.version} wurde installiert. `
                                    + 'Bitte abmelden und wieder anmelden, um die neue Version zu laden.',
                                true);
                        }
                    } catch (error) {
                        if (!cancellable.is_cancelled()) {
                            updateStatus.subtitle = `Update fehlgeschlagen: ${displayError(error)}`;
                            console.error(`TuX-Wetter: Update fehlgeschlagen: ${error.message}`);
                            showUpdateResult('Update fehlgeschlagen',
                                `${displayError(error)} Bitte versuche es erneut oder installiere das ZIP manuell.`);
                        }
                    } finally {
                        if (updateCancellable === cancellable)
                            checkUpdates.sensitive = true;
                    }
                });
                dialog.present(window);
            } catch (error) {
                if (updateCancellable !== cancellable || cancellable.is_cancelled())
                    return;
                updateStatus.subtitle = `Update-Prüfung fehlgeschlagen: ${displayError(error)}`;
                console.error(`TuX-Wetter: ${error.message}`);
            } finally {
                if (updateCancellable === cancellable)
                    checkUpdates.sensitive = true;
            }
        };
        checkUpdates.connect('clicked', checkForUpdates);
        openRelease.connect('clicked', () => {
            if (!releaseUrl)
                return;
            try {
                if (!Gio.AppInfo.launch_default_for_uri(releaseUrl, null))
                    throw new Error('Zum Öffnen der Release-Seite ist keine Anwendung verfügbar.');
            } catch (error) {
                updateStatus.subtitle = text(
                    `GitHub konnte nicht geöffnet werden: ${displayError(error)}`,
                    `Could not open GitHub: ${error.message}`);
                console.error(`TuX-Wetter: ${error.message}`);
            }
        });
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
                            throw new Error(`HTTP-Fehler ${message.get_status()}`);
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
                                selectedCountryCode = String(place.country_code ?? '').toUpperCase();
                                selectedPostcodes = Array.isArray(place.postcodes)
                                    ? place.postcodes.filter(code => typeof code === 'string')
                                    : [];
                                selectedLatitude = place.latitude;
                                selectedLongitude = place.longitude;
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
                            `Suche fehlgeschlagen: ${displayError(error)}`,
                            `Search failed: ${error.message}`);
                        console.error(`TuX-Wetter: ${error.message}`);
                    }
                });
        });

        refreshSavedPlaces();
        checkForUpdates();
        window.connect('close-request', () => {
            searchCancellable?.cancel();
            updateCancellable?.cancel();
            locationCancellable?.cancel();
            session.abort();
            return false;
        });
    }
}

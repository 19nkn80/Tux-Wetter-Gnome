// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {conditionForCode, iconForCode} from './weather.js';
import {
    forecastRequest,
    parseProviderForecast,
    WEATHER_PROVIDERS,
} from './providers.js';
import {
    dwdWarningsUrl,
    dwdZonesUrl,
    geoSphereWarningsUrl,
    meteoswissWarningsRequest,
    parseDwdWarnings,
    parseDwdZones,
    parseGeoSphereWarnings,
    parseMeteoSwissWarnings,
    warningIdentity,
} from './warnings.js';
import {IP_LOCATION_URL, parseIpLocation} from './location.js';
import {displayError} from './errors.js';
import {isGerman, text} from './ui-language.js';
import {
    airQualityLevel,
    airQualityRequestUrl,
    moonRequestUrl,
    parseAirQuality,
    parseMoonData,
    parsePrecipitation15,
    precipitation15RequestUrl,
} from './supplementary.js';

function formatTemperature(value, fahrenheit) {
    const converted = fahrenheit ? value * 9 / 5 + 32 : value;
    return `${Math.round(converted)}°${fahrenheit ? 'F' : 'C'}`;
}

function shortDay(date) {
    const localDate = new Date(`${date}T12:00:00`);
    return new Intl.DateTimeFormat(isGerman() ? 'de' : 'en', {weekday: 'short'}).format(localDate);
}

export default class TuxWetterExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.tuxwetter');
        this._theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        this._stylesheet = Gio.File.new_for_path(
            GLib.build_filenamev([this.path, 'stylesheet.css']));
        if (this._stylesheet)
            this._theme.load_stylesheet(this._stylesheet);
        this._session = new Soup.Session();
        this._cancellable = null;
        this._requestSerial = 0;
        this._retryCount = 0;
        this._forecast = null;
        this._selectedForecastDate = null;
        this._error = null;
        this._lastUpdated = null;
        this._warningResults = new Map();
        this._warningSerial = 0;
        this._warningCancellable = null;
        this._dwdWarningsPromise = null;
        this._locationCancellable = null;
        this._lastIpLocationCheck = 0;
        this._locationError = null;
        this._supplementary = {moon: null, rain: null, air: null};
        this._supplementaryUpdated = {moon: 0, rain: 0, air: 0};
        this._supplementaryErrors = {};
        this._supplementaryCancellable = null;
        this._supplementarySerial = 0;
        this._supplementaryLocationKey = '';
        this._loadSupplementaryCache();

        this._button = new PanelMenu.Button(0.0, 'TuX-Wetter', false);
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: 'weather-few-clouds-symbolic',
            style_class: 'system-status-icon',
        });
        this._temperature = new St.Label({
            text: '—°',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icon);
        box.add_child(this._temperature);
        this._button.add_child(box);

        this._button.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this._render();
        });
        this._button.connect('scroll-event', (_button, event) => {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP) {
                this._cyclePlace(-1);
                return Clutter.EVENT_STOP;
            }
            if (direction === Clutter.ScrollDirection.DOWN) {
                this._cyclePlace(1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._button.connect('button-press-event', (_button, event) => {
            if (event.get_button() !== 3)
                return Clutter.EVENT_PROPAGATE;
            this._cyclePlace(1);
            return Clutter.EVENT_STOP;
        });
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'latitude' || key === 'longitude' || key === 'weather-provider' ||
                key === 'location-country' || key === 'location-postcodes') {
                this._forecast = null;
                this._lastUpdated = null;
                this._retryCount = 0;
                this._refresh();
            } else if (key === 'places' || key === 'show-warnings' ||
                key === 'minimum-warning-level' || key === 'warning-notifications') {
                this._refreshWarnings();
                this._render();
            } else if (key === 'show-moon' || key === 'show-air-quality' ||
                key === 'show-rain-details') {
                this._refreshSupplementary();
                this._render();
            } else if (key === 'automatic-location') {
                this._lastIpLocationCheck = 0;
                this._refreshAutomaticLocation();
            } else if (key === 'location-name') {
                this._refresh();
            } else {
                this._render();
                if (key === 'update-interval')
                    this._scheduleRefresh();
            }
        });
        this._buttonAdded = false;
        this._refresh();
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._buttonAdded = true;
    }

    disable() {
        if (this._refreshTimeout) {
            GLib.source_remove(this._refreshTimeout);
            this._refreshTimeout = 0;
        }
        if (this._retryTimeout) {
            GLib.source_remove(this._retryTimeout);
            this._retryTimeout = 0;
        }
        this._requestSerial++;
        this._warningSerial++;
        this._cancellable?.cancel();
        this._warningCancellable?.cancel();
        this._locationCancellable?.cancel();
        this._supplementaryCancellable?.cancel();
        this._session?.abort();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._buttonAdded) {
            this._button.destroy();
            this._buttonAdded = false;
        }
        if (this._stylesheet) {
            this._theme.unload_stylesheet(this._stylesheet);
            this._stylesheet = null;
        }
        this._button = null;
        this._session = null;
        this._theme = null;
        this._settings = null;
    }

    _scheduleRefresh() {
        if (this._refreshTimeout)
            GLib.source_remove(this._refreshTimeout);
        const minutes = this._settings.get_int('update-interval');
        this._refreshTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _currentPlace() {
        let postcodes = [];
        try {
            const parsed = JSON.parse(this._settings.get_string('location-postcodes'));
            if (Array.isArray(parsed))
                postcodes = parsed.filter(code => typeof code === 'string');
        } catch (error) {
            console.error(`TuX-Wetter: Could not read location postal codes: ${error.message}`);
        }
        return {
            name: this._settings.get_string('location-name'),
            latitude: this._settings.get_double('latitude'),
            longitude: this._settings.get_double('longitude'),
            countryCode: this._settings.get_string('location-country'),
            postcodes,
        };
    }

    _allPlaces() {
        const places = this._getPlaces();
        const current = this._currentPlace();
        if (!places.some(place =>
            Math.abs(place.latitude - current.latitude) < 1e-4 &&
            Math.abs(place.longitude - current.longitude) < 1e-4))
            places.unshift(current);
        return places;
    }

    _warningKey(place) {
        return `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
    }

    _requestText(url, headers, cancellable) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            for (const [name, value] of Object.entries(headers ?? {}))
                message.request_headers.append(name, value);
            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP-Fehler ${message.get_status()}`);
                        resolve(new TextDecoder().decode(bytes.get_data()));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    async _requestJson(url, headers, cancellable) {
        const body = await this._requestText(url, headers, cancellable);
        try {
            return JSON.parse(body);
        } catch (error) {
            console.error(`TuX-Wetter: Antwort konnte nicht gelesen werden: ${error.message}`);
            throw new Error('Die Antwort des Dienstes konnte nicht gelesen werden.');
        }
    }

    _supplementaryCacheFile() {
        return GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'tux-wetter',
            'supplementary.json',
        ]);
    }

    _loadSupplementaryCache() {
        const locationKey = `${this._settings.get_double('latitude').toFixed(4)},`
            + `${this._settings.get_double('longitude').toFixed(4)}`;
        this._supplementaryLocationKey = locationKey;
        const path = this._supplementaryCacheFile();
        if (!Gio.File.new_for_path(path).query_exists(null))
            return;

        try {
            const [success, bytes] = GLib.file_get_contents(path);
            if (!success)
                throw new Error('Could not read the supplementary weather cache');
            const cached = JSON.parse(new TextDecoder().decode(bytes));
            if (cached.locationKey !== locationKey)
                return;
            const forecastTime = new Date(cached.forecastUpdatedAt);
            if (cached.forecast && cached.forecastProvider ===
                this._settings.get_string('weather-provider') &&
                !Number.isNaN(forecastTime.getTime()) &&
                Date.now() - forecastTime.getTime() < 24 * 60 * 60 * 1000) {
                this._forecast = cached.forecast;
                this._lastUpdated = forecastTime;
            }
            for (const kind of ['moon', 'rain', 'air']) {
                if (cached.data?.[kind] && Number.isFinite(cached.updated?.[kind])) {
                    this._supplementary[kind] = cached.data[kind];
                    this._supplementaryUpdated[kind] = cached.updated[kind];
                }
            }
        } catch (error) {
            console.error(`TuX-Wetter: Could not load cached supplementary weather: ${error.message}`);
        }
    }

    _saveSupplementaryCache() {
        const path = this._supplementaryCacheFile();
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
            const saved = GLib.file_set_contents(path, JSON.stringify({
                locationKey: this._supplementaryLocationKey,
                data: this._supplementary,
                updated: this._supplementaryUpdated,
                forecast: this._forecast,
                forecastProvider: this._settings.get_string('weather-provider'),
                forecastUpdatedAt: this._lastUpdated?.toISOString() ?? null,
            }));
            if (!saved)
                throw new Error('Could not write the supplementary weather cache');
        } catch (error) {
            console.error(`TuX-Wetter: Could not save supplementary weather cache: ${error.message}`);
        }
    }

    _refreshSupplementary() {
        if (!this._settings || !this._session)
            return;

        const locationKey = `${this._settings.get_double('latitude').toFixed(4)},`
            + `${this._settings.get_double('longitude').toFixed(4)}`;
        if (locationKey !== this._supplementaryLocationKey) {
            this._supplementary = {moon: null, rain: null, air: null};
            this._supplementaryUpdated = {moon: 0, rain: 0, air: 0};
            this._supplementaryErrors = {};
            this._supplementaryLocationKey = locationKey;
            this._loadSupplementaryCache();
        }

        const latitude = this._settings.get_double('latitude');
        const longitude = this._settings.get_double('longitude');
        const now = Date.now();
        const nowByZone = (timeZone) => new Intl.DateTimeFormat('en-CA', {timeZone}).format(new Date());
        const moonExpired = this._supplementary.moon &&
            this._supplementary.moon.date !== nowByZone(this._supplementary.moon.timeZone || 'UTC');
        const requests = [];
        if (this._settings.get_boolean('show-moon') &&
            (moonExpired || now - this._supplementaryUpdated.moon >= 24 * 60 * 60 * 1000)) {
            requests.push(['moon', moonRequestUrl(latitude, longitude), parseMoonData]);
        }
        if (this._settings.get_boolean('show-rain-details') &&
            now - this._supplementaryUpdated.rain >= 15 * 60 * 1000) {
            requests.push(['rain', precipitation15RequestUrl(latitude, longitude), parsePrecipitation15]);
        }
        if (this._settings.get_boolean('show-air-quality') &&
            now - this._supplementaryUpdated.air >= 60 * 60 * 1000) {
            requests.push(['air', airQualityRequestUrl(latitude, longitude), parseAirQuality]);
        }
        if (!requests.length) {
            this._supplementaryCancellable?.cancel();
            this._supplementarySerial++;
            return;
        }

        this._supplementaryCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._supplementaryCancellable = cancellable;
        const serial = ++this._supplementarySerial;
        for (const [kind, url, parser] of requests)
            this._loadSupplementary(kind, url, parser, serial, cancellable);
    }

    async _loadSupplementary(kind, url, parser, serial, cancellable) {
        try {
            const data = await this._requestJson(url, {}, cancellable);
            if (serial !== this._supplementarySerial || cancellable.is_cancelled())
                return;
            this._supplementary[kind] = kind === 'rain'
                ? parser(data, new Date())
                : parser(data);
            this._supplementaryUpdated[kind] = Date.now();
            delete this._supplementaryErrors[kind];
            this._saveSupplementaryCache();
        } catch (error) {
            if (serial !== this._supplementarySerial || cancellable.is_cancelled())
                return;
            this._supplementaryErrors[kind] = displayError(error);
            console.error(`TuX-Wetter: Could not load ${kind} data: ${error.message}`);
        }
        if (serial === this._supplementarySerial)
            this._render();
    }

    _refreshWarnings() {
        if (!this._settings || !this._session)
            return;

        this._warningSerial++;
        const serial = this._warningSerial;
        this._warningCancellable?.cancel();
        this._warningCancellable = new Gio.Cancellable();
        this._dwdWarningsPromise = null;

        if (!this._settings.get_boolean('show-warnings')) {
            this._warningResults.clear();
            this._render();
            return;
        }

        for (const place of this._allPlaces()) {
            this._warningResults.delete(this._warningKey(place));
            this._loadPlaceWarnings(place, serial, this._warningCancellable);
        }
    }

    async _loadPlaceWarnings(place, serial, cancellable) {
        const country = (place.countryCode ?? '').toUpperCase();
        try {
            let warnings;
            if (country === 'AT') {
                const data = await this._requestJson(
                    geoSphereWarningsUrl(place.latitude, place.longitude, 'de'),
                    {},
                    cancellable);
                warnings = parseGeoSphereWarnings(data);
            } else if (country === 'DE') {
                const zones = await this._requestJson(
                    dwdZonesUrl(place.latitude, place.longitude),
                    {},
                    cancellable);
                const cellIds = parseDwdZones(zones, place.latitude, place.longitude);
                if (!cellIds.length)
                    throw new Error('Der DWD hat für diesen Ort kein Warngebiet gefunden.');
                const warningData = await this._getDwdWarnings(cancellable);
                warnings = parseDwdWarnings(warningData, cellIds);
            } else if (country === 'CH') {
                const request = meteoswissWarningsRequest(place.postcodes ?? []);
                let lastError = null;
                for (const url of request.urls) {
                    try {
                        const data = await this._requestJson(url, request.headers, cancellable);
                        warnings = parseMeteoSwissWarnings(data);
                        lastError = null;
                        break;
                    } catch (error) {
                        if (cancellable.is_cancelled())
                            return;
                        lastError = error;
                    }
                }
                if (lastError)
                    throw lastError;
            } else {
                this._warningResults.set(this._warningKey(place), {
                    place,
                    status: 'unsupported',
                    warnings: [],
                    error: country
                        ? text(`Keine Warnquelle für ${country} konfiguriert.`,
                            `No warning source configured for ${country}.`)
                        : text('Land unbekannt; Ort bitte über die Suche neu auswählen.',
                            'Country unknown; select this place again using search.'),
                });
                if (serial === this._warningSerial)
                    this._render();
                return;
            }

            if (cancellable.is_cancelled() || serial !== this._warningSerial)
                return;
            this._warningResults.set(this._warningKey(place), {
                place,
                status: 'available',
                warnings,
            });
            this._notifyWarnings(place, warnings);
        } catch (error) {
            if (cancellable.is_cancelled() || serial !== this._warningSerial)
                return;
            this._warningResults.set(this._warningKey(place), {
                place,
                status: 'unavailable',
                warnings: [],
                error: displayError(error),
            });
            console.error(`TuX-Wetter: Could not load warnings for ${place.name}: ${error.message}`);
        }
        if (serial === this._warningSerial)
            this._render();
    }

    _getDwdWarnings(cancellable) {
        if (!this._dwdWarningsPromise) {
            this._dwdWarningsPromise = this._requestText(
                dwdWarningsUrl(),
                {'User-Agent': 'TuXWetterGnome/0.2 (https://github.com/19nkn80/Tux-Wetter-Gnome)'},
                cancellable).catch(error => {
                this._dwdWarningsPromise = null;
                throw error;
            });
        }
        return this._dwdWarningsPromise;
    }

    _notifyWarnings(place, warnings) {
        if (!this._settings.get_boolean('warning-notifications'))
            return;

        let previous = {};
        try {
            previous = JSON.parse(this._settings.get_string('notified-warnings'));
            if (!previous || typeof previous !== 'object' || Array.isArray(previous))
                throw new Error('Stored warning history is not an object');
        } catch (error) {
            console.error(`TuX-Wetter: Could not read warning notification history: ${error.message}`);
            previous = {};
        }

        const prefix = `${this._warningKey(place)}:`;
        const active = Object.fromEntries(Object.entries(previous)
            .filter(([id]) => !id.startsWith(prefix)));
        const minimumLevel = this._settings.get_int('minimum-warning-level');
        for (const warning of warnings) {
            const id = `${prefix}${warningIdentity(warning)}`;
            active[id] = warning.level;
            const oldLevel = Number(previous[id] ?? 0);
            if (warning.level >= minimumLevel && warning.level > oldLevel) {
                Main.notify(
                    `${warning.title} · ${place.name}`,
                    warning.text || text('Amtliche Wetterwarnung', 'Official weather warning'));
            }
        }
        this._settings.set_string('notified-warnings', JSON.stringify(active));
    }

    _refresh() {
        if (!this._settings || !this._session)
            return;

        this._refreshAutomaticLocation();
        this._refreshSupplementary();
        if (this._retryTimeout) {
            GLib.source_remove(this._retryTimeout);
            this._retryTimeout = 0;
        }
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        const requestSerial = ++this._requestSerial;
        this._error = null;
        this._render();
        this._scheduleRefresh();
        this._refreshWarnings();

        const provider = this._settings.get_string('weather-provider');
        let request;
        try {
            request = forecastRequest(
                provider,
                this._settings.get_double('latitude'),
                this._settings.get_double('longitude'));
        } catch (error) {
            this._error = displayError(error);
            this._render();
            return;
        }

        const message = Soup.Message.new('GET', request.url);
        for (const [name, value] of Object.entries(request.headers))
            message.request_headers.append(name, value);
        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (requestSerial !== this._requestSerial)
                        return;
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP-Fehler ${message.get_status()}`);
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    this._forecast = parseProviderForecast(data, provider);
                    this._lastUpdated = new Date();
                    this._error = null;
                    this._retryCount = 0;
                    this._saveSupplementaryCache();
                } catch (error) {
                    if (requestSerial === this._requestSerial && !cancellable.is_cancelled()) {
                        this._error = displayError(error);
                        console.error(`TuX-Wetter: ${error.message}`);
                        const status = message.get_status();
                        if (status < 400 || status >= 500)
                            this._scheduleRetry();
                    } else {
                        return;
                    }
                }
                this._render();
            });
    }

    _refreshAutomaticLocation() {
        if (!this._settings?.get_boolean('automatic-location') || !this._session)
            return;
        if (Date.now() - this._lastIpLocationCheck < 60 * 60 * 1000)
            return;

        this._lastIpLocationCheck = Date.now();
        this._locationCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._locationCancellable = cancellable;
        const message = Soup.Message.new('GET', IP_LOCATION_URL);
        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (this._locationCancellable !== cancellable || cancellable.is_cancelled())
                        return;
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP-Fehler ${message.get_status()}`);
                    const location = parseIpLocation(
                        JSON.parse(new TextDecoder().decode(bytes.get_data())));
                    this._locationError = null;
                    const moved = Math.abs(location.latitude - this._settings.get_double('latitude')) > 0.02 ||
                        Math.abs(location.longitude - this._settings.get_double('longitude')) > 0.02;
                    if (moved) {
                        this._settings.delay();
                        this._settings.set_string(
                            'location-name', location.name || this._settings.get_string('location-name'));
                        this._settings.set_double('latitude', location.latitude);
                        this._settings.set_double('longitude', location.longitude);
                        this._settings.set_string('location-country', location.countryCode);
                        this._settings.set_string('location-postcodes', JSON.stringify(location.postcodes));
                        this._settings.apply();
                    }
                } catch (error) {
                    if (this._locationCancellable !== cancellable || cancellable.is_cancelled())
                        return;
                    this._locationError = displayError(error);
                    console.error(`TuX-Wetter: Automatic IP location failed: ${error.message}`);
                }
                this._render();
            });
    }

    _scheduleRetry() {
        if (this._retryTimeout)
            GLib.source_remove(this._retryTimeout);
        const delay = Math.min(300, 15 * 2 ** this._retryCount);
        this._retryCount++;
        this._retryTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._retryTimeout = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        if (!this._button)
            return;

        const fahrenheit = this._settings.get_boolean('use-fahrenheit');
        const forecast = this._forecast;
        const location = this._settings.get_string('location-name');

        if (forecast) {
            this._temperature.text = formatTemperature(forecast.temperature, fahrenheit);
            this._icon.gicon = this._weatherGicon(iconForCode(forecast.code, forecast.isDay));
        } else {
            this._temperature.text = '—°';
        }

        const menu = this._button.menu;
        menu.removeAll();

        const cardItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'tuxwetter-card-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'tuxwetter-card',
        });
        const palette = this._settings.get_string('color-scheme');
        if (['violett', 'blau', 'petrol', 'gruen', 'bordeaux',
            'sonnenuntergang', 'graphit', 'nacht'].includes(palette))
            card.add_style_class_name(`tuxwetter-card-${palette}`);
        if (this._settings.get_boolean('light-card'))
            card.add_style_class_name('tuxwetter-card-light');
        cardItem.add_child(card);
        menu.addMenuItem(cardItem);

        const header = new St.BoxLayout({style_class: 'tuxwetter-header'});
        const placeLabel = this._label(location, 'tuxwetter-place');
        placeLabel.x_expand = true;
        header.add_child(placeLabel);
        const places = this._getPlaces();
        if (places.length > 1) {
            const index = this._placeIndex(places);
            header.add_child(this._iconButton(
                'go-previous-symbolic', 'tuxwetter-place-arrow', () => this._cyclePlace(-1)));
            header.add_child(this._label(
                index < 0 ? `– / ${places.length}` : `${index + 1} / ${places.length}`,
                'tuxwetter-place-count'));
            header.add_child(this._iconButton(
                'go-next-symbolic', 'tuxwetter-place-arrow', () => this._cyclePlace(1)));
        }
        card.add_child(header);

        if (forecast) {
            this._addCurrentWeather(card, forecast, fahrenheit);
            if (forecast.hours.length)
                this._addHourlyForecast(card, forecast.hours, fahrenheit);
            if (this._settings.get_boolean('show-details'))
                this._addSunInfo(card, forecast);
            if (this._settings.get_boolean('show-moon'))
                this._addMoonInfo(card);
            if (this._settings.get_boolean('show-air-quality'))
                this._addAirQuality(card);
            if (this._settings.get_boolean('show-rain-details'))
                this._addRainOutlook(card);
            if (forecast.days.length)
                this._addDailyForecast(card, forecast.days, fahrenheit, forecast.hourlyByDate);
        } else if (!this._error) {
            card.add_child(this._label(
                text('Wetterdaten werden geladen …', 'Loading weather …'),
                'tuxwetter-message'));
        }

        if (this._error)
            card.add_child(this._label(
                text(`Wetterdaten konnten nicht geladen werden: ${this._error}`,
                    `Could not load weather: ${this._error}`),
                'tuxwetter-error'));
        if (this._locationError)
            card.add_child(this._label(
                text(`Automatische Standortbestimmung fehlgeschlagen: ${this._locationError}`,
                    `Automatic location detection failed: ${this._locationError}`),
                'tuxwetter-error'));

        if (this._settings.get_boolean('show-warnings'))
            this._addOfficialWarnings(card);

        const footer = new St.BoxLayout({style_class: 'tuxwetter-footer'});
        const providerId = this._settings.get_string('weather-provider');
        const sourceInfo = WEATHER_PROVIDERS.find(provider => provider.id === providerId);
        const source = this._createButton(
            sourceInfo
                ? text(sourceInfo.sourceDe, sourceInfo.sourceEn)
                : text('Unbekannte Datenquelle', 'Unknown data source'),
            'tuxwetter-source',
            () => {
                if (!sourceInfo)
                    return;
                try {
                    if (!Gio.AppInfo.launch_default_for_uri(sourceInfo.url, null))
                        throw new Error('No application is available to open the data source');
                } catch (error) {
                    console.error(`TuX-Wetter: ${error.message}`);
                }
            },
            text('Datenquelle öffnen', 'Open data source'));
        source.x_expand = true;
        footer.add_child(source);
        if (this._lastUpdated) {
            const time = new Intl.DateTimeFormat(isGerman() ? 'de' : 'en', {
                hour: '2-digit',
                minute: '2-digit',
            }).format(this._lastUpdated);
            footer.add_child(this._label(time, 'tuxwetter-updated'));
        }
        footer.add_child(this._iconButton(
            'view-refresh-symbolic', 'tuxwetter-footer-button',
            () => this._refresh(), text('Jetzt aktualisieren', 'Refresh now')));
        footer.add_child(this._iconButton(
            'preferences-system-symbolic', 'tuxwetter-footer-button',
            () => this.openPreferences(), text('Einstellungen', 'Preferences')));
        card.add_child(footer);
    }

    _addOfficialWarnings(card) {
        const current = this._currentPlace();
        const result = this._warningResults.get(this._warningKey(current));
        if (result?.status === 'unavailable') {
            card.add_child(this._label(
                text(`Amtliche Warnungen derzeit nicht abrufbar: ${result.error}`,
                    `Official warnings are currently unavailable: ${result.error}`),
                'tuxwetter-warning-error'));
        } else if (result?.status === 'unsupported') {
            card.add_child(this._label(result.error, 'tuxwetter-warning-error'));
        } else if (result?.status === 'available' && result.warnings.length) {
            const warning = result.warnings[0];
            const extraCount = result.warnings.length - 1;
            const button = this._createButton(
                `⚠ ${warning.title}${extraCount ? ` +${extraCount}` : ''}`,
                `tuxwetter-warning tuxwetter-warning-${Math.min(4, warning.level)}`,
                () => this._openWarningUrl(warning.url),
                text('Amtliche Wetterwarnung öffnen', 'Open official weather warning'));
            button.tooltip_text = this._warningTooltip(result.warnings);
            card.add_child(button);
        } else if (result?.status === 'available') {
            card.add_child(this._label(
                text('Keine amtliche Warnung für diesen Ort.',
                    'No official warning for this location.'),
                'tuxwetter-warning-clear'));
        }

        for (const other of this._allPlaces()) {
            if (this._warningKey(other) === this._warningKey(current))
                continue;
            const otherResult = this._warningResults.get(this._warningKey(other));
            if (otherResult?.status === 'unavailable') {
                card.add_child(this._label(
                    text(`Warnstatus für ${other.name} nicht verfügbar: ${otherResult.error}`,
                        `Warning status for ${other.name} unavailable: ${otherResult.error}`),
                    'tuxwetter-warning-error'));
                continue;
            }
            if (otherResult?.status === 'unsupported') {
                card.add_child(this._label(
                    `${other.name}: ${otherResult.error}`,
                    'tuxwetter-warning-error'));
                continue;
            }
            if (otherResult?.status !== 'available' || !otherResult.warnings.length)
                continue;

            const warning = otherResult.warnings[0];
            const button = this._createButton(
                `⚠ ${other.name}: ${warning.title}${otherResult.warnings.length > 1
                    ? ` +${otherResult.warnings.length - 1}`
                    : ''}`,
                `tuxwetter-warning-place tuxwetter-warning-${Math.min(4, warning.level)}`,
                () => this._activatePlace(other),
                text(`Warnungen für ${other.name} anzeigen`,
                    `Show warnings for ${other.name}`));
            button.tooltip_text = this._warningTooltip(otherResult.warnings);
            card.add_child(button);
        }
    }

    _warningTooltip(warnings) {
        return warnings.map(warning => {
            const times = `${new Intl.DateTimeFormat(isGerman() ? 'de' : 'en', {
                dateStyle: 'short',
                timeStyle: 'short',
            }).format(warning.start)} – ${new Intl.DateTimeFormat(isGerman() ? 'de' : 'en', {
                dateStyle: 'short',
                timeStyle: 'short',
            }).format(warning.end)}`;
            return `${warning.title} · ${text('Stufe', 'Level')} ${warning.level} · ${times}`
                + (warning.text ? `\n${warning.text}` : '');
        }).join('\n\n');
    }

    _openWarningUrl(url) {
        try {
            if (!Gio.AppInfo.launch_default_for_uri(url, null))
                throw new Error('No application is available to open the warning page');
        } catch (error) {
            console.error(`TuX-Wetter: ${error.message}`);
        }
    }

    _activatePlace(place) {
        this._settings.delay();
        this._settings.set_string('location-name', place.name);
        this._settings.set_double('latitude', place.latitude);
        this._settings.set_double('longitude', place.longitude);
        this._settings.set_string('location-country', place.countryCode ?? '');
        this._settings.set_string('location-postcodes', JSON.stringify(place.postcodes ?? []));
        this._settings.apply();
    }

    _createButton(label, styleClass, action, accessibleName = label) {
        const button = new St.Button({
            label,
            style_class: styleClass,
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: accessibleName,
        });
        button.connect('clicked', action);
        return button;
    }

    _iconButton(iconName, styleClass, action, accessibleName) {
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: accessibleName,
        });
        button.set_child(new St.Icon({
            icon_name: iconName,
            icon_size: 16,
        }));
        button.connect('clicked', action);
        return button;
    }

    _label(value, styleClass) {
        return new St.Label({
            text: String(value),
            style_class: styleClass,
            x_align: Clutter.ActorAlign.START,
        });
    }

    _addCurrentWeather(card, forecast, fahrenheit) {
        const hero = new St.BoxLayout({style_class: 'tuxwetter-hero'});
        const lead = new St.BoxLayout({style_class: 'tuxwetter-lead'});
        lead.add_child(this._weatherIcon(
            iconForCode(forecast.code, forecast.isDay), 100, 'tuxwetter-hero-icon'));
        const temperature = new St.BoxLayout({style_class: 'tuxwetter-temperature-row'});
        const value = fahrenheit
            ? Math.round(forecast.temperature * 9 / 5 + 32)
            : Math.round(forecast.temperature);
        temperature.add_child(this._label(`${value}°`, 'tuxwetter-temperature'));
        const units = new St.BoxLayout({
            vertical: true,
            style_class: 'tuxwetter-units',
        });
        for (const useFahrenheit of [false, true]) {
            const unit = this._createButton(
                useFahrenheit ? '°F' : '°C',
                this._settings.get_boolean('use-fahrenheit') === useFahrenheit
                    ? 'tuxwetter-unit tuxwetter-unit-active'
                    : 'tuxwetter-unit',
                () => this._settings.set_boolean('use-fahrenheit', useFahrenheit));
            units.add_child(unit);
        }
        temperature.add_child(units);
        lead.add_child(temperature);
        hero.add_child(lead);

        const summary = new St.BoxLayout({
            vertical: true,
            style_class: 'tuxwetter-summary',
            x_expand: true,
        });
        const metrics = new St.BoxLayout({style_class: 'tuxwetter-metrics'});
        if (forecast.wind !== null) {
            const arrow = forecast.windDirection === null
                ? ''
                : ` ${this._windArrow(forecast.windDirection + 180)}`;
            metrics.add_child(this._metric(
                'wind',
                `${Math.round(forecast.wind)} km/h${arrow}`,
                'tuxwetter-metric-wind'));
        }
        if (forecast.precipitation !== null)
            metrics.add_child(this._metric(
                'umbrella',
                `${Math.round(forecast.precipitation)}%`,
                'tuxwetter-metric-value'));
        if (forecast.humidity !== null)
            metrics.add_child(this._metric(
                'drop',
                `${Math.round(forecast.humidity)}%`,
                'tuxwetter-metric-value'));
        summary.add_child(metrics);
        summary.add_child(this._label(
            conditionForCode(forecast.code, forecast.isDay, isGerman()),
            'tuxwetter-condition'));

        const today = forecast.today;
        const temperatures = new St.BoxLayout({style_class: 'tuxwetter-today'});
        if (forecast.feelsLike !== null && this._settings.get_boolean('show-feels-like')) {
            temperatures.add_child(this._label(
                text('gefühlt ', 'feels like ')
                    + formatTemperature(forecast.feelsLike, fahrenheit),
                'tuxwetter-feels-like'));
        }
        if (today) {
            const range = this._label(
                `${formatTemperature(today.high, fahrenheit)} / ${formatTemperature(today.low, fahrenheit)}`,
                'tuxwetter-high-low');
            temperatures.add_child(range);
        }
        temperatures.x_align = Clutter.ActorAlign.END;
        summary.add_child(temperatures);
        hero.add_child(summary);
        card.add_child(hero);

        if (forecast.windWarning) {
            const level = forecast.windWarning.level;
            const warning = new St.BoxLayout({
                style_class: `tuxwetter-warning tuxwetter-warning-${level}`,
            });
            warning.add_child(new St.Icon({
                icon_name: 'dialog-warning-symbolic',
                style_class: 'tuxwetter-warning-icon',
                icon_size: 18,
            }));
            warning.add_child(this._label(
                text(`Windhinweis · Böen bis ${forecast.windWarning.gust} km/h · ${forecast.windWarning.time}`,
                    `Wind advisory · gusts up to ${forecast.windWarning.gust} km/h · ${forecast.windWarning.time}`),
                'tuxwetter-warning-text'));
            card.add_child(warning);
        }
    }

    _metric(icon, value, valueClass) {
        const row = new St.BoxLayout({style_class: 'tuxwetter-metric'});
        row.add_child(this._weatherIcon(icon, 24, 'tuxwetter-metric-icon'));
        row.add_child(this._label(value, valueClass));
        return row;
    }

    _addHourlyForecast(card, hours, fahrenheit) {
        const row = new St.BoxLayout({style_class: 'tuxwetter-hourly'});
        for (const hour of hours) {
            const column = new St.BoxLayout({
                vertical: true,
                style_class: 'tuxwetter-hour',
                x_expand: true,
            });
            column.add_child(this._label(hour.time, 'tuxwetter-hour-time'));
            column.add_child(this._weatherIcon(
                iconForCode(hour.code, hour.isDay), 54, 'tuxwetter-hour-icon'));
            column.add_child(this._label(
                formatTemperature(hour.temperature, fahrenheit),
                'tuxwetter-hour-temperature'));
            row.add_child(column);
        }
        card.add_child(row);
    }

    _addDailyForecast(card, days, fahrenheit, hourlyByDate = {}) {
        const divider = new St.Widget({style_class: 'tuxwetter-divider'});
        card.add_child(divider);
        const lows = days.map(day => day.low);
        const highs = days.map(day => day.high);
        const range = Math.max(...highs) - Math.min(...lows) || 1;
        for (const day of days) {
            const row = new St.BoxLayout({
                style_class: 'tuxwetter-day',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            row.tooltip_text = text(
                'Klicken, um den Temperaturverlauf des Tages zu zeigen.',
                'Click to show the day’s temperature curve.');
            row.connect('button-press-event', (_row, event) => {
                if (event.get_button() !== 1)
                    return Clutter.EVENT_PROPAGATE;
                this._selectedForecastDate = this._selectedForecastDate === day.date
                    ? null
                    : day.date;
                this._render();
                return Clutter.EVENT_STOP;
            });
            const name = this._label(shortDay(day.date), 'tuxwetter-day-name');
            row.add_child(name);
            row.add_child(this._weatherIcon(
                iconForCode(day.code, true), 30, 'tuxwetter-day-icon'));
            const precipitation = [];
            if (day.precipitation !== null)
                precipitation.push(`${Math.round(day.precipitation)}%`);
            if (day.precipitationSum > 0)
                precipitation.push(`${day.precipitationSum.toFixed(1)} mm`);
            const chance = day.snowfall > 0
                ? `❄ ${day.snowfall.toFixed(1)} cm`
                : precipitation.join(' · ') || '—';
            row.add_child(this._label(chance, 'tuxwetter-day-precipitation'));
            row.add_child(this._label(formatTemperature(day.low, fahrenheit), 'tuxwetter-day-low'));
            const track = new St.Bin({
                style_class: 'tuxwetter-range-track',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                height: 5,
            });
            const fill = new St.Widget({
                style_class: 'tuxwetter-range-fill',
                x_align: Clutter.ActorAlign.START,
                y_expand: true,
            });
            const offset = (day.low - Math.min(...lows)) / range;
            const width = Math.max(10, (day.high - day.low) / range * 74);
            fill.set_width(width);
            fill.translation_x = offset * 74;
            track.set_child(fill);
            row.add_child(track);
            row.add_child(this._label(formatTemperature(day.high, fahrenheit), 'tuxwetter-day-high'));
            card.add_child(row);
            if (this._selectedForecastDate === day.date && hourlyByDate[day.date])
                this._addTemperatureCurve(card, hourlyByDate[day.date], fahrenheit);
        }
    }

    _addSunInfo(card, forecast) {
        const info = [];
        if (forecast.sunrise)
            info.push(['sunrise', `${text('Aufgang', 'Sunrise')} ${forecast.sunrise}`]);
        if (forecast.sunset)
            info.push(['sunset', `${text('Untergang', 'Sunset')} ${forecast.sunset}`]);
        if (forecast.uvIndex !== null)
            info.push(['weather-clear-symbolic', `UV ${forecast.uvIndex.toFixed(0)}`]);
        if (info.length) {
            const row = new St.BoxLayout({style_class: 'tuxwetter-sun'});
            for (const [iconName, value] of info) {
                if (iconName === 'weather-clear-symbolic') {
                    row.add_child(new St.Icon({
                        icon_name: iconName,
                        style_class: 'tuxwetter-sun-icon',
                        icon_size: 20,
                    }));
                } else {
                    row.add_child(this._weatherIcon(iconName, 22, 'tuxwetter-sun-icon'));
                }
                row.add_child(this._label(value, 'tuxwetter-sun-text'));
            }
            card.add_child(row);
        }
    }

    _addMoonInfo(card) {
        const moon = this._supplementary.moon;
        if (!moon) {
            if (this._supplementaryErrors.moon)
                card.add_child(this._label(
                    text(`Mondinformationen nicht verfügbar: ${this._supplementaryErrors.moon}`,
                        `Moon data unavailable: ${this._supplementaryErrors.moon}`),
                    'tuxwetter-extra-error'));
            return;
        }

        const phase = this._moonPhase(moon.phase);
        const values = [phase];
        if (moon.rise)
            values.push(`${text('Aufgang', 'Rise')} ${moon.rise}`);
        if (moon.set)
            values.push(`${text('Untergang', 'Set')} ${moon.set}`);
        const row = new St.BoxLayout({style_class: 'tuxwetter-moon'});
        row.add_child(this._label('☾', 'tuxwetter-moon-icon'));
        row.add_child(this._label(values.join(' · '), 'tuxwetter-moon-text'));
        card.add_child(row);
    }

    _moonPhase(phase) {
        if (phase < 0.03 || phase >= 0.97)
            return text('Neumond', 'New moon');
        if (phase < 0.22)
            return text('Zunehmende Sichel', 'Waxing crescent');
        if (phase < 0.28)
            return text('Erstes Viertel', 'First quarter');
        if (phase < 0.47)
            return text('Zunehmender Mond', 'Waxing gibbous');
        if (phase < 0.53)
            return text('Vollmond', 'Full moon');
        if (phase < 0.72)
            return text('Abnehmender Mond', 'Waning gibbous');
        if (phase < 0.78)
            return text('Letztes Viertel', 'Last quarter');
        return text('Abnehmende Sichel', 'Waning crescent');
    }

    _addAirQuality(card) {
        const air = this._supplementary.air;
        if (!air) {
            if (this._supplementaryErrors.air)
                card.add_child(this._label(
                    text(`Luftqualität nicht verfügbar: ${this._supplementaryErrors.air}`,
                        `Air quality unavailable: ${this._supplementaryErrors.air}`),
                    'tuxwetter-extra-error'));
            return;
        }

        const level = airQualityLevel(air.aqi);
        const row = new St.BoxLayout({style_class: 'tuxwetter-air'});
        row.add_child(this._weatherIcon('wind', 22, 'tuxwetter-air-icon'));
        row.add_child(this._label(
            `${text('Luftqualität', 'Air quality')}: ${Math.round(air.aqi)} · `
                + text(level.labelDe, level.labelEn),
            'tuxwetter-air-text'));
        const pollenNames = {
            alder: text('Erle', 'Alder'),
            birch: text('Birke', 'Birch'),
            grass: text('Gräser', 'Grass'),
            mugwort: text('Beifuss', 'Mugwort'),
            olive: text('Olive', 'Olive'),
            ragweed: text('Ambrosia', 'Ragweed'),
        };
        row.tooltip_text = air.pollen.map(pollen =>
            `${pollenNames[pollen.name] ?? pollen.name}: ${pollen.value.toFixed(1)}`
                + text(' Pollen/m³', ' pollen/m³')).join('\n') ||
            text('Derzeit keine Pollendaten verfügbar.',
                'Pollen data is currently unavailable.');
        card.add_child(row);
    }

    _addRainOutlook(card) {
        const rain = this._supplementary.rain;
        if (!rain) {
            if (this._supplementaryErrors.rain)
                card.add_child(this._label(
                    text(`Regenvorschau nicht verfügbar: ${this._supplementaryErrors.rain}`,
                        `Rain outlook unavailable: ${this._supplementaryErrors.rain}`),
                    'tuxwetter-extra-error'));
            return;
        }

        const detail = rain.periods.map(period =>
            `${period.time}: ${period.amount.toFixed(1)} mm`
                + (period.probability === null ? '' : ` · ${Math.round(period.probability)}%`))
            .join('\n');
        const label = rain.startsAt
            ? text(`Regen: ab ${rain.startsAt}`, `Rain: from ${rain.startsAt}`)
            : text('Kein Regen in den nächsten 2 Stunden',
                'No rain expected in the next 2 hours');
        const row = this._label(label, 'tuxwetter-rain-outlook');
        row.tooltip_text = detail || label;
        card.add_child(row);
    }

    _addTemperatureCurve(card, hours, fahrenheit) {
        if (!hours.length)
            return;
        const section = new St.BoxLayout({
            vertical: true,
            style_class: 'tuxwetter-temperature-curve',
        });
        section.add_child(this._label(
            text('Temperaturverlauf · 24 Stunden', 'Temperature curve · 24 hours'),
            'tuxwetter-curve-title'));
        const low = Math.min(...hours.map(hour => hour.temperature));
        const high = Math.max(...hours.map(hour => hour.temperature));
        const range = high - low || 1;
        const chart = new St.BoxLayout({style_class: 'tuxwetter-curve-chart'});
        for (let i = 0; i < hours.length; i++) {
            const hour = hours[i];
            const column = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'tuxwetter-curve-column',
            });
            const track = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.END,
                height: 48,
                style_class: 'tuxwetter-curve-track',
            });
            const bar = new St.Widget({
                style_class: 'tuxwetter-curve-bar',
                height: Math.max(5, 5 + 39 * (hour.temperature - low) / range),
            });
            bar.tooltip_text = `${hour.time} · ${formatTemperature(hour.temperature, fahrenheit)}`;
            track.add_child(bar);
            column.add_child(track);
            column.add_child(this._label(
                i % 4 === 0 ? hour.time : '',
                'tuxwetter-curve-time'));
            chart.add_child(column);
        }
        section.add_child(chart);
        card.add_child(section);
    }

    _weatherIcon(name, size, styleClass = '') {
        return new St.Icon({
            gicon: this._weatherGicon(name),
            icon_size: size,
            style_class: styleClass,
        });
    }

    _weatherGicon(name) {
        const path = GLib.build_filenamev([this.path, 'icons', `${name}.svg`]);
        const file = Gio.File.new_for_path(path);
        return new Gio.FileIcon({file});
    }

    _placeIndex(places) {
        const latitude = this._settings.get_double('latitude');
        const longitude = this._settings.get_double('longitude');
        return places.findIndex(place =>
            Math.abs(place.latitude - latitude) < 1e-4 &&
            Math.abs(place.longitude - longitude) < 1e-4);
    }

    _windArrow(degrees) {
        return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][
            Math.round(((degrees % 360) + 360) % 360 / 45) % 8
        ];
    }

    _getPlaces() {
        try {
            const places = JSON.parse(this._settings.get_string('places'));
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
            console.warn(`TuX-Wetter: ${error.message}`);
            return [];
        }
    }

    _cyclePlace(step) {
        const places = this._getPlaces();
        if (places.length < 2)
            return;
        const current = this._placeIndex(places);
        const nextIndex = current < 0
            ? (step > 0 ? 0 : places.length - 1)
            : (current + step + places.length) % places.length;
        const next = places[nextIndex];
        this._activatePlace(next);
    }
}

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

import {conditionForCode, forecastUrl, iconForCode, parseForecast} from './weather.js';

function isGerman() {
    return GLib.get_language_names()[0]?.startsWith('de') ?? false;
}

function text(german, english) {
    return isGerman() ? german : english;
}

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
        this._error = null;
        this._lastUpdated = null;

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
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'latitude' || key === 'longitude') {
                this._forecast = null;
                this._lastUpdated = null;
                this._retryCount = 0;
                this._refresh();
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
        this._cancellable?.cancel();
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

    _refresh() {
        if (!this._settings || !this._session)
            return;

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

        let url;
        try {
            url = forecastUrl(
                this._settings.get_double('latitude'),
                this._settings.get_double('longitude'));
        } catch (error) {
            this._error = error.message;
            this._render();
            return;
        }

        const message = Soup.Message.new('GET', url);
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
                        throw new Error(`HTTP ${message.get_status()}: ${message.get_reason_phrase()}`);
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    this._forecast = parseForecast(data);
                    this._lastUpdated = new Date();
                    this._error = null;
                    this._retryCount = 0;
                } catch (error) {
                    if (requestSerial === this._requestSerial && !cancellable.is_cancelled()) {
                        this._error = error.message;
                        console.error(`TuX-Wetter: ${error.message}`);
                        this._scheduleRetry();
                    } else {
                        return;
                    }
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
            if (forecast.days.length)
                this._addDailyForecast(card, forecast.days, fahrenheit);
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

        const footer = new St.BoxLayout({style_class: 'tuxwetter-footer'});
        const source = this._label(text('Daten: Open-Meteo', 'Data: Open-Meteo'),
            'tuxwetter-source');
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

    _addDailyForecast(card, days, fahrenheit) {
        const divider = new St.Widget({style_class: 'tuxwetter-divider'});
        card.add_child(divider);
        const lows = days.map(day => day.low);
        const highs = days.map(day => day.high);
        const range = Math.max(...highs) - Math.min(...lows) || 1;
        for (const day of days) {
            const row = new St.BoxLayout({style_class: 'tuxwetter-day'});
            const name = this._label(shortDay(day.date), 'tuxwetter-day-name');
            row.add_child(name);
            row.add_child(this._weatherIcon(
                iconForCode(day.code, true), 30, 'tuxwetter-day-icon'));
            const chance = day.snowfall > 0
                ? `❄ ${day.snowfall.toFixed(1)} cm`
                : day.precipitation === null
                    ? '—'
                    : `${Math.round(day.precipitation)}%`
                        + (day.precipitationSum > 0 ? ` · ${day.precipitationSum.toFixed(1)} mm` : '');
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
                    && Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
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
        this._settings.set_string('location-name', next.name);
        this._settings.set_double('latitude', next.latitude);
        this._settings.set_double('longitude', next.longitude);
    }
}

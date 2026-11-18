// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    conditionForCode,
    forecastUrl,
    geocodingUrl,
    iconForCode,
    parseForecast,
    parseGeocodingResults,
} from '../gnome-extension/weather.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const url = forecastUrl(47.0505, 8.3064);
assert(url.startsWith('https://api.open-meteo.com/v1/forecast?'), 'forecast URL should use Open-Meteo');
assert(url.includes('latitude=47.0505'), 'latitude should be included');
assert(url.includes('timezone=auto'), 'local timezone should be requested');
const params = Object.fromEntries(url.split('?')[1].split('&').map(part =>
    part.split('=').map(decodeURIComponent)));
assert(!params.current.includes('precipitation_probability'),
    'precipitation probability should not be requested as a current variable');
assert(params.hourly.includes('precipitation_probability'),
    'precipitation probability should be requested as an hourly variable');
assert(geocodingUrl('Zürich', 'de').includes('name=Z%C3%BCrich'),
    'location search should encode Unicode place names');
assert(geocodingUrl('Zürich', 'de').includes('language=de'),
    'location search should use the selected language');
assert(geocodingUrl('Zuerich (CH)', 'de').includes('name=Z%C3%BCrich'),
    'common Swiss ASCII transliterations should resolve to the accented place name');
assert(geocodingUrl('Luzern (CH)', 'de').includes('countryCode=CH'),
    'a country hint should narrow place searches to that country');
assert(parseGeocodingResults({results: [
    {name: 'Zürich', latitude: 47.37, longitude: 8.54},
    {name: 'Invalid', latitude: 100, longitude: 0},
]}).length === 1, 'invalid geocoding coordinates should be filtered');

let rejectedShortSearch = false;
try {
    geocodingUrl('A');
} catch {
    rejectedShortSearch = true;
}
assert(rejectedShortSearch, 'short place searches should be rejected');

let rejectedCoordinates = false;
try {
    forecastUrl(91, 0);
} catch {
    rejectedCoordinates = true;
}
assert(rejectedCoordinates, 'out-of-range coordinates should be rejected');

const forecast = parseForecast({
    current: {
        time: '2026-11-14T09:00',
        temperature_2m: 8.2,
        apparent_temperature: 6.1,
        relative_humidity_2m: 70,
        weather_code: 3,
        wind_speed_10m: 12,
        wind_direction_10m: 240,
        wind_gusts_10m: 30,
        is_day: 1,
    },
    hourly: {
        time: ['2026-11-14T09:00', '2026-11-14T10:00', '2026-11-14T11:00'],
        temperature_2m: [8.2, 8.5, 9],
        weather_code: [3, 2, 2],
        is_day: [1, 1, 1],
        precipitation_probability: [10, 20, 15],
        wind_gusts_10m: [30, 50, 20],
    },
    daily: {
        time: ['2026-11-14', '2026-11-15', '2026-11-16'],
        weather_code: [3, 2, 61],
        temperature_2m_max: [10, 11, 8],
        temperature_2m_min: [4, 5, 3],
        precipitation_probability_max: [20, 10, 80],
        precipitation_sum: [0, 0, 2.4],
        snowfall_sum: [0, 0, 0],
        sunrise: ['2026-11-14T07:20', '2026-11-15T07:21', '2026-11-16T07:23'],
        sunset: ['2026-11-14T17:01', '2026-11-15T16:59', '2026-11-16T16:58'],
        uv_index_max: [2.1, 1.8, 2.0],
    },
});
assert(forecast.temperature === 8.2, 'current temperature should be parsed');
assert(forecast.precipitation === 20, 'today precipitation probability should be parsed');
assert(forecast.hours.length === 3, 'available hourly values should be parsed');
assert(forecast.hourlyByDate['2026-11-14']?.length === 3,
    'full per-day hourly data should be retained for interactive temperature curves');
assert(forecast.days.length === 2, 'forecast should omit today and include future days');
assert(forecast.today.high === 10, 'today high should be parsed separately');
assert(forecast.days[0].high === 11, 'future daily high should be parsed');
assert(forecast.days[1].precipitationSum === 2.4, 'daily rainfall should be parsed');
assert(forecast.sunrise === '07:20' && forecast.sunset === '17:01',
    'sunrise and sunset should be parsed for the local timezone');
assert(forecast.uvIndex === 2.1, 'daily UV index should be parsed');
assert(forecast.windWarning?.gust === 50 && forecast.windWarning.level === 1,
    'wind gusts should trigger the advisory threshold');
assert(conditionForCode(95, true, 'de') === 'Gewitter', 'German weather description should be available');
assert(conditionForCode(95, true, 'en') === 'Thunderstorm', 'English weather description should be available');
assert(conditionForCode(95, true, true) === 'Gewitter', 'German boolean locale should be supported');
assert(conditionForCode(95, true, false) === 'Thunderstorm', 'English boolean locale should be supported');
assert(iconForCode(0, false) === 'clear-night', 'night icon should be selected');
assert(iconForCode(81, true) === 'showers-day', 'daytime showers should use the original TuX artwork');
assert(iconForCode(68, true) === 'rain', 'sleet should not use the snow icon');

let rejectedIncompleteData = false;
try {
    parseForecast({});
} catch {
    rejectedIncompleteData = true;
}
assert(rejectedIncompleteData, 'incomplete weather responses should be rejected');

print('weather tests passed');

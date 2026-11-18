// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    forecastRequest,
    parseProviderForecast,
    WEATHER_PROVIDERS,
} from '../gnome-extension/providers.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function timestampAfter(hours) {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + hours);
    return date.toISOString();
}

const dwdRequest = forecastRequest('dwd-icon-d2', 47.05, 8.306);
assert(dwdRequest.url.includes('models=dwd_icon_d2'),
    'DWD should select the ICON-D2 model');
const swissRequest = forecastRequest('meteoswiss-icon-ch2', 47.05, 8.306);
assert(swissRequest.url.includes('models=meteoswiss_icon_ch2'),
    'MeteoSwiss should select the ICON-CH2 model');
const geoSphereRequest = forecastRequest('geosphere-austria', 47.05, 8.306);
assert(geoSphereRequest.url.includes('/nwp-v2-1h-1km?'),
    'GeoSphere should use its hourly 1 km forecast dataset');
assert(geoSphereRequest.url.includes('lat_lon=47.0500,8.3060'),
    'GeoSphere coordinates should be rounded to four decimals');
const metNorwayRequest = forecastRequest('met-norway', 47.05, 8.306);
assert(metNorwayRequest.url.includes('/locationforecast/2.0/compact?'),
    'MET Norway should use Locationforecast compact');
assert(metNorwayRequest.headers['User-Agent'].includes('github.com/19nkn80/Tux-Wetter-Gnome'),
    'MET Norway requests should identify the extension');
assert(WEATHER_PROVIDERS.some(provider => provider.id === 'geosphere-austria'),
    'GeoSphere should be selectable');

const times = Array.from({length: 36}, (_, index) => timestampAfter(index + 1));
const geoValues = (value, name = '') => ({name, data: Array(times.length).fill(value)});
const geoSphereForecast = parseProviderForecast({
    timestamps: times,
    features: [{
        properties: {
            parameters: {
                '2t': geoValues(10),
                sy: geoValues(8),
                tp: geoValues(0.2),
                rain: geoValues(0.2),
                '10u': geoValues(3),
                '10v': geoValues(4),
                '10fg': geoValues(20),
                '2r': geoValues(70),
                tcc: geoValues(90),
                sf: geoValues(0),
            },
        },
    }],
}, 'geosphere-austria');
assert(geoSphereForecast.temperature === 10, 'GeoSphere temperature should be normalized');
assert(geoSphereForecast.humidity === 70, 'GeoSphere humidity should be normalized');
assert(geoSphereForecast.wind === 18, 'GeoSphere wind components should become km/h');
assert(geoSphereForecast.windWarning?.level === 2,
    'GeoSphere wind gusts should trigger the shared wind advisory');
assert(geoSphereForecast.code === 61, 'GeoSphere rain symbols should map to WMO codes');
assert(geoSphereForecast.hours.length === 6 && geoSphereForecast.days.length > 0,
    'GeoSphere hourly data should produce hourly and daily forecasts');
assert(Object.values(geoSphereForecast.hourlyByDate).flat().length > 6,
    'GeoSphere hourly data should be retained for daily temperature curves');
assert(geoSphereForecast.days[0].precipitationSum > 0,
    'GeoSphere precipitation should be aggregated into daily amounts');

const metTimeseries = times.map((time, index) => ({
    time,
    data: {
        instant: {
            details: {
                air_temperature: 8 + index / 10,
                relative_humidity: 75,
                wind_speed: 4,
                wind_from_direction: 270,
                wind_speed_of_gust: 15,
            },
        },
        next_1_hours: {
            summary: {symbol_code: index === 0 ? 'partlycloudy_day' : 'heavyrain'},
            details: {precipitation_amount: 0.2},
        },
    },
}));
const metNorwayForecast = parseProviderForecast({
    properties: {timeseries: metTimeseries},
}, 'met-norway');
assert(metNorwayForecast.code === 2 && metNorwayForecast.isDay,
    'MET Norway symbols should map to shared weather conditions');
assert(metNorwayForecast.wind === 14.4 && metNorwayForecast.humidity === 75,
    'MET Norway wind and humidity should be normalized');
assert(metNorwayForecast.windWarning?.level === 1,
    'MET Norway gusts should trigger the shared wind advisory');
assert(metNorwayForecast.days[0].precipitationSum > 0,
    'MET Norway period precipitation should be aggregated into daily amounts');

let rejectedUnknownProvider = false;
try {
    forecastRequest('unknown', 47.05, 8.306);
} catch {
    rejectedUnknownProvider = true;
}
assert(rejectedUnknownProvider, 'unknown providers should not silently fall back');

print('provider tests passed');

// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    airQualityLevel,
    airQualityRequestUrl,
    moonRequestUrl,
    parseAirQuality,
    parseMoonData,
    parsePrecipitation15,
    precipitation15RequestUrl,
} from '../gnome-extension/supplementary.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

assert(moonRequestUrl(47.05, 8.306).includes('daily=moonrise%2Cmoonset%2Cmoon_phase'),
    'moon data should use Open-Meteo daily astronomy variables');
assert(precipitation15RequestUrl(47.05, 8.306).includes('minutely_15='),
    'short-term rain should use 15-minute forecast intervals');
assert(airQualityRequestUrl(47.05, 8.306).includes('european_aqi'),
    'air quality requests should include the European AQI and pollen');

const moon = parseMoonData({
    daily: {
        time: ['2026-11-14'],
        moon_phase: [0.5],
        moonrise: ['2026-11-14T12:18'],
        moonset: ['2026-11-14T20:37'],
    },
});
assert(moon.phase === 0.5 && moon.rise === '12:18' && moon.set === '20:37',
    'moon phase and local rise/set times should be normalized');

const rain = parsePrecipitation15({
    timezone: 'Europe/Zurich',
    minutely_15: {
        time: ['2026-11-14T13:00', '2026-11-14T13:15', '2026-11-14T13:30'],
        precipitation: [0, 0.4, 0.2],
        precipitation_probability: [0, 60, 70],
    },
}, new Date('2026-11-14T12:05:00Z'));
assert(rain.periods.length === 2 && rain.startsAt === '13:15',
    'rain periods should begin at the next local interval');
assert(Math.abs(rain.total - 0.6) < 1e-9 && rain.periods[0].probability === 60,
    'quarter-hour rainfall and probability should be retained');

const air = parseAirQuality({
    current: {
        european_aqi: 22,
        pm2_5: 4.1,
        pm10: 8.3,
        birch_pollen: 0.4,
        grass_pollen: 1.2,
    },
});
assert(air.aqi === 22 && air.pm25 === 4.1 && air.pollen.length === 2,
    'AQI, particulate matter, and available pollen types should be parsed');
assert(airQualityLevel(20).key === 'good' && airQualityLevel(101).key === 'extremely-poor',
    'European AQI levels should include low and extreme conditions');

print('supplementary weather tests passed');

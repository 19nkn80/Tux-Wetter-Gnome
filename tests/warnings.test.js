// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    dwdWarningsUrl,
    dwdZonesUrl,
    geoSphereWarningsUrl,
    meteoswissWarningsRequest,
    parseDwdWarnings,
    parseDwdZones,
    parseGeoSphereWarnings,
    parseMeteoSwissWarnings,
} from '../gnome-extension/warnings.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function formatLocalTime(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const now = Date.now();
assert(dwdWarningsUrl().includes('/warnapp/json/warnings.json'),
    'DWD should use its public warning feed');
assert(dwdZonesUrl(52.5, 13.4).includes('bbox='),
    'DWD warning zone lookup should be restricted to the requested point');
assert(geoSphereWarningsUrl(48.2, 16.3, 'de').includes('lang=de'),
    'GeoSphere warning requests should include the selected language');
const swissRequest = meteoswissWarningsRequest(['6000', '6003']);
assert(swissRequest.urls[0].includes('/v1/plzDetail?plz=600000'),
    'MeteoSwiss should use the selected postal code with its app endpoint');
assert(swissRequest.headers['User-Agent'].includes('ch.admin.meteoswiss'),
    'MeteoSwiss requests should identify the official mobile app client');

const dwdWarnings = parseDwdWarnings(
    `warnWetter.loadWarnings(${JSON.stringify({
        warnings: {
            801051061: [{
                warnId: 123,
                event: 'STURM',
                headline: 'Amtliche WARNUNG vor STURM',
                description: 'Böen möglich',
                level: 2,
                start: now - 60_000,
                end: now + 60_000,
            }],
            801051062: [{
                warnId: 456,
                event: 'FROST',
                headline: 'Amtliche WARNUNG vor FROST',
                level: 3,
                start: now - 60_000,
                end: now + 60_000,
            }],
        },
    })});`,
    ['801051061'],
    now);
assert(dwdWarnings.length === 1 && dwdWarnings[0].type === 'wind',
    'DWD warnings should be filtered by warning cell and normalized by type');
assert(dwdWarnings[0].level === 2 && dwdWarnings[0].id === '123',
    'DWD severity and stable warning id should be retained');

const dwdZones = parseDwdZones({
    features: [
        {
            geometry: {
                type: 'Polygon',
                coordinates: [[[8, 47], [9, 47], [9, 48], [8, 48], [8, 47]]],
            },
            properties: {WARNCELLID: 123},
        },
        {
            geometry: {
                type: 'Polygon',
                coordinates: [[[10, 47], [11, 47], [11, 48], [10, 48], [10, 47]]],
            },
            properties: {WARNCELLID: 456},
        },
    ],
}, 47.5, 8.5);
assert(dwdZones.length === 1 && dwdZones[0] === '123',
    'DWD warning zones should be selected with point-in-polygon matching');

const geoWarnings = parseGeoSphereWarnings({
    properties: {
        warnings: [{
            properties: {
                warnid: 42,
                warntypid: 5,
                warnstufeid: 2,
                begin: formatLocalTime(new Date(now - 60_000)),
                end: formatLocalTime(new Date(now + 60_000)),
                rawinfo: {
                    start: Math.floor((now - 60_000) / 1000),
                    end: Math.floor((now + 60_000) / 1000),
                },
                text: 'Gewitterwarnung',
            },
        }],
    },
}, now);
assert(geoWarnings.length === 1 && geoWarnings[0].type === 'thunderstorm',
    'GeoSphere warning types should be normalized');
assert(geoWarnings[0].start.getTime() === Math.floor((now - 60_000) / 1000) * 1000,
    'GeoSphere warning timestamps should prefer timezone-independent Unix times');

const swissWarnings = parseMeteoSwissWarnings({
    warnings: [{
        warnType: 1,
        warnLevel: 3,
        validFrom: now - 60_000,
        validTo: now + 60_000,
        text: 'Windwarnung',
    }],
}, now);
assert(swissWarnings.length === 1 && swissWarnings[0].type === 'wind',
    'MeteoSwiss active warnings should be normalized');

assert(parseMeteoSwissWarnings({
    warnings: [{
        warnType: 1,
        warnLevel: 3,
        validFrom: now - 120_000,
        validTo: now - 60_000,
    }],
}, now).length === 0, 'expired warnings should not be displayed');

print('warning tests passed');

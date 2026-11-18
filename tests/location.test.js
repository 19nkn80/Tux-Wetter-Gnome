// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {IP_LOCATION_URL, parseIpLocation} from '../gnome-extension/location.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

assert(IP_LOCATION_URL.startsWith('https://'), 'IP location must use HTTPS');
const location = parseIpLocation({
    city: 'Luzern',
    country_code: 'ch',
    latitude: 47.05,
    longitude: 8.306,
    postal: '6000',
});
assert(location.name === 'Luzern' && location.countryCode === 'CH',
    'IP location name and country should be normalized');
assert(location.postcodes[0] === '6000', 'IP location should retain a postal code');

let rejectedInvalidCoordinates = false;
try {
    parseIpLocation({latitude: 100, longitude: 0});
} catch {
    rejectedInvalidCoordinates = true;
}
assert(rejectedInvalidCoordinates, 'invalid IP location coordinates should be rejected');

print('location tests passed');

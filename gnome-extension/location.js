// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

export const IP_LOCATION_URL = 'https://ipapi.co/json/';

export function parseIpLocation(data) {
    const latitude = Number(data?.latitude);
    const longitude = Number(data?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
        throw new Error('Der IP-Standortdienst hat einen ungültigen Breitengrad geliefert.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
        throw new Error('Der IP-Standortdienst hat einen ungültigen Längengrad geliefert.');

    return {
        latitude,
        longitude,
        name: [data.city, data.region, data.country_name]
            .find(value => typeof value === 'string' && value.trim())?.trim() ?? '',
        countryCode: typeof data.country_code === 'string'
            ? data.country_code.toUpperCase()
            : '',
        postcodes: typeof data.postal === 'string' && data.postal.trim()
            ? [data.postal.trim()]
            : [],
    };
}

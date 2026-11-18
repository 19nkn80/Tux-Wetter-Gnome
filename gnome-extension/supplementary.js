// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

function assertCoordinates(latitude, longitude) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
        throw new Error('Ungültiger Breitengrad.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
        throw new Error('Ungültiger Längengrad.');
}

function queryUrl(base, params) {
    const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return `${base}?${query}`;
}

export function moonRequestUrl(latitude, longitude) {
    assertCoordinates(latitude, longitude);
    return queryUrl('https://api.open-meteo.com/v1/forecast', {
        latitude: String(latitude),
        longitude: String(longitude),
        daily: 'moonrise,moonset,moon_phase',
        forecast_days: '1',
        timezone: 'auto',
    });
}

export function precipitation15RequestUrl(latitude, longitude) {
    assertCoordinates(latitude, longitude);
    return queryUrl('https://api.open-meteo.com/v1/forecast', {
        latitude: String(latitude),
        longitude: String(longitude),
        minutely_15: 'precipitation,precipitation_probability',
        forecast_days: '1',
        timezone: 'auto',
    });
}

export function airQualityRequestUrl(latitude, longitude) {
    assertCoordinates(latitude, longitude);
    return queryUrl('https://air-quality-api.open-meteo.com/v1/air-quality', {
        latitude: String(latitude),
        longitude: String(longitude),
        current: 'european_aqi,pm2_5,pm10,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen',
        hourly: 'european_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen',
        forecast_days: '4',
        timezone: 'auto',
    });
}

export function parseMoonData(data) {
    const daily = data?.daily;
    if (!Array.isArray(daily?.time) || !Array.isArray(daily.moon_phase) ||
        !daily.time.length || !Number.isFinite(daily.moon_phase[0]))
        throw new Error('Open-Meteo hat unvollständige Monddaten geliefert.');
    return {
        date: daily.time[0],
        timeZone: data.timezone || 'UTC',
        phase: daily.moon_phase[0],
        rise: typeof daily.moonrise?.[0] === 'string'
            ? daily.moonrise[0].slice(11, 16)
            : null,
        set: typeof daily.moonset?.[0] === 'string'
            ? daily.moonset[0].slice(11, 16)
            : null,
    };
}

export function parsePrecipitation15(data, now = new Date()) {
    const times = data?.minutely_15?.time;
    const amounts = data?.minutely_15?.precipitation;
    if (!Array.isArray(times) || !Array.isArray(amounts) ||
        times.length !== amounts.length)
        throw new Error('Open-Meteo hat unvollständige 15-Minuten-Niederschlagsdaten geliefert.');

    const nowLocal = localDateTime(now, data.timezone || 'UTC');
    const periods = [];
    for (let i = 0; i < times.length && periods.length < 8; i++) {
        if (typeof times[i] !== 'string' || times[i] < nowLocal ||
            !Number.isFinite(amounts[i]))
            continue;
        periods.push({
            time: times[i].slice(11, 16),
            amount: amounts[i],
            probability: Number.isFinite(data.minutely_15.precipitation_probability?.[i])
                ? data.minutely_15.precipitation_probability[i]
                : null,
        });
    }

    const firstRain = periods.find(period => period.amount > 0);
    return {
        periods,
        startsAt: firstRain?.time ?? null,
        total: periods.reduce((sum, period) => sum + period.amount, 0),
    };
}

export function parseAirQuality(data) {
    const current = data?.current;
    if (!current || !Number.isFinite(current.european_aqi))
        throw new Error('Open-Meteo hat unvollständige Luftqualitätsdaten geliefert.');
    const pollen = [
        ['alder_pollen', 'alder'],
        ['birch_pollen', 'birch'],
        ['grass_pollen', 'grass'],
        ['mugwort_pollen', 'mugwort'],
        ['olive_pollen', 'olive'],
        ['ragweed_pollen', 'ragweed'],
    ].filter(([key]) => Number.isFinite(current[key]))
        .map(([key, name]) => ({name, value: current[key]}));
    return {
        aqi: current.european_aqi,
        pm25: Number.isFinite(current.pm2_5) ? current.pm2_5 : null,
        pm10: Number.isFinite(current.pm10) ? current.pm10 : null,
        pollen,
        time: current.time ?? null,
    };
}

export function airQualityLevel(aqi) {
    if (!Number.isFinite(aqi) || aqi < 0)
        throw new Error('Ungültiger europäischer Luftqualitätsindex.');
    if (aqi <= 20)
        return {key: 'good', labelDe: 'Gut', labelEn: 'Good'};
    if (aqi <= 40)
        return {key: 'fair', labelDe: 'Mässig', labelEn: 'Fair'};
    if (aqi <= 60)
        return {key: 'moderate', labelDe: 'Mässig', labelEn: 'Moderate'};
    if (aqi <= 80)
        return {key: 'poor', labelDe: 'Schlecht', labelEn: 'Poor'};
    if (aqi <= 100)
        return {key: 'very-poor', labelDe: 'Sehr schlecht', labelEn: 'Very poor'};
    return {key: 'extremely-poor', labelDe: 'Extrem schlecht', labelEn: 'Extremely poor'};
}

function localDateTime(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

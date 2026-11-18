// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {forecastUrl, parseForecast} from './weather.js';

const MET_NORWAY_USER_AGENT =
    'TuXWetterGnome/0.2 (https://github.com/19nkn80/Tux-Wetter-Gnome)';

export const WEATHER_PROVIDERS = [
    {
        id: 'open-meteo',
        labelDe: 'Open-Meteo (automatisch)',
        labelEn: 'Open-Meteo (automatic)',
        sourceDe: 'Daten: Open-Meteo',
        sourceEn: 'Data: Open-Meteo',
        url: 'https://open-meteo.com/en/docs',
    },
    {
        id: 'dwd-icon-d2',
        labelDe: 'DWD ICON-D2 (über Open-Meteo)',
        labelEn: 'DWD ICON-D2 (via Open-Meteo)',
        sourceDe: 'Daten: DWD ICON-D2 via Open-Meteo',
        sourceEn: 'Data: DWD ICON-D2 via Open-Meteo',
        url: 'https://open-meteo.com/en/docs/dwd-api',
    },
    {
        id: 'geosphere-austria',
        labelDe: 'GeoSphere Austria',
        labelEn: 'GeoSphere Austria',
        sourceDe: 'Daten: GeoSphere Austria · CC BY 4.0',
        sourceEn: 'Data: GeoSphere Austria · CC BY 4.0',
        url: 'https://data.hub.geosphere.at/dataset/nwp-v2-1h-1km',
    },
    {
        id: 'meteoswiss-icon-ch2',
        labelDe: 'MeteoSwiss ICON-CH2 (über Open-Meteo)',
        labelEn: 'MeteoSwiss ICON-CH2 (via Open-Meteo)',
        sourceDe: 'Daten: MeteoSwiss ICON-CH2 via Open-Meteo',
        sourceEn: 'Data: MeteoSwiss ICON-CH2 via Open-Meteo',
        url: 'https://open-meteo.com/en/docs/meteoswiss-api',
    },
    {
        id: 'met-norway',
        labelDe: 'MET Norway / Yr',
        labelEn: 'MET Norway / Yr',
        sourceDe: 'Daten: MET Norway / Yr',
        sourceEn: 'Data: MET Norway / Yr',
        url: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
    },
];

export function forecastRequest(providerId, latitude, longitude) {
    const standardUrl = forecastUrl(latitude, longitude);
    switch (providerId) {
    case 'open-meteo':
        return {url: standardUrl, headers: {}};
    case 'dwd-icon-d2':
        return {
            url: `${standardUrl}&models=dwd_icon_d2`,
            headers: {},
        };
    case 'meteoswiss-icon-ch2':
        return {
            url: `${standardUrl}&models=meteoswiss_icon_ch2`,
            headers: {},
        };
    case 'geosphere-austria': {
        const parameters = '2t,sy,tp,rain,10u,10v,10fg,2r,tcc,sf';
        const query = `parameters=${encodeURIComponent(parameters)}`
            + `&lat_lon=${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        return {
            url: `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v2-1h-1km?${query}`,
            headers: {},
        };
    }
    case 'met-norway':
        return {
            url: 'https://api.met.no/weatherapi/locationforecast/2.0/compact'
                + `?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
            headers: {'User-Agent': MET_NORWAY_USER_AGENT},
        };
    default:
        throw new Error(`Unbekannter Wetterdienst: ${providerId}`);
    }
}

export function parseProviderForecast(data, providerId) {
    switch (providerId) {
    case 'open-meteo':
    case 'dwd-icon-d2':
    case 'meteoswiss-icon-ch2':
        return parseForecast(data);
    case 'geosphere-austria':
        return parseGeoSphereForecast(data);
    case 'met-norway':
        return parseMetNorwayForecast(data);
    default:
        throw new Error(`Unbekannter Wetterdienst: ${providerId}`);
    }
}

function parseGeoSphereForecast(data) {
    const timestamps = data?.timestamps;
    const parameters = data?.features?.[0]?.properties?.parameters;
    if (!Array.isArray(timestamps) || !timestamps.length ||
        !Array.isArray(parameters?.['2t']?.data))
        throw new Error('GeoSphere Austria hat unvollständige Vorhersagedaten geliefert.');

    const values = name => parameters[name]?.data ?? [];
    const temperature = values('2t');
    const symbol = values('sy');
    const totalPrecipitation = values('tp');
    const rain = values('rain');
    const snowfall = values('sf');
    const eastWind = values('10u');
    const northWind = values('10v');
    const gust = values('10fg');
    const humidity = values('2r');
    const cloudCover = values('tcc');
    const rows = [];

    for (let i = 0; i < timestamps.length; i++) {
        if (!Number.isFinite(temperature[i]))
            continue;
        const east = eastWind[i];
        const north = northWind[i];
        const windSpeed = Number.isFinite(east) && Number.isFinite(north)
            ? Math.hypot(east, north) * 3.6
            : null;
        const windDirection = windSpeed > 0.1
            ? (Math.atan2(-east, -north) * 180 / Math.PI + 360) % 360
            : null;
        const time = timestamps[i];
        const localHour = new Date(time).getHours();
        rows.push({
            time,
            temperature: temperature[i],
            feelsLike: null,
            humidity: Number.isFinite(humidity[i]) ? humidity[i] : null,
            wind: windSpeed,
            windDirection,
            gust: Number.isFinite(gust[i]) ? gust[i] * 3.6 : null,
            precipitation: null,
            precipitationSum: Number.isFinite(totalPrecipitation[i])
                ? totalPrecipitation[i]
                : null,
            snowfall: Number.isFinite(snowfall[i]) ? snowfall[i] * 0.7 : null,
            code: geoSphereWeatherCode(
                symbol[i], temperature[i], cloudCover[i], totalPrecipitation[i], rain[i]),
            isDay: localHour >= 6 && localHour < 20,
        });
    }
    return aggregateForecastRows(rows);
}

function geoSphereWeatherCode(symbol, temperature, cloudCover, totalPrecipitation, rain) {
    if (Number.isFinite(symbol)) {
        if (symbol === 1)
            return 0;
        if (symbol === 2)
            return 1;
        if (symbol === 3)
            return 2;
        if ([4, 5, 7].includes(symbol))
            return symbol === 5 || symbol === 7 ? 3 : 2;
        if (symbol === 6)
            return 45;
        if (symbol >= 8 && symbol <= 10)
            return 61;
        if (symbol >= 11 && symbol <= 13)
            return 67;
        if (symbol >= 14 && symbol <= 16)
            return 73;
        if (symbol >= 17 && symbol <= 19)
            return 80;
        if (symbol >= 20 && symbol <= 22)
            return 67;
        if (symbol >= 23 && symbol <= 25)
            return 85;
        if (symbol >= 26 && symbol <= 32)
            return 95;
    }

    if (Number.isFinite(rain) && rain > 0.1)
        return temperature <= 0 ? 71 : 61;
    if (Number.isFinite(totalPrecipitation) && totalPrecipitation > 0.1)
        return temperature <= 0 ? 71 : 61;
    if (Number.isFinite(cloudCover)) {
        if (cloudCover < 10)
            return 0;
        if (cloudCover < 30)
            return 1;
        if (cloudCover < 70)
            return 2;
    }
    return 3;
}

function parseMetNorwayForecast(data) {
    const timeseries = data?.properties?.timeseries;
    if (!Array.isArray(timeseries) || !timeseries.length)
        throw new Error('MET Norway hat unvollständige Vorhersagedaten geliefert.');

    const rows = timeseries.map(item => {
        const instant = item?.data?.instant?.details;
        if (!instant || !Number.isFinite(instant.air_temperature))
            return null;
        const period = item.data.next_1_hours ?? item.data.next_6_hours ??
            item.data.next_12_hours ?? null;
        const symbol = period?.summary?.symbol_code ?? null;
        const amount = period?.details?.precipitation_amount;
        const gust = instant.wind_speed_of_gust;
        const hour = new Date(item.time).getHours();
        return {
            time: item.time,
            temperature: instant.air_temperature,
            feelsLike: Number.isFinite(instant.apparent_temperature)
                ? instant.apparent_temperature
                : null,
            humidity: Number.isFinite(instant.relative_humidity)
                ? instant.relative_humidity
                : null,
            wind: Number.isFinite(instant.wind_speed) ? instant.wind_speed * 3.6 : null,
            windDirection: Number.isFinite(instant.wind_from_direction)
                ? instant.wind_from_direction
                : null,
            gust: Number.isFinite(gust) ? gust * 3.6 : null,
            precipitation: null,
            precipitationSum: Number.isFinite(amount) ? amount : null,
            snowfall: null,
            code: metNorwayWeatherCode(symbol),
            isDay: symbol
                ? !symbol.endsWith('_night')
                : hour >= 6 && hour < 20,
        };
    }).filter(Boolean);

    return aggregateForecastRows(rows);
}

function metNorwayWeatherCode(symbol) {
    if (typeof symbol !== 'string')
        return 3;
    const name = symbol.replace(/_(day|night|polartwilight)$/, '');
    if (name.includes('thunder'))
        return name.includes('heavy') ? 99 : 95;
    if (name.includes('fog'))
        return 45;
    if (name.includes('sleet'))
        return 67;
    if (name.includes('snow')) {
        if (name.includes('showers'))
            return name.includes('heavy') ? 86 : 85;
        if (name.includes('heavy'))
            return 75;
        if (name.includes('light'))
            return 71;
        return 73;
    }
    if (name.includes('rain')) {
        if (name.includes('showers'))
            return name.includes('heavy') ? 82 : name.includes('light') ? 80 : 81;
        if (name.includes('heavy'))
            return 65;
        if (name.includes('light'))
            return 51;
        return 61;
    }
    if (name === 'clearsky')
        return 0;
    if (name === 'fair')
        return 1;
    if (name === 'partlycloudy')
        return 2;
    if (name === 'cloudy')
        return 3;
    return 3;
}

function aggregateForecastRows(rows) {
    if (!rows.length)
        throw new Error('Der Wetterdienst hat keine verwendbaren Vorhersagewerte geliefert.');

    const now = Date.now();
    let currentIndex = rows.findIndex(row => new Date(row.time).getTime() >= now);
    if (currentIndex < 0)
        currentIndex = rows.length - 1;
    const current = rows[currentIndex];
    const groups = new Map();
    const hourlyByDate = {};
    for (const row of rows.slice(currentIndex)) {
        const date = localDateKey(row.time);
        hourlyByDate[date] ??= [];
        hourlyByDate[date].push({
            time: formatLocalTime(row.time),
            temperature: row.temperature,
            code: row.code,
            isDay: row.isDay,
            precipitation: row.precipitationSum,
            precipitationProbability: row.precipitation,
        });
        if (!groups.has(date)) {
            groups.set(date, {
                date,
                high: row.temperature,
                low: row.temperature,
                codes: [row.code],
                precipitationSum: row.precipitationSum ?? 0,
                snowfall: row.snowfall ?? 0,
                hasPrecipitation: Number.isFinite(row.precipitationSum),
                hasSnowfall: Number.isFinite(row.snowfall),
            });
        } else {
            const day = groups.get(date);
            day.high = Math.max(day.high, row.temperature);
            day.low = Math.min(day.low, row.temperature);
            day.codes.push(row.code);
            day.precipitationSum += row.precipitationSum ?? 0;
            day.snowfall += row.snowfall ?? 0;
            day.hasPrecipitation ||= Number.isFinite(row.precipitationSum);
            day.hasSnowfall ||= Number.isFinite(row.snowfall);
        }
    }

    const days = [...groups.values()].map(day => ({
        date: day.date,
        code: mostSevereCode(day.codes),
        high: day.high,
        low: day.low,
        precipitation: null,
        precipitationSum: day.hasPrecipitation ? day.precipitationSum : null,
        snowfall: day.hasSnowfall ? day.snowfall : null,
    }));
    const today = days[0] ?? null;
    const maxGust = rows.slice(currentIndex, currentIndex + 25)
        .reduce((max, row) => Math.max(max, row.gust ?? 0), current.gust ?? 0);
    const gustRow = rows.slice(currentIndex, currentIndex + 25)
        .find(row => row.gust === maxGust);
    const windWarningLevel = maxGust >= 118 ? 4 : maxGust >= 89 ? 3
        : maxGust >= 62 ? 2 : maxGust >= 50 ? 1 : 0;

    return {
        temperature: current.temperature,
        feelsLike: current.feelsLike,
        humidity: current.humidity,
        precipitation: current.precipitation,
        wind: current.wind,
        windDirection: current.windDirection,
        windWarning: windWarningLevel
            ? {gust: Math.round(maxGust), time: formatLocalTime(gustRow?.time ?? current.time), level: windWarningLevel}
            : null,
        sunrise: null,
        sunset: null,
        uvIndex: null,
        code: current.code,
        isDay: current.isDay,
        today,
        hourlyByDate,
        hours: rows.slice(currentIndex, currentIndex + 6).map(row => ({
            time: formatLocalTime(row.time),
            temperature: row.temperature,
            code: row.code,
            isDay: row.isDay,
        })),
        days: days.slice(1, 6),
        updatedAt: new Date(),
    };
}

function mostSevereCode(codes) {
    const severity = code => {
        if (code >= 95)
            return 6;
        if (code >= 61 && code <= 86)
            return 5;
        if (code >= 51 && code <= 57)
            return 4;
        if (code === 45 || code === 48)
            return 3;
        if (code === 3)
            return 2;
        if (code === 2)
            return 1;
        return 0;
    };
    return codes.reduce((mostSevere, code) =>
        severity(code) > severity(mostSevere) ? code : mostSevere, codes[0]);
}

function localDateKey(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime()))
        throw new Error(`Ungültiger Zeitpunkt in der Vorhersage: ${timestamp}`);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        + `-${String(date.getDate()).padStart(2, '0')}`;
}

function formatLocalTime(timestamp) {
    return new Intl.DateTimeFormat('de', {hour: '2-digit', minute: '2-digit'})
        .format(new Date(timestamp));
}

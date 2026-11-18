// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

export function forecastUrl(latitude, longitude) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
        throw new Error('Ungültiger Breitengrad.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
        throw new Error('Ungültiger Längengrad.');

    const params = {
        latitude: String(latitude),
        longitude: String(longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
        hourly: 'temperature_2m,apparent_temperature,weather_code,is_day,precipitation,precipitation_probability,wind_gusts_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,sunrise,sunset,uv_index_max',
        timezone: 'auto',
        forecast_days: '6',
    };
    const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

    return `https://api.open-meteo.com/v1/forecast?${query}`;
}

export function geocodingUrl(query, language = 'en') {
    const rawName = query.trim();
    const countryHint = rawName.match(/^(.*?)\s+\(([A-Za-z]{2})\)$/);
    const name = normalizePlaceName(countryHint ? countryHint[1] : rawName);
    if (name.length < 2)
        throw new Error('Bitte mindestens zwei Zeichen für die Ortssuche eingeben.');
    const params = {
        name,
        count: '10',
        language: language.startsWith('de') ? 'de' : 'en',
        format: 'json',
    };
    if (countryHint)
        params.countryCode = countryHint[2].toUpperCase();
    const search = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return `https://geocoding-api.open-meteo.com/v1/search?${search}`;
}

function normalizePlaceName(name) {
    const normalized = name.trim();
    const aliases = new Map([
        ['zuerich', 'Zürich'],
        ['zurich', 'Zürich'],
        ['geneve', 'Genève'],
        ['geneva', 'Genève'],
        ['fuerth', 'Fürth'],
        ['muenchen', 'München'],
        ['munich', 'München'],
    ]);
    return aliases.get(normalized.toLocaleLowerCase()) ?? normalized;
}

export function parseGeocodingResults(data) {
    if (data?.results === undefined)
        return [];
    if (!Array.isArray(data.results))
        throw new Error('Der Ortsdienst hat ungültige Suchergebnisse geliefert.');
    return data.results.filter(place =>
        place && typeof place.name === 'string' &&
        Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90 &&
        Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180);
}

export function parseForecast(data) {
    const current = data?.current;
    const hourly = data?.hourly;
    const daily = data?.daily;
    if (!current || !hourly || !daily ||
        !Array.isArray(hourly.time) || !Array.isArray(hourly.temperature_2m) ||
        !Array.isArray(hourly.weather_code) || !Array.isArray(daily.time) ||
        !Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.temperature_2m_min))
        throw new Error('Der Wetterdienst hat unvollständige Vorhersagedaten geliefert.');
    if (!Number.isFinite(current.temperature_2m) || !Number.isFinite(current.weather_code))
        throw new Error('Der Wetterdienst hat keine aktuelle Temperatur geliefert.');

    const currentHour = `${current.time.slice(0, 13)}:00`;
    let firstHour = hourly.time.indexOf(currentHour);
    if (firstHour < 0)
        firstHour = 0;
    const hours = [];
    const hourlyByDate = {};
    for (let i = firstHour; i < hourly.time.length && hours.length < 6; i++) {
        if (hourly.time[i] < current.time ||
            !Number.isFinite(hourly.temperature_2m[i]) ||
            !Number.isFinite(hourly.weather_code[i]))
            continue;
        hours.push({
            time: hourly.time[i].slice(11, 16),
            temperature: hourly.temperature_2m[i],
            code: hourly.weather_code[i],
            isDay: hourly.is_day?.[i] === 1,
        });
    }
    for (let i = firstHour; i < hourly.time.length; i++) {
        const time = hourly.time[i];
        const temperature = hourly.temperature_2m[i];
        if (time < current.time || !Number.isFinite(temperature) ||
            !Number.isFinite(hourly.weather_code[i]))
            continue;
        const date = time.slice(0, 10);
        hourlyByDate[date] ??= [];
        hourlyByDate[date].push({
            time: time.slice(11, 16),
            temperature,
            code: hourly.weather_code[i],
            isDay: hourly.is_day?.[i] === 1,
            precipitation: Number.isFinite(hourly.precipitation?.[i])
                ? hourly.precipitation[i]
                : null,
            precipitationProbability: Number.isFinite(hourly.precipitation_probability?.[i])
                ? hourly.precipitation_probability[i]
                : null,
        });
    }

    const dayAt = i => {
        if (!Number.isFinite(daily.temperature_2m_max[i]) ||
            !Number.isFinite(daily.temperature_2m_min[i]))
            return null;
        return {
            date: daily.time[i],
            code: Number.isFinite(daily.weather_code?.[i]) ? daily.weather_code[i] : 3,
            high: daily.temperature_2m_max[i],
            low: daily.temperature_2m_min[i],
            precipitation: daily.precipitation_probability_max?.[i] ?? null,
            precipitationSum: daily.precipitation_sum?.[i] ?? null,
            snowfall: daily.snowfall_sum?.[i] ?? null,
        };
    };
    const today = dayAt(0);
    const days = [];
    for (let i = 1; i < daily.time.length && days.length < 5; i++) {
        const day = dayAt(i);
        if (day)
            days.push(day);
    }

    let maxGust = Number.isFinite(current.wind_gusts_10m) ? current.wind_gusts_10m : 0;
    let maxGustTime = current.time;
    for (let i = firstHour; i < Math.min(hourly.time.length, firstHour + 25); i++) {
        const gust = hourly.wind_gusts_10m?.[i];
        if (Number.isFinite(gust) && gust > maxGust) {
            maxGust = gust;
            maxGustTime = hourly.time[i];
        }
    }
    const windWarningLevel = maxGust >= 118 ? 4 : maxGust >= 89 ? 3 : maxGust >= 62 ? 2 : maxGust >= 50 ? 1 : 0;

    return {
        temperature: current.temperature_2m,
        feelsLike: Number.isFinite(current.apparent_temperature) ? current.apparent_temperature : null,
        humidity: Number.isFinite(current.relative_humidity_2m) ? current.relative_humidity_2m : null,
        precipitation: Number.isFinite(daily.precipitation_probability_max?.[0])
            ? daily.precipitation_probability_max[0]
            : null,
        wind: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
        windDirection: Number.isFinite(current.wind_direction_10m) ? current.wind_direction_10m : null,
        windWarning: windWarningLevel
            ? {gust: Math.round(maxGust), time: maxGustTime.slice(11, 16), level: windWarningLevel}
            : null,
        sunrise: daily.sunrise?.[0]?.slice(11, 16) ?? null,
        sunset: daily.sunset?.[0]?.slice(11, 16) ?? null,
        uvIndex: Number.isFinite(daily.uv_index_max?.[0]) ? daily.uv_index_max[0] : null,
        code: current.weather_code,
        isDay: current.is_day === 1,
        today,
        hours,
        days,
        hourlyByDate,
        updatedAt: new Date(),
    };
}

export function conditionForCode(code, isDay, language = 'en') {
    const german = typeof language === 'boolean' ? language : language.startsWith('de');
    if (code === 0)
        return german ? (isDay ? 'Sonnig' : 'Klar') : (isDay ? 'Clear sky' : 'Clear');
    if (code === 1)
        return german ? (isDay ? 'Überwiegend sonnig' : 'Überwiegend klar') : (isDay ? 'Mainly clear' : 'Mainly clear');
    if (code === 2)
        return german ? 'Teilweise bewölkt' : 'Partly cloudy';
    if (code === 3)
        return german ? 'Bedeckt' : 'Overcast';
    if (code === 45 || code === 48)
        return german ? 'Nebel' : 'Fog';
    if (code >= 51 && code <= 57)
        return german ? 'Nieselregen' : 'Drizzle';
    if (code >= 61 && code <= 65)
        return german ? 'Regen' : 'Rain';
    if (code === 66 || code === 67 || code === 68 || code === 69)
        return german ? 'Schneeregen' : 'Sleet';
    if (code >= 71 && code <= 77)
        return german ? 'Schneefall' : 'Snowfall';
    if (code >= 80 && code <= 82)
        return german ? 'Regenschauer' : 'Rain showers';
    if (code === 85 || code === 86)
        return german ? 'Schneeschauer' : 'Snow showers';
    if (code >= 95)
        return german ? 'Gewitter' : 'Thunderstorm';
    return german ? 'Unbekannt' : 'Unknown';
}

export function iconForCode(code, isDay) {
    if (code === 0)
        return isDay ? 'clear-day' : 'clear-night';
    if (code <= 2)
        return isDay ? 'partly-day' : 'partly-night';
    if (code === 3)
        return 'cloudy';
    if (code === 45 || code === 48)
        return 'fog';
    if (code >= 51 && code <= 57)
        return 'drizzle';
    if (code >= 61 && code <= 69)
        return 'rain';
    if (code >= 80 && code <= 82)
        return isDay ? 'showers-day' : 'showers-night';
    if (code >= 71 && code <= 86)
        return 'snow';
    if (code >= 95)
        return 'thunder';
    return 'cloudy';
}

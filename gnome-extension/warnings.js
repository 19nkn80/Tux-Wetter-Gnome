// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

const DWD_WARNING_URL = 'https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json';
const DWD_ZONES_URL = 'https://maps.dwd.de/geoserver/dwd/ows';
const GEOSPHERE_WARNING_URL = 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords';
const METEOSWISS_DETAIL_URL = 'https://app-prod-ws.meteoswiss-app.ch/v1/plzDetail';
const METEOSWISS_USER_AGENT = 'Android-31 ch.admin.meteoswiss-2160000';

function assertCoordinates(latitude, longitude) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
        throw new Error('Ungültiger Breitengrad.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
        throw new Error('Ungültiger Längengrad.');
}

export function dwdZonesUrl(latitude, longitude) {
    assertCoordinates(latitude, longitude);
    const delta = 0.0001;
    const params = {
        service: 'WFS',
        version: '1.1.0',
        request: 'GetFeature',
        typeName: 'dwd:Warngebiete_Gemeinden',
        outputFormat: 'application/json',
        srsName: 'EPSG:4326',
        bbox: `${longitude - delta},${latitude - delta},${longitude + delta},${latitude + delta},EPSG:4326`,
    };
    const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return `${DWD_ZONES_URL}?${query}`;
}

export function dwdWarningsUrl() {
    return DWD_WARNING_URL;
}

export function geoSphereWarningsUrl(latitude, longitude, language = 'de') {
    assertCoordinates(latitude, longitude);
    const params = {
        lon: String(longitude),
        lat: String(latitude),
        lang: language.startsWith('de') ? 'de' : 'en',
    };
    const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return `${GEOSPHERE_WARNING_URL}?${query}`;
}

export function meteoswissWarningsRequest(postalCodes, language = 'de') {
    if (!Array.isArray(postalCodes))
        throw new Error('Ungültige Schweizer Postleitzahlen.');
    const normalized = [...new Set(postalCodes
        .map(code => String(code).replace(/\D/g, ''))
        .filter(code => /^\d{4}$/.test(code)))];
    if (!normalized.length)
        throw new Error('Für MeteoSwiss-Warnungen wird eine Schweizer Postleitzahl benötigt.');
    return {
        urls: normalized.map(code =>
            `${METEOSWISS_DETAIL_URL}?plz=${encodeURIComponent(`${code}00`)}`),
        headers: {
            'User-Agent': METEOSWISS_USER_AGENT,
            'Accept-Language': language.startsWith('de') ? 'de' : 'en',
        },
    };
}

export function parseDwdZones(data, latitude, longitude) {
    assertCoordinates(latitude, longitude);
    if (!Array.isArray(data?.features))
        throw new Error('Der DWD hat ungültige Warngebietsdaten geliefert.');
    return data.features
        .filter(feature => feature?.geometry && pointInGeometry(
            longitude, latitude, feature.geometry))
        .map(feature => feature.properties?.WARNCELLID)
        .filter(id => id !== undefined && id !== null)
        .map(String);
}

export function parseDwdWarnings(data, warningCellIds, now = Date.now()) {
    const payload = unwrapDwdJsonp(data);
    if (!payload || typeof payload.warnings !== 'object' || Array.isArray(payload.warnings))
        throw new Error('Der DWD hat ungültige Warndaten geliefert.');
    const warnings = [];
    for (const id of warningCellIds) {
        const entries = payload.warnings[id];
        if (!Array.isArray(entries))
            continue;
        for (const warning of entries) {
            const parsed = normalizeDwdWarning(warning, id);
            if (parsed && isActive(parsed, now))
                warnings.push(parsed);
        }
    }
    return deduplicateWarnings(warnings);
}

export function parseGeoSphereWarnings(data, now = Date.now()) {
    const entries = data?.properties?.warnings;
    if (!Array.isArray(entries))
        throw new Error('GeoSphere Austria hat ungültige Warndaten geliefert.');
    const warnings = entries
        .map(entry => normalizeGeoSphereWarning(entry?.properties))
        .filter(warning => warning && isActive(warning, now));
    return deduplicateWarnings(warnings);
}

export function parseMeteoSwissWarnings(data, now = Date.now()) {
    if (!Array.isArray(data?.warnings))
        throw new Error('MeteoSwiss hat ungültige Warndaten geliefert.');
    const warnings = data.warnings
        .map(normalizeMeteoSwissWarning)
        .filter(warning => warning && isActive(warning, now));
    return deduplicateWarnings(warnings);
}

export function warningIdentity(warning) {
    return `${warning.source}:${warning.id}`;
}

function unwrapDwdJsonp(data) {
    if (typeof data !== 'string')
        return data;
    const prefix = 'warnWetter.loadWarnings(';
    const body = data.trim();
    if (!body.startsWith(prefix) || !body.endsWith(');'))
        throw new Error('Der DWD hat ungültige JSONP-Warndaten geliefert.');
    try {
        return JSON.parse(body.slice(prefix.length, -2));
    } catch (error) {
        console.error(`TuX-Wetter: DWD-Warndaten: ${error.message}`);
        throw new Error('Die DWD-Warndaten konnten nicht gelesen werden.');
    }
}

function normalizeDwdWarning(warning, cellId) {
    if (!warning || typeof warning !== 'object')
        return null;
    const start = finiteDate(warning.start);
    const end = finiteDate(warning.end);
    if (!start || !end || !Number.isFinite(warning.level))
        return null;
    const id = warning.warnId ?? `${warning.event ?? warning.type}:${start.getTime()}:${cellId}`;
    return {
        id: String(id),
        source: 'dwd',
        level: warning.level,
        type: warningType(warning.event ?? warning.headline ?? warning.description),
        title: String(warning.headline ?? warning.event ?? 'DWD-Wetterwarnung'),
        text: String(warning.description ?? warning.instruction ?? ''),
        start,
        end,
        url: 'https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html',
    };
}

function normalizeGeoSphereWarning(properties) {
    if (!properties || !Number.isFinite(Number(properties.warnstufeid)))
        return null;
    const start = finiteDate(Number(properties.rawinfo?.start) * 1000)
        ?? parseGeoSphereDate(properties.begin);
    const end = finiteDate(Number(properties.rawinfo?.end) * 1000)
        ?? parseGeoSphereDate(properties.end);
    if (!start || !end)
        return null;
    return {
        id: String(properties.warnid ?? `${properties.warntypid}:${start.getTime()}`),
        source: 'geosphere',
        level: Number(properties.warnstufeid),
        type: geoSphereType(properties.warntypid),
        title: String(properties.text ?? 'GeoSphere-Wetterwarnung'),
        text: [properties.meteotext, properties.auswirkungen, properties.empfehlungen]
            .filter(value => typeof value === 'string' && value.trim())
            .join('\n\n'),
        start,
        end,
        url: 'https://warnungen.zamg.at/',
    };
}

function normalizeMeteoSwissWarning(warning) {
    if (!warning || typeof warning !== 'object' ||
        !Number.isFinite(Number(warning.warnLevel)))
        return null;
    const start = finiteDate(warning.validFrom);
    const end = finiteDate(warning.validTo);
    if (!start || !end)
        return null;
    return {
        id: String(warning.id ?? `${warning.warnType}:${start.getTime()}`),
        source: 'meteoswiss',
        level: Number(warning.warnLevel),
        type: meteoswissType(warning.warnType),
        title: String(warning.title ?? warning.text ?? 'MeteoSwiss-Wetterwarnung'),
        text: String(warning.description ?? warning.text ?? ''),
        start,
        end,
        url: 'https://www.meteoswiss.admin.ch/weather/hazards/hazard-map.html',
    };
}

function finiteDate(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return null;
    const date = new Date(number);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseGeoSphereDate(value) {
    if (typeof value !== 'string')
        return null;
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/);
    if (!match)
        return null;
    return new Date(
        Number(match[3]), Number(match[2]) - 1, Number(match[1]),
        Number(match[4]), Number(match[5]));
}

function isActive(warning, now) {
    return warning.start.getTime() <= now && warning.end.getTime() > now;
}

function warningType(value) {
    const name = String(value).toLocaleLowerCase('de');
    if (/wind|sturm|bö|gust/.test(name))
        return 'wind';
    if (/gewitter|thunder/.test(name))
        return 'thunderstorm';
    if (/regen|rain|niederschlag/.test(name))
        return 'rain';
    if (/schnee|snow/.test(name))
        return 'snow';
    if (/glätte|eis|ice/.test(name))
        return 'ice';
    if (/frost|kälte|cold/.test(name))
        return 'frost';
    if (/hitze|heat/.test(name))
        return 'heat';
    return 'other';
}

function geoSphereType(type) {
    return ({
        1: 'wind',
        2: 'rain',
        3: 'snow',
        4: 'ice',
        5: 'thunderstorm',
        6: 'heat',
        7: 'frost',
    })[Number(type)] ?? 'other';
}

function meteoswissType(type) {
    return ({
        1: 'wind',
        2: 'rain',
        3: 'snow',
        4: 'ice',
        5: 'thunderstorm',
        6: 'frost',
        7: 'heat',
    })[Number(type)] ?? 'other';
}

function deduplicateWarnings(warnings) {
    const unique = new Map();
    for (const warning of warnings) {
        const key = warningIdentity(warning);
        if (!unique.has(key) || unique.get(key).level < warning.level)
            unique.set(key, warning);
    }
    return [...unique.values()].sort((first, second) =>
        second.level - first.level || first.start - second.start);
}

function pointInGeometry(longitude, latitude, geometry) {
    if (geometry.type === 'Polygon')
        return pointInPolygon(longitude, latitude, geometry.coordinates);
    if (geometry.type === 'MultiPolygon')
        return geometry.coordinates.some(polygon =>
            pointInPolygon(longitude, latitude, polygon));
    return false;
}

function pointInPolygon(longitude, latitude, rings) {
    if (!Array.isArray(rings) || !rings.length ||
        !pointInRing(longitude, latitude, rings[0]))
        return false;
    return !rings.slice(1).some(ring => pointInRing(longitude, latitude, ring));
}

function pointInRing(longitude, latitude, ring) {
    if (!Array.isArray(ring) || ring.length < 4)
        return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const cross = (longitude - xi) * (yj - yi) - (latitude - yi) * (xj - xi);
        const within = longitude >= Math.min(xi, xj) - 1e-9 &&
            longitude <= Math.max(xi, xj) + 1e-9 &&
            latitude >= Math.min(yi, yj) - 1e-9 &&
            latitude <= Math.max(yi, yj) + 1e-9;
        if (Math.abs(cross) < 1e-9 && within)
            return true;
        if ((yi > latitude) !== (yj > latitude) &&
            longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

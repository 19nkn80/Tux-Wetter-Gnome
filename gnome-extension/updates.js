// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

export const RELEASE_API_URL = 'https://api.github.com/repos/19nkn80/Tux-Wetter-Gnome/releases/latest';

export function releaseRequestHeaders(version) {
    return {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `TuXWetterGnome/${version} (https://github.com/19nkn80/Tux-Wetter-Gnome)`,
    };
}

function versionParts(version) {
    if (typeof version !== 'string' || !/^v?\d+(?:\.\d+)*$/i.test(version))
        throw new Error(`Ungültige Version: ${version}`);
    return version.replace(/^v/i, '').split('.').map(Number);
}

export function compareVersions(first, second) {
    const firstParts = versionParts(first);
    const secondParts = versionParts(second);
    const length = Math.max(firstParts.length, secondParts.length);

    for (let i = 0; i < length; i++) {
        const difference = (firstParts[i] ?? 0) - (secondParts[i] ?? 0);
        if (difference !== 0)
            return Math.sign(difference);
    }

    return 0;
}

export function newerRelease(release, currentVersion) {
    if (!release || typeof release.tag_name !== 'string')
        throw new Error('GitHub hat ein Release ohne Versionsnummer geliefert.');

    const version = release.tag_name.replace(/^v/i, '');
    if (compareVersions(version, currentVersion) <= 0)
        return null;

    if (typeof release.html_url !== 'string' ||
        !/^https:\/\/github\.com\/19nkn80\/Tux-Wetter-Gnome\/releases\/[A-Za-z0-9._/-]+$/.test(
            release.html_url)) {
        throw new Error('Die Release-Adresse von GitHub liegt außerhalb des Projekt-Repositorys.');
    }

    return {version, url: release.html_url};
}

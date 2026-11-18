// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

export function compareVersions(left, right) {
    const parse = version => {
        if (typeof version !== 'string' || !/^\d+(?:\.\d+)*$/.test(version))
            throw new Error(`Invalid version: ${version}`);
        const parts = version.split('.').map(Number);
        if (parts.some(part => !Number.isSafeInteger(part)))
            throw new Error(`Invalid version: ${version}`);
        return parts;
    };
    const a = parse(left);
    const b = parse(right);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0)
            return Math.sign(difference);
    }
    return 0;
}

export function updateCandidate(metadata, currentVersion, uuid, shellVersion) {
    if (!metadata || metadata.uuid !== uuid ||
        !Array.isArray(metadata['shell-version']) ||
        !metadata['shell-version'].includes(shellVersion))
        throw new Error('The update metadata does not match this extension or GNOME version');
    const version = metadata['version-name'];
    return compareVersions(version, currentVersion) > 0 ? version : null;
}

export function updateCommit(data) {
    if (typeof data?.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(data.sha))
        throw new Error('GitHub returned an invalid commit identifier');
    return data.sha;
}

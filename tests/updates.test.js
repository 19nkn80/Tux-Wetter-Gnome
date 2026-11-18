// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {compareVersions, newerRelease, releaseRequestHeaders} from '../gnome-extension/updates.js';
import {displayError} from '../gnome-extension/errors.js';
import {isGerman, text} from '../gnome-extension/ui-language.js';
import {updateAsset} from '../gnome-extension/update-service.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

assert(isGerman() && text('Deutsch', 'English') === 'Deutsch',
    'the interface should use German even when the system locale is not German');
assert(displayError(new Error('HTTP-Fehler 403')) === 'HTTP-Fehler 403',
    'known errors should retain their German details');
assert(displayError(new SyntaxError('unexpected token')).startsWith('Technischer Fehler'),
    'runtime errors should not expose untranslated diagnostics in the interface');
assert(releaseRequestHeaders('0.2')['User-Agent'].includes('TuXWetterGnome/0.2'),
    'GitHub requests must identify the installed extension version');
const releaseWithAsset = {
    tag_name: 'v0.2',
    html_url: 'https://github.com/19nkn80/Tux-Wetter-Gnome/releases/tag/v0.2',
    assets: [{
        name: 'tuxwetter@tuxwetter.ch.shell-extension.zip',
        state: 'uploaded',
        browser_download_url: 'https://github.com/19nkn80/Tux-Wetter-Gnome/releases/download/v0.2/tuxwetter%40tuxwetter.ch.shell-extension.zip',
        size: 1024,
        digest: `sha256:${'a'.repeat(64)}`,
    }],
};
assert(updateAsset(releaseWithAsset, '0.1')?.checksum === 'a'.repeat(64),
    'a newer release must include a verifiable installable asset');
for (const asset of [
    {...releaseWithAsset.assets[0], browser_download_url: 'https://example.com/update.zip'},
    {...releaseWithAsset.assets[0], digest: null},
    {...releaseWithAsset.assets[0], size: 21 * 1024 * 1024},
]) {
    let rejected = false;
    try {
        updateAsset({...releaseWithAsset, assets: [asset]}, '0.1');
    } catch {
        rejected = true;
    }
    assert(rejected, 'unsafe or unverifiable update assets must be rejected');
}
assert(updateAsset(releaseWithAsset, '0.2') === null,
    'the currently installed release must not trigger an update');
assert(compareVersions('v0.2', '0.1') === 1, 'newer versions should compare greater');
assert(compareVersions('0.10', '0.2') === 1, 'version parts should compare numerically');
assert(compareVersions('0.1.0', '0.1') === 0, 'trailing zero parts should compare equal');
assert(newerRelease({
    tag_name: 'v0.2',
    html_url: 'https://github.com/19nkn80/Tux-Wetter-Gnome/releases/tag/v0.2',
}, '0.1')?.version === '0.2', 'newer GitHub releases should be returned');
assert(newerRelease({
    tag_name: 'v0.1',
    html_url: 'https://github.com/19nkn80/Tux-Wetter-Gnome/releases/tag/v0.1',
}, '0.1') === null, 'the current release should not be reported as an update');

let rejectedUnsafeUrl = false;
try {
    newerRelease({
        tag_name: 'v0.2',
        html_url: 'https://example.com/releases/tag/v0.2',
    }, '0.1');
} catch {
    rejectedUnsafeUrl = true;
}
assert(rejectedUnsafeUrl, 'release links outside the project should be rejected');

let rejectedInvalidVersion = false;
try {
    compareVersions('latest', '0.1');
} catch {
    rejectedInvalidVersion = true;
}
assert(rejectedInvalidVersion, 'invalid version strings should be rejected');

print('update tests passed');

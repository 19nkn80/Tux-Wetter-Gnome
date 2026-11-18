// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {compareVersions, newerRelease} from '../gnome-extension/updates.js';
import {displayError} from '../gnome-extension/errors.js';
import {isGerman, text} from '../gnome-extension/ui-language.js';

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

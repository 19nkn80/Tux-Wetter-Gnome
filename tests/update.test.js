// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import {compareVersions, updateCandidate, updateCommit} from '../gnome-extension/update.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertThrows(action, message) {
    let thrown = false;
    try {
        action();
    } catch {
        thrown = true;
    }
    assert(thrown, message);
}

const uuid = 'tuxwetter@tuxwetter.ch';
const metadata = {uuid, 'shell-version': ['46'], 'version-name': '0.2'};
assert(compareVersions('0.2', '0.1') > 0, '0.2 must be newer than 0.1');
assert(compareVersions('0.10', '0.2') > 0, 'version components must be compared numerically');
assert(compareVersions('0.2.0', '0.2') === 0, 'trailing zero components must be equal');
assert(compareVersions('0.1', '0.2') < 0, 'older versions must not be offered');
assert(updateCandidate(metadata, '0.1', uuid, '46') === '0.2', 'new version must be offered');
assert(updateCandidate(metadata, '0.2', uuid, '46') === null, 'installed version must not be offered');
assert(updateCandidate(metadata, '0.3', uuid, '46') === null, 'downgrades must not be offered');
assertThrows(() => compareVersions('0.2-beta', '0.1'), 'invalid versions must be rejected');
assertThrows(() => updateCandidate({...metadata, uuid: 'other'}, '0.1', uuid, '46'),
    'a different extension must be rejected');
assertThrows(() => updateCandidate(metadata, '0.1', uuid, '47'),
    'an incompatible GNOME version must be rejected');
assertThrows(() => updateCandidate({...metadata, 'version-name': undefined}, '0.1', uuid, '46'),
    'missing version names must be rejected');
assert(updateCommit({sha: 'a'.repeat(40)}) === 'a'.repeat(40), 'valid commit must be accepted');
assertThrows(() => updateCommit({sha: '../Zorin181'}), 'invalid commit must be rejected');

print('update tests passed');

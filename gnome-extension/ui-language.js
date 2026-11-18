// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

export function isGerman(language = GLib.get_language_names()[0]) {
    return /^de(?:[_-]|$)/i.test(language ?? '');
}

export function text(german, english, language = GLib.get_language_names()[0]) {
    return isGerman(language) ? german : english;
}

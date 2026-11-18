// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const root = Gio.File.new_for_path(GLib.get_current_dir());
const extension = root.get_child('gnome-extension');
const enumerator = extension.enumerate_children(
    'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
let info;
while ((info = enumerator.next_file(null))) {
    if (info.get_file_type() !== Gio.FileType.REGULAR || !info.get_name().endsWith('.js'))
        continue;
    const path = extension.get_child(info.get_name()).get_path();
    const process = Gio.Subprocess.new(
        ['gjs', '-m', path],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, stdout, stderr] = process.communicate_utf8(null, null);
    const output = `${stderr || ''}${stdout || ''}`;
    if (output.includes('SyntaxError:') || output.includes('Failed to parse module'))
        throw new Error(`Syntaxfehler in ${path}: ${output.trim()}`);
}
print('extension syntax tests passed');

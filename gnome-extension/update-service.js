// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {compareVersions, newerRelease, RELEASE_API_URL} from './updates.js';

const ASSET_NAME = 'tuxwetter@tuxwetter.ch.shell-extension.zip';
const MAX_ASSET_SIZE = 20 * 1024 * 1024;
const USER_AGENT = 'TuXWetterGnome (https://github.com/19nkn80/Tux-Wetter-Gnome)';

function requestHeaders(message) {
    message.request_headers.append('User-Agent', USER_AGENT);
}

export function updateAsset(data, currentVersion) {
    const release = newerRelease(data, currentVersion);
    if (!release)
        return null;

    const asset = Array.isArray(data.assets)
        ? data.assets.find(item => item.name === ASSET_NAME && item.state === 'uploaded')
        : null;
    const prefix = `https://github.com/19nkn80/Tux-Wetter-Gnome/releases/download/${data.tag_name}/`;
    if (!asset || ![prefix + ASSET_NAME, prefix + encodeURIComponent(ASSET_NAME)]
        .includes(asset.browser_download_url))
        throw new Error('Das installierbare ZIP fehlt im GitHub-Release.');
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_SIZE)
        throw new Error('Das Update-ZIP hat eine ungültige Dateigröße.');
    if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest))
        throw new Error('Für das Update-ZIP fehlt eine gültige SHA-256-Prüfsumme.');
    return {...release, downloadUrl: asset.browser_download_url, size: asset.size,
        checksum: asset.digest.slice(7).toLowerCase()};
}

export async function checkForUpdate(session, version, cancellable) {
    const message = Soup.Message.new('GET', RELEASE_API_URL);
    requestHeaders(message);
    message.request_headers.append('Accept', 'application/vnd.github+json');
    message.request_headers.append('X-GitHub-Api-Version', '2022-11-28');
    const bytes = await new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (http, result) => {
            try {
                resolve(http.send_and_read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
    if (message.get_status() !== Soup.Status.OK)
        throw new Error(`GitHub-Updateprüfung fehlgeschlagen: HTTP ${message.get_status()}.`);
    let data;
    try {
        data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    } catch (error) {
        console.error(`TuX-Wetter: Ungültige GitHub-Antwort: ${error.message}`);
        throw new Error('Die GitHub-Antwort konnte nicht gelesen werden.');
    }
    return updateAsset(data, version);
}

function send(session, message, cancellable) {
    return new Promise((resolve, reject) => {
        session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (http, result) => {
            try {
                resolve(http.send_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function readChunk(stream, cancellable) {
    return new Promise((resolve, reject) => {
        stream.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, cancellable, (input, result) => {
            try {
                resolve(input.read_bytes_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function installPackage(path) {
    const process = Gio.Subprocess.new(
        ['gnome-extensions', 'install', '--force', path],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    return new Promise((resolve, reject) => {
        process.communicate_utf8_async(null, null, (subprocess, result) => {
            try {
                const [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                if (!subprocess.get_successful())
                    throw new Error(`Installation fehlgeschlagen: ${(stderr || stdout || '').trim()}`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

export function validateInstalledMetadata(metadata, version) {
    if (metadata?.uuid !== 'tuxwetter@tuxwetter.ch' ||
        typeof metadata['version-name'] !== 'string' ||
        compareVersions(metadata['version-name'], version) !== 0)
        throw new Error('Die installierte Erweiterung oder Version stimmt nicht überein.');
}

function verifyInstalledVersion(version) {
    const path = GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'extensions',
        'tuxwetter@tuxwetter.ch', 'metadata.json',
    ]);
    try {
        const [success, bytes] = GLib.file_get_contents(path);
        if (!success)
            throw new Error('Metadaten konnten nicht gelesen werden.');
        const metadata = JSON.parse(new TextDecoder().decode(bytes));
        validateInstalledMetadata(metadata, version);
    } catch (error) {
        console.error(`TuX-Wetter: Installationsprüfung fehlgeschlagen: ${error.message}`);
        throw new Error('Die Installation konnte nicht anhand der installierten Version bestätigt werden.');
    }
}

export function requestLogout() {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            'org.gnome.SessionManager',
            '/org/gnome/SessionManager',
            'org.gnome.SessionManager',
            'Logout',
            new GLib.Variant('(u)', [0]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export async function installUpdate(session, release, cancellable) {
    const message = Soup.Message.new('GET', release.downloadUrl);
    requestHeaders(message);
    const input = await send(session, message, cancellable);
    let file = null;
    let output = null;
    try {
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`Download fehlgeschlagen: HTTP ${message.get_status()}.`);
        [file, output] = Gio.File.new_tmp('tuxwetter-update-XXXXXX.zip');
        const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
        let size = 0;
        while (true) {
            const bytes = await readChunk(input, cancellable);
            const chunk = bytes.get_data();
            if (!chunk?.length)
                break;
            size += chunk.length;
            if (size > release.size || size > MAX_ASSET_SIZE)
                throw new Error('Das heruntergeladene Update-ZIP ist zu groß.');
            checksum.update(chunk);
            output.get_output_stream().write_all(chunk, cancellable);
        }
        output.close(null);
        output = null;
        if (size !== release.size || checksum.get_string() !== release.checksum)
            throw new Error('Die Prüfsumme oder Dateigröße des Update-ZIPs stimmt nicht.');
        if (cancellable.is_cancelled())
            throw new Error('Der Update-Download wurde abgebrochen.');
        await installPackage(file.get_path());
        verifyInstalledVersion(release.version);
    } finally {
        input.close(null);
        output?.close(null);
        if (file)
            file.delete(null);
    }
}

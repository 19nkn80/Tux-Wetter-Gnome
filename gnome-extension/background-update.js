// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {checkForUpdate, installUpdate} from './update-service.js';

export class BackgroundUpdates {
    constructor(version) {
        this._version = version;
        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._stopped = false;
        this._busy = false;
        this._dialog = null;
        this._retryTimeout = 0;
        this._initialTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._initialTimeout = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
        this._periodicTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 24 * 60 * 60, () => {
            this._check();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        this._stopped = true;
        if (this._initialTimeout)
            GLib.source_remove(this._initialTimeout);
        if (this._periodicTimeout)
            GLib.source_remove(this._periodicTimeout);
        if (this._retryTimeout)
            GLib.source_remove(this._retryTimeout);
        this._dialog?.close();
        this._cancellable.cancel();
        this._session.abort();
    }

    async _check() {
        if (this._busy || this._dialog || this._stopped)
            return;
        this._busy = true;
        try {
            const release = await checkForUpdate(this._session, this._version, this._cancellable);
            if (!this._stopped && release) {
                if (Main.sessionMode.isLocked) {
                    if (!this._retryTimeout) {
                        this._retryTimeout = GLib.timeout_add_seconds(
                            GLib.PRIORITY_DEFAULT, 60, () => {
                                this._retryTimeout = 0;
                                this._check();
                                return GLib.SOURCE_REMOVE;
                            });
                    }
                } else {
                    this._showDialog(release);
                }
            }
        } catch (error) {
            if (!this._stopped)
                console.error(`TuX-Wetter: Updateprüfung fehlgeschlagen: ${error.message}`);
        } finally {
            this._busy = false;
        }
    }

    _showDialog(release) {
        const dialog = new ModalDialog.ModalDialog();
        this._dialog = dialog;
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: `TuX-Wetter ${release.version} ist verfügbar`,
            description: 'Das Update von GitHub herunterladen und installieren? '
                + 'Deine Einstellungen bleiben erhalten. Anschließend bitte ab- und wieder anmelden.',
        }));
        dialog.setButtons([
            {
                label: 'Abbrechen',
                key: Clutter.KEY_Escape,
                default: true,
                action: () => dialog.close(),
            },
            {
                label: 'Update',
                action: () => {
                    dialog.close();
                    this._install(release);
                },
            },
        ]);
        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        if (!dialog.open()) {
            this._dialog = null;
            dialog.destroy();
            Main.notify('TuX-Wetter', 'Der Update-Dialog konnte nicht geöffnet werden.');
        }
    }

    async _install(release) {
        this._busy = true;
        Main.notify('TuX-Wetter', `Update auf Version ${release.version} wird heruntergeladen …`);
        try {
            await installUpdate(this._session, release, this._cancellable);
            if (!this._stopped)
                Main.notify('TuX-Wetter', 'Update installiert. Bitte ab- und wieder anmelden.');
        } catch (error) {
            if (!this._stopped) {
                console.error(`TuX-Wetter: Update fehlgeschlagen: ${error.message}`);
                Main.notify('TuX-Wetter', 'Update fehlgeschlagen. Einzelheiten stehen im Systemprotokoll.');
            }
        } finally {
            this._busy = false;
        }
    }
}

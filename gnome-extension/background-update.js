// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {checkForUpdate, installUpdate, requestLogout} from './update-service.js';

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
        this._showMessage(
            `TuX-Wetter ${release.version} ist verfügbar`,
            'Das Update von GitHub herunterladen und installieren? '
                + 'Deine Einstellungen bleiben erhalten. Anschließend bitte ab- und wieder anmelden.',
            [
                {label: 'Abbrechen', key: Clutter.KEY_Escape, default: true},
                {label: 'Update', action: () => this._install(release)},
            ]);
    }

    _showMessage(title, description, buttons) {
        const dialog = new ModalDialog.ModalDialog();
        this._dialog = dialog;
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title,
            description,
        }));
        dialog.setButtons(buttons.map(button => ({
            ...button,
            action: () => {
                dialog.close();
                if (button.action)
                    button.action();
            },
        })));
        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        if (!dialog.open()) {
            this._dialog = null;
            dialog.destroy();
            Main.notify('TuX-Wetter', `${title}. ${description}`);
        }
    }

    async _install(release) {
        this._busy = true;
        Main.notify('TuX-Wetter', `Update auf Version ${release.version} wird heruntergeladen …`);
        try {
            await installUpdate(this._session, release, this._cancellable);
            if (!this._stopped) {
                this._showMessage(
                    'Update erfolgreich',
                    `TuX-Wetter ${release.version} wurde installiert. `
                        + 'Bitte abmelden und wieder anmelden, um die neue Version zu laden.',
                    [
                        {label: 'Jetzt nicht abmelden', key: Clutter.KEY_Escape, default: true},
                        {label: 'Abmelden', action: () => this._logout()},
                    ]);
            }
        } catch (error) {
            if (!this._stopped) {
                console.error(`TuX-Wetter: Update fehlgeschlagen: ${error.message}`);
                this._showMessage(
                    'Update fehlgeschlagen',
                    'Das Update konnte nicht bestätigt werden. Einzelheiten stehen im Systemprotokoll.',
                    [{label: 'Schließen', key: Clutter.KEY_Escape, default: true}]);
            }
        } finally {
            this._busy = false;
        }
    }

    async _logout() {
        try {
            await requestLogout();
        } catch (error) {
            console.error(`TuX-Wetter: Abmelden fehlgeschlagen: ${error.message}`);
            if (!this._stopped)
                Main.notify('TuX-Wetter', 'Abmelden fehlgeschlagen. Bitte melde dich über das Systemmenü ab.');
        }
    }
}

// SPDX-FileCopyrightText: 2026 R.Bruns
// SPDX-License-Identifier: GPL-3.0-or-later

export function displayError(error) {
    if (error?.constructor === Error && typeof error.message === 'string')
        return error.message;
    return 'Technischer Fehler. Einzelheiten stehen im Systemprotokoll.';
}

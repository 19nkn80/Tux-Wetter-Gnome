#!/usr/bin/env bash
set -euo pipefail

settings_path='/org/gnome/shell/extensions/tuxwetter/'

usage() {
    printf 'Aufruf: %s export|import SICHERUNGSDATEI\n' "$0" >&2
    exit 2
}

[[ $# -eq 2 ]] || usage

action=$1
backup_file=$2

case "$action" in
    export)
        backup_dir=$(dirname -- "$backup_file")
        mkdir -p -- "$backup_dir"
        temporary_file=$(mktemp "${backup_file}.XXXXXX")
        trap 'rm -f -- "$temporary_file"' EXIT
        dconf dump "$settings_path" > "$temporary_file"
        chmod 600 "$temporary_file"
        mv -f -- "$temporary_file" "$backup_file"
        trap - EXIT
        ;;
    import)
        [[ -f "$backup_file" ]] || {
            printf 'Sicherungsdatei existiert nicht: %s\n' "$backup_file" >&2
            exit 1
        }
        dconf load "$settings_path" < "$backup_file"
        ;;
    *)
        usage
        ;;
esac

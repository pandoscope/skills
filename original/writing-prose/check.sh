#!/usr/bin/env bash
# writing-prose check. F rules fail the run; H rules print candidates
# for the agent to confirm or dismiss. The rules themselves live in
# check.awk beside this script; this file parses arguments.
# Usage: check.sh <surface> <file|-> [--before <file>] [--style]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
surfaces="chat ticket tracker markdown skill primed comment commit"

usage() {
    echo "usage: check.sh <surface> <file|-> [--before <file>] [--style]" >&2
    echo "surface is one of: $surfaces" >&2
    exit 2
}

[ $# -ge 2 ] || usage
surface=$1 file=$2
shift 2
case " $surfaces " in *" $surface "*) ;; *) usage ;; esac

before="" style=0
while [ $# -gt 0 ]; do
    case $1 in
        --before) before=${2:?--before needs a file}; shift 2 ;;
        --style) style=1; shift ;;
        *) usage ;;
    esac
done

name=$file
if [ "$file" = - ]; then
    file=$(mktemp)
    trap 'rm -f "$file"' EXIT
    cat > "$file"
    name=stdin
fi
[ -f "$file" ] || { echo "check.sh: no such file: $file" >&2; exit 2; }

awk -v surface="$surface" -v name="$name" -v style="$style" \
    -v has_before="${before:+1}" -f "$here/check.awk" ${before:+"$before"} "$file"

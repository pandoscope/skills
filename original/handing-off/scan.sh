#!/usr/bin/env bash
# The outgoing scan (skills#267): do files about to leave the session
# hold a blocked term?
#
# Usage: scan.sh <file>...
# Exits 0 when no file holds a term, 1 on a hit, 2 on a usage error
# (no file named, or a named file missing).
#
# The terms are the values of the store URL variables and the terms in
# PUSH_BLOCKLIST. A hit is named
# by the variable it came from, never by its value: printing the value
# would put it in the channel this scan guards.
set -euo pipefail
if [ $# -eq 0 ]; then
    echo "usage: scan.sh <file>..." >&2
    exit 2
fi
for file in "$@"; do
    if [ ! -f "$file" ]; then
        echo "scan.sh: no file at $file" >&2
        exit 2
    fi
done

labels=()
values=()
for name in SESSION_MEMORY_URL DECISION_MEMORY_URL EVIDENCE_MEMORY_URL; do
    if [ -n "${!name:-}" ]; then
        labels+=("the value of $name")
        values+=("${!name}")
    fi
done
# PUSH_BLOCKLIST is |-separated: newlines get cut by some layers, so a
# literal | in a term cannot be expressed. Empty terms are skipped but
# keep their position, so "term N" names the Nth field.
position=0
IFS='|' read -r -a terms <<< "${PUSH_BLOCKLIST:-}"
for term in "${terms[@]+"${terms[@]}"}"; do
    position=$((position + 1))
    if [ -n "$term" ]; then
        labels+=("PUSH_BLOCKLIST term $position")
        values+=("$term")
    fi
done

hits=0
for i in "${!values[@]}"; do
    for file in "$@"; do
        if grep -q -F -- "${values[$i]}" "$file"; then
            echo "scan.sh: $file holds ${labels[$i]}"
            hits=$((hits + 1))
        fi
    done
done
[ "$hits" -eq 0 ] || exit 1

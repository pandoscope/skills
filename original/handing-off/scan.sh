#!/usr/bin/env bash
# The outgoing scan (skills#267): do files about to leave the session
# hold a blocked term?
#
# Usage: scan.sh <file>...
# Exits 0 when no file holds a term, 1 on a hit, 2 on a usage error
# (no file named, or a named file missing).
#
# The terms are the values of the store URL variables. A hit is named
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

hits=0
for name in SESSION_MEMORY_URL DECISION_MEMORY_URL EVIDENCE_MEMORY_URL; do
    value=${!name:-}
    [ -n "$value" ] || continue
    for file in "$@"; do
        if grep -q -F -- "$value" "$file"; then
            echo "scan.sh: $file holds the value of $name"
            hits=$((hits + 1))
        fi
    done
done
[ "$hits" -eq 0 ] || exit 1

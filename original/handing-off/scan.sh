#!/usr/bin/env bash
# The outgoing scan (skills#267): do files about to leave the session
# hold a blocked term?
#
# Usage: scan.sh <file>...
# Exits 0 when no file holds a term, 1 on a hit, 2 on a usage error
# (no file named, or a named file missing).
#
# The terms are the values of the store URL variables and the terms in
# PUSH_BLOCKLIST, the terms the thread ledger's outgoing scan uses. A
# hit is named by its source, the variable or the term's position in
# PUSH_BLOCKLIST, never by its value: printing the value would put it
# in the channel this scan guards. The scan finds listed terms only; a
# secret nobody listed passes.
#
# Mirrored pair: blocklistTerms in the thread-ledger skill's scan.mjs
# is the authoritative term list. This copy exists so that handing-off
# works without the ledger; a change to the terms changes both.
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
# keep their position, so "term N" names the Nth field. A field holding
# a newline matches on any of its lines.
position=0
rest=${PUSH_BLOCKLIST:-}
while :; do
    field=${rest%%|*}
    position=$((position + 1))
    if [ -n "$field" ]; then
        labels+=("PUSH_BLOCKLIST term $position")
        values+=("$field")
    fi
    [ "$rest" != "$field" ] || break
    rest=${rest#*|}
done

hits=0
for i in "${!values[@]}"; do
    for file in "$@"; do
        # A JSON file holds a quote or a backslash escaped.
        escaped=$(printf '%s' "${values[$i]}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
        if grep -q -F -- "${values[$i]}" "$file" \
            || grep -q -F -- "$escaped" "$file"; then
            echo "scan.sh: $file holds ${labels[$i]}"
            hits=$((hits + 1))
        fi
    done
done
[ "$hits" -eq 0 ] || exit 1
if [ "${#values[@]}" -eq 0 ]; then
    echo "scan.sh: scanned for nothing: no store URL variable and no" \
         "PUSH_BLOCKLIST term is set"
else
    echo "scan.sh: no hit for ${#values[@]} terms in $# files"
fi

#!/usr/bin/env bash
# The list check (skills#267): is the finish-first list in a handoff
# draft settled?
#
# Usage: list.sh <draft>
# Exits 0 when the draft has a "Finish first" heading and every item
# under it is settled; 1 otherwise, naming each unsettled item; 2 on a
# usage error.
#
# The list is the checkbox list between the "Finish first" heading and
# the next heading. An item is a line "- [ ] ..." or "- [x] ...".
set -euo pipefail
draft=${1:?usage: list.sh <draft>}
if [ ! -f "$draft" ]; then
    echo "list.sh: no draft at $draft" >&2
    exit 2
fi
awk '
    /^#+[[:space:]]/ { in_list = ($0 ~ /^#+[[:space:]]+Finish first[[:space:]]*$/); next }
    in_list && /^[[:space:]]*[-*][[:space:]]+\[[ xX]\][[:space:]]/ { items++ }
    END { printf "finish-first list settled: %d items\n", items }
' "$draft"

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
# An item is settled when it is ticked, names its owner first, and, when
# postponed, names the trigger that brings it back:
#   - [x] model: run the probes (postponed until: the probe ticket closes)
# DECISION:SCOPE — The owners are "model" and "principal", the two roles
# the flow knows; any other word before the colon counts as no owner.
# The principal ruled so when skills#267 was implemented: a colon in
# free text cannot then pass for an owner.
set -euo pipefail
draft=${1:?usage: list.sh <draft>}
if [ ! -f "$draft" ]; then
    echo "list.sh: no draft at $draft" >&2
    exit 2
fi
awk '
    /^#+[[:space:]]/ { in_list = ($0 ~ /^#+[[:space:]]+Finish first[[:space:]]*$/); next }
    in_list && /^[[:space:]]*[-*][[:space:]]+\[[ xX]\][[:space:]]/ {
        items++
        ticked = ($0 ~ /^[[:space:]]*[-*][[:space:]]+\[[xX]\]/)
        text = $0
        sub(/^[[:space:]]*[-*][[:space:]]+\[[ xX]\][[:space:]]+/, "", text)
        if (!ticked) { print "unticked: " text; open++ }
        else if (text !~ /^(model|principal):[[:space:]]/) { print "no owner: " text; open++ }
        else if (text ~ /\([[:space:]]*postponed/ \
                 && text !~ /\([[:space:]]*postponed until:[[:space:]]*[^)[:space:]][^)]*\)/) {
            print "postponed without trigger: " text; open++
        }
    }
    END {
        if (open) { printf "finish-first list not settled: %d of %d items open\n", open, items; exit 1 }
        printf "finish-first list settled: %d items\n", items
    }
' "$draft"

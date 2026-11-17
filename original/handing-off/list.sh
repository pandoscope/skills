#!/usr/bin/env bash
# The list check (skills#267): is the finish-first list in a handoff
# draft settled?
#
# Usage: list.sh <draft>
# Exits 0 when the draft has a "Finish first" heading and every item
# under it is settled (an empty list is settled); 1 when the heading is
# missing or an item is not settled, naming each such item; 2 when the
# draft does not exist.
#
# The list is the checkbox list between the "Finish first" heading and
# the next heading of the same or a higher level; fenced blocks are
# skipped. An item is a line "- [ ] ..." or "- [x] ...", with "-", "*"
# or "+", at any indent. Any other non-blank line in the list fails.
# An item is settled when it is ticked, names its owner first, and, when
# postponed, names the trigger that brings it back:
#   - [x] model: run the probes (postponed until: the probe ticket closes)
# DECISION:SCOPE — The owners are "model" and "principal", the two roles
# the flow knows. Another word before the colon fails with a message of
# its own that names the word, "unknown owner: <word>"; an item with no
# owner word fails as "no owner". The principal decided so on the
# review of the pull request, as skills#267 asks.
set -euo pipefail
draft=${1:?usage: list.sh <draft>}
if [ ! -f "$draft" ]; then
    echo "list.sh: no draft at $draft" >&2
    exit 2
fi
awk '
    { sub(/\r$/, "") }
    # A fenced block is example text: it neither opens nor ends the
    # list, and its lines are no items.
    /^[[:space:]]*(```|~~~)/ { fenced = !fenced; next }
    fenced { next }
    /^#+[[:space:]]/ {
        level = index($0, " ") - 1
        if ($0 ~ /^#+[[:space:]]+Finish first[[:space:]]*$/) { in_list = 1; list_level = level; found++; next }
        # Only a heading of the same or a higher level ends the list.
        if (in_list && level <= list_level) in_list = 0
        next
    }
    !in_list { next }
    /^[[:space:]]*[-*+][[:space:]]+\[[ xX]\][[:space:]]/ {
        items++
        ticked = ($0 ~ /^[[:space:]]*[-*+][[:space:]]+\[[xX]\]/)
        text = $0
        sub(/^[[:space:]]*[-*+][[:space:]]+\[[ xX]\][[:space:]]+/, "", text)
        if (!ticked) { print "unticked: " text; open++ }
        else if (text ~ /^(model|principal):[[:space:]]/) {
            if (text ~ /\([[:space:]]*postponed/ \
                && text !~ /\([[:space:]]*postponed until:[[:space:]]*[^)[:space:]][^)]*\)/) {
                print "postponed without trigger: " text; open++
            }
        }
        else if (match(text, /^[A-Za-z][A-Za-z0-9_-]*:[[:space:]]/)) {
            print "unknown owner: " substr(text, 1, RLENGTH - 2) " (in \"" text "\")"; open++
        }
        else { print "no owner: " text; open++ }
        next
    }
    # Any other non-blank line inside the list, a table, a quote or
    # prose, is something the check cannot read; it fails rather than
    # pass unread (review of #274, item 4).
    /[^[:space:]]/ {
        line = $0
        sub(/^[[:space:]]+/, "", line)
        print "not a checkbox item: " line; open++
    }
    END {
        if (!found) { print "no \"Finish first\" heading in " FILENAME; exit 1 }
        if (open) { printf "finish-first list not settled: %d of %d items open\n", open, items; exit 1 }
        printf "finish-first list settled: %d items\n", items
    }
' "$draft"

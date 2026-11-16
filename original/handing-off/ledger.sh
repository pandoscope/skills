#!/usr/bin/env bash
# The ledger steps of handing-off (skills#267), for a session that keeps
# a thread ledger (the thread-ledger skill). The ledger is optional: it
# counts as available when a read of its view succeeds. A set store
# variable proves nothing, since a session can lack a clone of the
# store.
#
# Usage: ledger.sh view
#          Run 1: prints the ledger's view, whose open threads join the
#          candidates for the finish-first list.
#        ledger.sh events <draft>
#          Run 2: writes one ledger event per ticked finish-first item
#          that carries a thread slug, "(thread: <slug>)": dropped with
#          the reason for a dropped item, parked with the trigger for a
#          postponed one, completed for any other.
# Env:   HANDOFF_LEDGER  the ledger's entry point (default: ledger.mjs
#                        of a thread-ledger skill beside this one)
#
# Without a ledger, either command prints one line saying the run skips
# its ledger step, and exits 0. Exits 1 when an event the ledger refused
# leaves the step half done, with the ledger's error; 2 on a usage
# error.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ledger=${HANDOFF_LEDGER:-$here/../thread-ledger/ledger.mjs}

usage() {
    echo "usage: ledger.sh view | ledger.sh events <draft>" >&2
    exit 2
}

# Print the ledger's view into $1; on failure print the reason, one line.
read_view() {
    local out
    if [ ! -f "$ledger" ]; then
        echo "no ledger at $ledger"
        return 1
    fi
    if ! out=$(node "$ledger" render --format md --out "$1" 2>&1); then
        printf '%s\n' "$out" | head -n 1
        return 1
    fi
}

command=${1:-}
case "$command" in
    view) [ $# -eq 1 ] || usage ;;
    events) [ $# -eq 2 ] || usage ;;
    *) usage ;;
esac

view=$(mktemp)
trap 'rm -f "$view"' EXIT
if ! reason=$(read_view "$view"); then
    echo "handing-off: no thread ledger available ($reason); this run" \
         "skips its ledger step"
    exit 0
fi

if [ "$command" = view ]; then
    cat "$view"
    exit 0
fi

draft=$2
if [ ! -f "$draft" ]; then
    echo "ledger.sh: no draft at $draft" >&2
    exit 2
fi
# DECISION:SCOPE — An item names its thread as "(thread: <slug>)", in
# the notation of "(dropped: ...)" and "(postponed until: ...)";
# skills#267 left the notation open.
# One tab-separated line per ticked item with a thread slug:
# <event> <slug> [<reason or trigger>]. The item notation is list.sh's.
events=$(awk '
    function inside(text, key,    start) {
        if (!match(text, "\\(" key ":[[:space:]]*[^)]*\\)")) return ""
        start = index(substr(text, RSTART), ":") + 1
        text = substr(text, RSTART + start - 1, RLENGTH - start)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", text)
        return text
    }
    /^#+[[:space:]]/ { in_list = ($0 ~ /^#+[[:space:]]+Finish first[[:space:]]*$/); next }
    in_list && /^[[:space:]]*[-*][[:space:]]+\[[xX]\][[:space:]]/ {
        slug = inside($0, "thread")
        if (slug == "") next
        if ((why = inside($0, "dropped")) != "") print "dropped\t" slug "\t" why
        else if ((when = inside($0, "postponed until")) != "") print "parked\t" slug "\t" when
        else print "completed\t" slug
    }
' "$draft")

count=0
while IFS=$'\t' read -r event slug detail; do
    [ -n "$event" ] || continue
    case "$event" in
        dropped) set -- --note "$detail" ;;
        parked) set -- --trigger "$detail" ;;
        *) set -- ;;
    esac
    if ! out=$(node "$ledger" append --ev "$event" --thread "$slug" "$@" 2>&1); then
        echo "ledger.sh: the ledger refused $event for thread $slug after" \
             "$count events: $out" >&2
        exit 1
    fi
    count=$((count + 1))
    echo "ledger: $event $slug"
done <<< "$events"
echo "ledger: $count events written"

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

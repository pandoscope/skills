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
# Without a ledger, or for events without a session identity
# (LEDGER_SESSION_URL), either command prints one line saying the run
# skips its ledger step, and exits 0. An event the ledger already holds
# is not written again. A dropped item without a reason fails the step
# before any event is written. Exits 1 when an event the ledger refused
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

# An append needs the conversation's identity; the ledger refuses to
# guess it.
if [ -z "${LEDGER_SESSION_URL:-}" ]; then
    echo "handing-off: the thread ledger needs this session's identity" \
         "(LEDGER_SESSION_URL is unset); this run skips its ledger step"
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
    function item(line) {
        sub(/^[[:space:]]*[-*+][[:space:]]+\[[xX]\][[:space:]]+/, "", line)
        return line
    }
    /^#+[[:space:]]/ { in_list = ($0 ~ /^#+[[:space:]]+Finish first[[:space:]]*$/); next }
    in_list && /^[[:space:]]*[-*+][[:space:]]+\[[xX]\][[:space:]]/ {
        slug = inside($0, "thread")
        if (slug == "") next
        if ($0 ~ /\([[:space:]]*dropped[[:space:]]*(:[[:space:]]*)?\)/) print "unexplained\t" slug "\t" item($0)
        else if ((why = inside($0, "dropped")) != "") print "dropped\t" slug "\t" why
        else if ((when = inside($0, "postponed until")) != "") print "parked\t" slug "\t" when
        else print "completed\t" slug
    }
' "$draft")

unexplained=$(printf '%s\n' "$events" | awk -F'\t' '$1 == "unexplained" { print "dropped without a reason: " $3 }')
if [ -n "$unexplained" ]; then
    printf '%s\n' "$unexplained" >&2
    echo "ledger.sh: say why each dropped item was dropped, then rerun; no event was written" >&2
    exit 1
fi

# The state each thread is in now. A second pass of run 2 writes no
# event the ledger already holds: completed -> completed is illegal.
# shellcheck disable=SC2016 # the script is JavaScript, not shell
states=$(node "$ledger" state 2>/dev/null | node -e '
    let text = "";
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => {
        let threads = [];
        try { threads = JSON.parse(text); } catch { return; }
        if (!Array.isArray(threads)) return;
        for (const t of threads) if (t && t.thread) console.log(`${t.thread}\t${t.state}`);
    });' || true)

count=0
while IFS=$'\t' read -r event slug detail; do
    [ -n "$event" ] || continue
    if printf '%s\n' "$states" | grep -qxF "$slug	$event"; then
        continue
    fi
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

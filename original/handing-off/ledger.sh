#!/usr/bin/env bash
# The ledger steps of handing-off (skills#267), for a session that keeps
# a thread ledger (the thread-ledger skill). The ledger is optional: it
# counts as available when a read of its state succeeds. A set store
# variable proves nothing, since a session can lack a clone of the
# store.
#
# Usage: ledger.sh view [--session-url <url>]
#          Run 1: prints this session's open threads, one line each,
#          "- <slug>: <state> — <title> (<ticket>)"; they join the
#          candidates for the finish-first list. A thread is the
#          session's when one of its events is anchored in it, and open
#          unless completed or dropped.
#        ledger.sh events [--session-url <url>] <draft>
#          Run 2: writes one ledger event per ticked finish-first item
#          that carries a thread slug, "(thread: <slug>)": dropped with
#          the reason for a dropped item, parked with the trigger for a
#          postponed one. A done item writes no event: a handoff does
#          not end a thread, so its thread stays open. Every append
#          passes the session's identity.
# The session's identity is --session-url, or else LEDGER_SESSION_URL.
# Env:   HANDOFF_LEDGER  the ledger's entry point (default: ledger.mjs
#                        of a thread-ledger skill beside this one)
#
# Without a ledger, or without a session identity, either command
# prints one line saying the run skips its ledger step, and exits 0. An
# event the ledger already holds is not written again. A dropped item
# without a reason fails the step before any event is written. Exits 1
# when an event the ledger refused leaves the step half done, with the
# ledger's error; 2 on a usage error.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ledger=${HANDOFF_LEDGER:-$here/../thread-ledger/ledger.mjs}

usage() {
    echo "usage: ledger.sh view [--session-url <url>] | ledger.sh events [--session-url <url>] <draft>" >&2
    exit 2
}

# Print the ledger's thread states, as JSON, into $1; on failure print
# the reason, one line.
read_state() {
    local out
    if [ ! -f "$ledger" ]; then
        echo "no ledger at $ledger"
        return 1
    fi
    if ! out=$(node "$ledger" state 2>&1 > "$1"); then
        printf '%s\n' "$out" | head -n 1
        return 1
    fi
}

command=${1:-}
identity=${LEDGER_SESSION_URL:-}
case "$command" in
    view|events) shift ;;
    *) usage ;;
esac
if [ "${1:-}" = --session-url ]; then
    [ $# -ge 2 ] || usage
    identity=$2
    shift 2
fi
case "$command" in
    view) [ $# -eq 0 ] || usage ;;
    events) [ $# -eq 1 ] || usage; draft=$1 ;;
esac

state_file=$(mktemp)
trap 'rm -f "$state_file"' EXIT
if ! reason=$(read_state "$state_file"); then
    # One fixed line for the run to relay; the ledger's own reason goes
    # to stderr.
    echo "handing-off: no thread ledger available; this run skips its ledger step"
    echo "ledger.sh: $reason" >&2
    exit 0
fi

# The ledger refuses to guess the conversation, and the view has no
# other way to tell this session's threads from the rest of the store.
if [ -z "$identity" ]; then
    echo "handing-off: the thread ledger needs this session's identity" \
         "(no --session-url, LEDGER_SESSION_URL unset); this run skips its ledger step"
    exit 0
fi

if [ "$command" = view ]; then
    # The session id of a URL as the ledger derives it: sessionFromUrl
    # in thread-ledger/core/schema.mjs, mirrored here.
    # shellcheck disable=SC2016 # the script is JavaScript, not shell
    node -e '
        const fs = require("node:fs");
        const url = process.argv[2];
        const segments = url.replace(/^[a-zA-Z][\w+.-]*:\/\//, "").split(/[?#]/)[0]
            .split("/").slice(1).filter(Boolean);
        const session = (segments[segments.length - 1] || "").replace(/[^A-Za-z0-9._-]/g, "-");
        let threads = [];
        try { threads = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
        if (!Array.isArray(threads)) threads = [];
        for (const t of threads) {
            const events = Array.isArray(t.events) ? t.events : [];
            if (["completed", "dropped"].includes(t.state)) continue;
            if (!events.some((e) => e && e.anchor && e.anchor.session === session)) continue;
            const opened = events.find((e) => e && e.title) || {};
            const ticket = opened.ticket ? ` (${opened.ticket})` : "";
            console.log(`- ${t.thread}: ${t.state}${opened.title ? ` — ${opened.title}` : ""}${ticket}`);
        }' "$state_file" "$identity"
    exit 0
fi

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
    # A note reads in any letter case (review of #274, item 5); the
    # match runs on a lower-case copy, whose positions are the same.
    function inside(text, key,    start) {
        if (!match(tolower(text), "\\(" key ":[[:space:]]*[^)]*\\)")) return ""
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
        if (tolower($0) ~ /\([[:space:]]*dropped[[:space:]]*(:[[:space:]]*)?\)/) print "unexplained\t" slug "\t" item($0)
        else if ((why = inside($0, "dropped")) != "") print "dropped\t" slug "\t" why
        else if ((when = inside($0, "postponed until")) != "") print "parked\t" slug "\t" when
        # DECISION:SCOPE — A done item leaves its thread open: the
        # work of the thread appends completed when it ends (principal,
        # 2026-11-17). Dropped and postponed items still write events.
        else print "open\t" slug
    }
' "$draft")

unexplained=$(printf '%s\n' "$events" | awk -F'\t' '$1 == "unexplained" { print "dropped without a reason: " $3 }')
if [ -n "$unexplained" ]; then
    printf '%s\n' "$unexplained" >&2
    echo "ledger.sh: say why each dropped item was dropped, then rerun; no event was written" >&2
    exit 1
fi

# The state each thread is in now. A second pass of run 2 writes no
# event the ledger already holds: dropped -> dropped is illegal.
# shellcheck disable=SC2016 # the script is JavaScript, not shell
states=$(node -e '
    let text = "";
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => {
        let threads = [];
        try { threads = JSON.parse(text); } catch { return; }
        if (!Array.isArray(threads)) return;
        for (const t of threads) if (t && t.thread) console.log(`${t.thread}\t${t.state}`);
    });' < "$state_file" || true)

count=0
while IFS=$'\t' read -r event slug detail; do
    [ -n "$event" ] || continue
    if [ "$event" = open ]; then
        echo "ledger: $slug stays open; a handoff completes no thread"
        continue
    fi
    if printf '%s\n' "$states" | grep -qxF "$slug	$event"; then
        continue
    fi
    # The ledger lets a parked or blocked thread go on only through
    # unblocked (TRANSITIONS in thread-ledger/core/schema.mjs): a thread
    # parked in an earlier cycle needs it before it is dropped or parked
    # again (review of skills#274, round two, D8).
    if printf '%s\n' "$states" | awk -F'\t' -v slug="$slug" \
           '$1 == slug && ($2 == "parked" || $2 == "blocked") { found = 1 } END { exit !found }'; then
        if ! out=$(node "$ledger" append --ev unblocked --thread "$slug" \
                   --session-url "$identity" 2>&1); then
            echo "ledger.sh: the ledger refused unblocked for thread $slug after" \
                 "$count events: $out" >&2
            exit 1
        fi
        count=$((count + 1))
        echo "ledger: unblocked $slug"
    fi
    case "$event" in
        dropped) set -- --note "$detail" ;;
        parked) set -- --trigger "$detail" ;;
        *) set -- ;;
    esac
    if ! out=$(node "$ledger" append --ev "$event" --thread "$slug" "$@" \
               --session-url "$identity" 2>&1); then
        echo "ledger.sh: the ledger refused $event for thread $slug after" \
             "$count events: $out" >&2
        exit 1
    fi
    count=$((count + 1))
    echo "ledger: $event $slug"
done <<< "$events"
echo "ledger: $count events written"

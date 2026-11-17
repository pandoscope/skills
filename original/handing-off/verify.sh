#!/bin/bash
# The post-compaction verification (skills#170; channel map in
# guard.sh). stdout on SessionStart(source=compact) lands in the fresh
# context — the one channel that reaches the model after compaction —
# so this is where the handoff gets its pointer and its priorities
# re-stated, and where the phase of the handing-off runs is cleared.
# Moved here from the installing project's hooks: this file
# reads what mark.sh writes and parses the open-state table SKILL.md
# defines, so every party to the contract ships and versions together.
#
# The open-state rows are lifted VERBATIM, in table order — notation,
# not paraphrase — so this output cannot drift from the handoff. The
# ordering is the skill's responsibility; extraction stays dumb
# on purpose.
set -u
# A hook always gets its input on stdin; a person running this by hand
# in a terminal types none.
input=""
[ -t 0 ] || input=$(cat)
# shellcheck source=original/handing-off/state.sh
. "$(dirname "${BASH_SOURCE[0]}")/state.sh"
# shellcheck source=original/handing-off/store.sh
. "$(dirname "${BASH_SOURCE[0]}")/store.sh"
session=$(handoff_session_of_hook_input "$input")
state=$(handoff_marker_to_read "$session")

# The run records its store in the state (store.sh); a hook does not
# see a HANDOFF_STORE set only in the run's shell.
if [ -z "${HANDOFF_STORE:-}" ] && [ -n "$state" ] && [ -f "$state" ]; then
    recorded=$(handoff_json_field store_root "$(cat "$state")")
    if [ -n "$recorded" ] && [ -d "$recorded/.git" ]; then
        export HANDOFF_STORE="$recorded"
    fi
fi

# bounded <seconds> <log> <command...>: runs the command in the
# background and waits at most that long. Returns its status; 124 when
# it is still running, and then it goes on in the background.
bounded() {
    local limit=$1 log=$2 pid ticks=0
    shift 2
    "$@" > "$log" 2>&1 &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        [ "$ticks" -lt $((limit * 5)) ] || return 124
        sleep 0.2
        ticks=$((ticks + 1))
    done
    wait "$pid"
}
wait_limit=${HANDOFF_PUSH_WAIT:-5}
case "$wait_limit" in ''|*[!0-9]*) wait_limit=5 ;; esac

# A resume into a new container loses everything under the home
# directory: the state and the draft then come back from the store, so
# the open-state rows still reach the fresh context.
if [ -n "$state" ] && [ ! -f "$state" ] && [ -n "$session" ]; then
    restore_log=$(mktemp)
    if bounded "$wait_limit" "$restore_log" \
           handoff_store_pull "$session" "$state" "$(handoff_draft_path "$session")"; then
        echo "handing-off: restored the state and the draft from the store."
    fi
    rm -f "$restore_log"
fi
# Every compaction ends the handing-off runs before it (skills#267): the
# phase is cleared here, with or without a marker, so the next
# invocation starts run 1. The cleared state is pushed last, after the
# context is printed, and only for a bounded time.
phase=""
marker=""
if [ -n "$state" ] && [ -f "$state" ]; then
    phase=$(handoff_json_field phase "$(cat "$state")")
    [ -z "$phase" ] || handoff_state_set "$state" phase ""
fi
# The compaction also consumes the marker (review of skills#274, item
# 1): kept, it would pass the guard at the next compaction, and the
# next verification would restate its table as current. Read it first,
# then drop it here and in the pushed state.
cleared=$phase
if handoff_has_marker "$state"; then
    marker=$(cat "$state")
    handoff_state_set "$state" written_at "" written_epoch "" \
        handoff_path "" published_url "" context_tokens ""
    cleared=${phase:-the marker}
fi

# push_cleared_state: pushes the cleared state, waiting at most
# HANDOFF_PUSH_WAIT seconds (default 5); a push still running then goes
# on in the background. Prints one line when the push failed or did
# not finish in time.
push_cleared_state() {
    [ -n "$cleared" ] || return 0
    local log status=0
    log=$(mktemp)
    bounded "$wait_limit" "$log" handoff_store_push "$session" "$state" || status=$?
    if [ "$status" -eq 124 ]; then
        echo "handing-off: the push of the cleared state ($cleared) did not" \
             "finish within ${wait_limit}s; until it lands, a resume into a" \
             "new container restores it."
    elif [ "$status" -ne 0 ]; then
        echo "handing-off: $cleared is cleared here, but no store" \
             "took the cleared state, so a resume into a new container" \
             "restores it. $(tr '\n' ' ' < "$log")"
    fi
    rm -f "$log"
}

if [ -z "$marker" ]; then
    echo "COMPACTION JUST COMPLETED with no handoff marker — this" \
         "compaction ran unguarded. Tell the user at the start of your" \
         "reply: state before this point exists only in the summary," \
         "and a handoff should be reconstructed now from tickets and" \
         "the ledger before new work builds on it."
    push_cleared_state
    exit 0
fi
path=$(handoff_json_field handoff_path "$marker")
url=$(handoff_json_field published_url "$marker")
# The local copy of the handoff can be gone while the state is not; the
# store holds it under the session, so it comes back from there.
if [ -n "$path" ] && [ ! -f "$path" ] && [ -n "$session" ]; then
    draft_log=$(mktemp)
    bounded "$wait_limit" "$draft_log" handoff_store_pull_draft "$session" "$path" || true
    rm -f "$draft_log"
fi

# First table whose header names Item and Next; rows without header
# and separator. Multiple tables in the handoff are fine — the
# open-state one is the first that matches.
rows=""
if [ -n "$path" ] && [ -f "$path" ]; then
    rows=$(awk '
        /^\|/ { if (!in_t) { hdr = $0; in_t = 1; n = 0; rows = ""; next }
                n++; if (n == 1) next
                rows = rows $0 "\n"; next }
        in_t  { if (hdr ~ /[Ii]tem/ && hdr ~ /[Nn]ext/) { printf "%s", rows; done = 1; exit }
                in_t = 0 }
        # awk runs END after exit, so the flag keeps a table that ended
        # mid-file from printing twice (skills#174).
        END   { if (!done && in_t && hdr ~ /[Ii]tem/ && hdr ~ /[Nn]ext/) printf "%s", rows }
    ' "$path")
fi

echo "COMPACTION JUST COMPLETED. The latest handoff is" \
     "${path:-unrecorded}${url:+ (published: $url)}."
if [ -n "$rows" ]; then
    echo
    echo "Its open-state table, verbatim, in priority order (item | state | next):"
    echo
    printf '%s' "$rows"
    echo
    echo "Restate this list at the start of your reply — one short line" \
         "per item — and mark which item you are starting on, so the" \
         "user sees the list survived and where you are on it. Read the" \
         "full handoff before building on any single row."
else
    echo "Read it unless its content is already in context, and tell" \
         "the user at the start of your reply whether the handoff is" \
         "in context."
fi
push_cleared_state
exit 0

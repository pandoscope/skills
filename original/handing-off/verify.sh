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
state=$(handoff_marker_to_read "$(handoff_session_of_hook_input "$input")")
if ! handoff_has_marker "$state"; then
    echo "COMPACTION JUST COMPLETED with no handoff marker — this" \
         "compaction ran unguarded. Tell the user at the start of your" \
         "reply: state before this point exists only in the summary," \
         "and a handoff should be reconstructed now from tickets and" \
         "the ledger before new work builds on it."
    exit 0
fi
marker=$(cat "$state")

# Every compaction ends the handing-off runs before it (skills#267): the
# phase is cleared here and in the pushed state, so the next invocation
# starts run 1. The marker stays for the guard.
phase=$(handoff_json_field phase "$marker")
if [ -n "$phase" ]; then
    handoff_state_set "$state" phase ""
    session=$(handoff_session_of_hook_input "$input")
    if ! reason=$(handoff_store_push "$session" "$state" 2>&1); then
        echo "handing-off: the phase $phase is cleared here, but no store" \
             "took the cleared state, so a resume into a new container" \
             "restores the phase $phase. $reason"
    fi
fi
path=$(handoff_json_field handoff_path "$marker")
url=$(handoff_json_field published_url "$marker")

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
exit 0

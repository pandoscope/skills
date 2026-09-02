#!/bin/bash
# The post-compaction verification (skills#170; channel map in
# guard.sh). stdout on SessionStart(source=compact) lands in the fresh
# context — the one channel that reaches the model after compaction —
# so this is where the handoff gets its pointer and its priorities
# re-stated. Moved here from the installing project's hooks: this file
# reads what mark.sh writes and parses the table SKILL.md step 2
# defines, so every party to the contract ships and versions together.
#
# The open-state rows are lifted VERBATIM, in table order — notation,
# not paraphrase — so this output cannot drift from the handoff. The
# ordering is the skill's step-1 responsibility; extraction stays dumb
# on purpose.
set -u
state="${HANDOFF_STATE:-$HOME/.claude/handoff-state.json}"
if [ ! -f "$state" ]; then
    echo "COMPACTION JUST COMPLETED with no handoff marker — this" \
         "compaction ran unguarded. Tell the user at the start of your" \
         "reply: state before this point exists only in the summary," \
         "and a handoff should be reconstructed now from tickets and" \
         "the ledger before new work builds on it."
    exit 0
fi
path=$(sed -n 's/.*"handoff_path":"\([^"]*\)".*/\1/p' "$state")
url=$(sed -n 's/.*"published_url":"\([^"]*\)".*/\1/p' "$state")

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

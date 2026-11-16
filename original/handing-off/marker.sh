# shellcheck shell=bash
# The handoff marker inside the per-session state: the fields mark.sh
# writes, and whether they are still fresh. Sourced by state.sh after
# fields.sh.

# Tell whether a state file carries a marker.
#   $1  state file
# Returns 0 when the file exists and names a handoff (handoff_path);
# 1 otherwise. A state that holds only a phase carries no marker: run 1
# of handing-off writes one, and the hooks must not take it for a
# handoff (skills#267).
handoff_has_marker() {
    [ -n "$1" ] && [ -f "$1" ] \
        && [ -n "$(handoff_json_field handoff_path "$(cat "$1")")" ]
}

# Print why a marker is stale; nothing when it is fresh.
#   $1  state file carrying a marker
#   $2  the session's transcript, the measure of its context now; may
#       be empty
# Prints the rest of a sentence that starts "the handoff marker ", and
# returns 1 when stale; returns 0 when fresh.
# Freshness is growth-based: the marker records the context size at
# handoff time, and it goes stale once the context grew past
# HANDOFF_STALE_TOKENS (default 50000). Age alone is wrong in both
# directions: an old handoff with nothing after it is still fresh, a
# recent one buried under heavy growth is not. Age, past
# HANDOFF_MAX_AGE seconds (default 3600), is the fallback when either
# side has no token measure.
handoff_marker_staleness() {
    local tokens_then tokens_now grown slack age max
    tokens_then=$(handoff_json_number context_tokens "$(cat "$1")")
    [ "$tokens_then" != null ] || tokens_then=""
    tokens_now=$(handoff_context_tokens "$2")
    if [ -n "$tokens_then" ] && [ -n "$tokens_now" ]; then
        grown=$(( tokens_now - tokens_then ))
        slack="${HANDOFF_STALE_TOKENS:-50000}"
        if [ "$grown" -gt "$slack" ]; then
            echo "is stale — the context grew ~$grown tokens (slack $slack) since it was written"
            return 1
        fi
        return 0
    fi
    age=$(( $(date +%s) - $(date -r "$1" +%s) ))
    max="${HANDOFF_MAX_AGE:-3600}"
    if [ "$age" -gt "$max" ]; then
        echo "is ${age}s old and carries no token measure to judge growth against"
        return 1
    fi
    return 0
}

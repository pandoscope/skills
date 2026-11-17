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

# Print when a marker was written, in seconds since the epoch.
#   $1  state file carrying a marker
# Prints its written_epoch; the file's modification time for a marker
# written before that field existed. The file's time alone is wrong
# since the state holds more than the marker: a phase write touches it.
handoff_marker_epoch() {
    local epoch
    epoch=$(handoff_json_number written_epoch "$(cat "$1")")
    case "$epoch" in
        ''|null) date -r "$1" +%s ;;
        *) printf '%s\n' "$epoch" ;;
    esac
}

# Count the compactions a transcript records since a time.
#   $1  the session's transcript; may be empty
#   $2  seconds since the epoch
# Prints the number of compact_boundary records whose timestamp is at
# or after $2; 0 without a transcript. A compaction shrinks the
# context, so growth alone takes an older marker for fresh (review of
# skills#274, item 1): a boundary is the measure that survives it.
handoff_compactions_since() {
    local count=0 stamp epoch
    [ -n "$1" ] && [ -f "$1" ] || { echo 0; return 0; }
    while IFS= read -r stamp; do
        epoch=$(date -u -d "$stamp" +%s 2>/dev/null) || continue
        [ "$epoch" -lt "$2" ] || count=$((count + 1))
    done < <(grep '"subtype": *"compact_boundary"' "$1" \
                 | sed -n 's/.*"timestamp": *"\([^"]*\)".*/\1/p')
    echo "$count"
}

# Print why a marker is stale; nothing when it is fresh.
#   $1  state file carrying a marker
#   $2  the session's transcript, the measure of its context now; may
#       be empty
# Prints the rest of a sentence that starts "the handoff marker ", and
# returns 1 when stale; returns 0 when fresh.
# A marker older than a compaction in the transcript is stale. Beyond
# that, freshness is growth-based: the marker records the context size at
# handoff time, and it goes stale once the context grew past
# HANDOFF_STALE_TOKENS (default 50000). Age alone is wrong in both
# directions: an old handoff with nothing after it is still fresh, a
# recent one buried under heavy growth is not. Age, past
# HANDOFF_MAX_AGE seconds (default 3600), is the fallback when either
# side has no token measure.
handoff_marker_staleness() {
    local tokens_then tokens_now grown slack age max
    if [ "$(handoff_compactions_since "$2" "$(handoff_marker_epoch "$1")")" -gt 0 ]; then
        echo "predates a compaction of this session, which ended its cycle"
        return 1
    fi
    tokens_then=$(handoff_json_number context_tokens "$(cat "$1")")
    [ "$tokens_then" != null ] || tokens_then=""
    tokens_now=$(handoff_context_tokens "$2")
    if [ -n "$tokens_then" ] && [ -n "$tokens_now" ]; then
        grown=$(( tokens_now - tokens_then ))
        slack="${HANDOFF_STALE_TOKENS:-50000}"
        case "$slack" in
            ''|*[!0-9]*)
                echo "is stale — HANDOFF_STALE_TOKENS=$slack is no number, so its growth cannot be judged"
                return 1 ;;
        esac
        if [ "$grown" -gt "$slack" ]; then
            echo "is stale — the context grew ~$grown tokens (slack $slack) since it was written"
            return 1
        fi
        return 0
    fi
    age=$(( $(date +%s) - $(handoff_marker_epoch "$1") ))
    max="${HANDOFF_MAX_AGE:-3600}"
    case "$max" in
        ''|*[!0-9]*)
            echo "is stale — HANDOFF_MAX_AGE=$max is no number, so its age cannot be judged"
            return 1 ;;
    esac
    if [ "$age" -gt "$max" ]; then
        echo "is ${age}s old and carries no token measure to judge growth against"
        return 1
    fi
    return 0
}

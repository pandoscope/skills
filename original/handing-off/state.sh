# shellcheck shell=bash
# Where a session's handoff marker lives (skills#255). Sourced by
# mark.sh, check.sh, guard.sh and verify.sh, so all four resolve the
# marker the same way.
#
# A session id is the file name of the session's transcript without
# .jsonl. Each session gets its own marker,
# ~/.claude/handoff-state/<session-id>.json: one file shared by every
# session let parallel sessions overwrite each other's marker.

# Print the session id a transcript belongs to.
#   $1  transcript path
# Prints the file name without its directory and .jsonl; nothing for
# an empty path.
handoff_session_of_transcript() {
    [ -n "$1" ] || return 0
    basename "$1" .jsonl
}

# Print the marker path a session writes to.
#   $1  session id
# Prints $HANDOFF_STATE when set (one explicit file, whatever the
# session), else ~/.claude/handoff-state/<session-id>.json. Prints
# nothing when HANDOFF_STATE is unset and the session id is empty:
# there is no marker to name.
handoff_marker_path() {
    if [ -n "${HANDOFF_STATE:-}" ]; then
        printf '%s\n' "$HANDOFF_STATE"
    elif [ -n "$1" ]; then
        printf '%s\n' "$HOME/.claude/handoff-state/$1.json"
    fi
}

# Print the session id a hook input names.
#   $1  the hook input, the JSON object Claude Code sends on stdin
# Prints the value of its session_id; nothing when the input has none.
# sed, not a JSON tool, as in mark.sh: the consumer may lack one.
handoff_session_of_hook_input() {
    printf '%s\n' "$1" \
        | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

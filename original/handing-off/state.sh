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

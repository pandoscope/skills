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

# Tell whether a session id is a plain name, safe as a file name and
# as a find -name pattern.
#   $1  session id
# Returns 0 for a letter or digit followed by letters, digits, dots,
# dashes and underscores; 1 for anything else, the empty id included.
# Unlike the lookups here, it returns nonzero, for a caller to test.
handoff_valid_session() {
    case "$1" in
        [A-Za-z0-9]*) ;;
        *) return 1 ;;
    esac
    case "$1" in
        *[!A-Za-z0-9._-]*) return 1 ;;
    esac
    return 0
}

# Print the marker path a session writes to.
#   $1  session id
# Prints $HANDOFF_STATE when set (one explicit file, whatever the
# session), else ~/.claude/handoff-state/<session-id>.json. Prints
# nothing when HANDOFF_STATE is unset and the session id is not a
# plain name (handoff_valid_session): there is no marker to name.
handoff_marker_path() {
    if [ -n "${HANDOFF_STATE:-}" ]; then
        printf '%s\n' "$HANDOFF_STATE"
    elif handoff_valid_session "$1"; then
        printf '%s\n' "$HOME/.claude/handoff-state/$1.json"
    fi
}

# Print the marker path a session reads.
#   $1  session id
# Prints the session's own marker path (handoff_marker_path), or the
# one shared marker of earlier versions, ~/.claude/handoff-state.json,
# when HANDOFF_STATE is unset and the session has no own marker yet.
handoff_marker_to_read() {
    local own legacy
    own=$(handoff_marker_path "$1")
    legacy="$HOME/.claude/handoff-state.json"
    if [ -z "${HANDOFF_STATE:-}" ] && [ ! -f "$own" ] && [ -f "$legacy" ]; then
        printf '%s\n' "$legacy"
        return 0
    fi
    printf '%s\n' "$own"
}

# Print the session id a hook input names.
#   $1  the hook input, the JSON object Claude Code sends on stdin
# Prints the value of its session_id; else the session of its
# transcript_path; nothing when the input has neither.
# sed, not a JSON tool, as in mark.sh: the consumer may lack one.
handoff_session_of_hook_input() {
    local session
    session=$(handoff_json_field session_id "$1")
    if [ -z "$session" ]; then
        session=$(handoff_session_of_transcript \
                      "$(handoff_json_field transcript_path "$1")")
    fi
    printf '%s\n' "$session"
}

# Print the string value a key carries in a one-object JSON text.
#   $1  key
#   $2  the JSON text, a hook input or a pid file
# Prints nothing when the key is absent.
handoff_json_field() {
    printf '%s\n' "$2" \
        | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

# Print the session id of the session that runs the calling script.
# For the scripts the model runs, mark.sh and check.sh; the hooks take
# the session from their input instead.
# The first of these that names a session wins:
#   1. HANDOFF_TRANSCRIPT: the session of that transcript
#   2. Claude Code's pid file, ~/.claude/sessions/$CLAUDE_PID.json,
#      key sessionId. Not a documented interface, hence the fallbacks.
#   3. CLAUDE_CODE_SESSION_ID, which Claude Code sets in the model's
#      shell
#   4. the newest transcript (handoff_newest_transcript), with a
#      warning on stderr: it may be another session's
# Prints nothing when none names a session.
handoff_own_session() {
    if [ -n "${HANDOFF_TRANSCRIPT:-}" ]; then
        handoff_session_of_transcript "$HANDOFF_TRANSCRIPT"
        return 0
    fi
    local pid_file session
    pid_file="$HOME/.claude/sessions/${CLAUDE_PID:-}.json"
    if [ -n "${CLAUDE_PID:-}" ] && [ -f "$pid_file" ]; then
        session=$(handoff_json_field sessionId "$(cat "$pid_file")")
        if [ -n "$session" ]; then
            printf '%s\n' "$session"
            return 0
        fi
    fi
    # DECISION:SCOPE — The variable comes after the pid file, not
    # before it as skills#255's review comment proposes: whether it
    # equals the hook input's session_id on every host and after a
    # compaction or a resume is skills#268's question 4, unanswered
    # here. Move it first once that probe confirms it.
    if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
        printf '%s\n' "$CLAUDE_CODE_SESSION_ID"
        return 0
    fi
    local newest
    newest=$(handoff_newest_transcript)
    if [ -n "$newest" ]; then
        echo "handing-off: no pid file or CLAUDE_CODE_SESSION_ID names" \
             "this session; taking the newest transcript, $newest —" \
             "set HANDOFF_TRANSCRIPT if that is another session's" >&2
    fi
    handoff_session_of_transcript "$newest"
}

# Print the transcript of a session.
#   $1  session id
# Prints $HANDOFF_TRANSCRIPT when set, else
# ~/.claude/projects/<project>/<session-id>.jsonl; nothing when no
# such file exists or the session id is not a plain name.
handoff_transcript_of_session() {
    if [ -n "${HANDOFF_TRANSCRIPT:-}" ]; then
        printf '%s\n' "$HANDOFF_TRANSCRIPT"
        return 0
    fi
    handoff_valid_session "$1" || return 0
    find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 \
         -name "$1.jsonl" -type f -print -quit 2>/dev/null || true
}

# Print the newest session transcript on this machine.
# Prints nothing when ~/.claude/projects holds none.
handoff_newest_transcript() {
    # A loop, not find | sort | head -1: under pipefail, sort dies of
    # SIGPIPE once head has left and the list outgrows the pipe
    # (skills#245). -nt also needs no GNU find -printf. Depth 2 holds
    # the sessions' own transcripts, projects/<project>/<session>.jsonl;
    # subagents write theirs deeper, below <session>/subagents/.
    local candidate newest=""
    while IFS= read -r candidate; do
        if [ -z "$newest" ] || [ "$candidate" -nt "$newest" ]; then
            newest=$candidate
        fi
    done < <(find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 \
                   -name '*.jsonl' -type f 2>/dev/null)
    printf '%s\n' "$newest"
}

# shellcheck shell=bash
# Where a session's handoff marker lives (skills#255). Sourced by
# mark.sh, check.sh, guard.sh and verify.sh, so all four resolve the
# marker the same way.
#
# A session id is the file name of the session's transcript without
# .jsonl. Each session gets its own marker,
# ~/.claude/handoff-state/<session-id>.json: one file shared by every
# session let parallel sessions overwrite each other's marker.
#
# JSON reads and the state writer live in fields.sh, sourced here.
#
# Every lookup exits 0. A lookup that finds nothing prints nothing;
# find and cat errors on absent files are discarded, since an absent
# file is an empty answer.

# shellcheck source=original/handing-off/fields.sh
. "$(dirname "${BASH_SOURCE[0]}")/fields.sh"

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

# Print the path of a session's handoff draft (skills#267): the
# handoff file before it is published, beside the session's state.
#   $1  session id
# Prints the state path (handoff_marker_path) with .json replaced by
# .draft.md; nothing when there is no state path.
handoff_draft_path() {
    local state
    state=$(handoff_marker_path "$1")
    [ -n "$state" ] || return 0
    printf '%s\n' "${state%.json}.draft.md"
}

# Print the marker path a session reads.
#   $1  session id
# Prints the session's own marker path (handoff_marker_path), or the
# session's old shared marker (handoff_legacy_marker) while the session
# has no own marker yet and HANDOFF_STATE is unset.
handoff_marker_to_read() {
    local own legacy
    own=$(handoff_marker_path "$1")
    if [ -n "${HANDOFF_STATE:-}" ] || [ -f "$own" ]; then
        printf '%s\n' "$own"
        return 0
    fi
    legacy=$(handoff_legacy_marker "$1")
    if [ -n "$legacy" ]; then
        printf '%s\n' "$legacy"
    else
        printf '%s\n' "$own"
    fi
}

# Print the one shared marker of earlier versions,
# ~/.claude/handoff-state.json, when it belongs to a session.
#   $1  session id
# Prints its path when the file exists and its transcript_path names
# this session's transcript; nothing otherwise. A shared marker naming
# another session's transcript is that session's handoff.
handoff_legacy_marker() {
    local legacy legacy_session
    legacy="$HOME/.claude/handoff-state.json"
    [ -n "$1" ] && [ -f "$legacy" ] || return 0
    legacy_session=$(handoff_session_of_transcript \
        "$(handoff_json_field transcript_path "$(cat "$legacy")")")
    if [ "$legacy_session" = "$1" ]; then
        printf '%s\n' "$legacy"
    fi
}

# Print the session id a hook input names.
#   $1  the hook input, the JSON object Claude Code sends on stdin
# Prints the value of its session_id; else the session of its
# transcript_path; nothing when the input has neither.
handoff_session_of_hook_input() {
    local session
    session=$(handoff_json_field session_id "$1")
    if [ -z "$session" ]; then
        session=$(handoff_session_of_transcript \
                      "$(handoff_json_field transcript_path "$1")")
    fi
    printf '%s\n' "$session"
}

# Print the session id of the session that runs the calling script.
# For the scripts the model runs, mark.sh and check.sh; the hooks take
# the session from their input instead.
# The first of these that names a session wins:
#   1. HANDOFF_TRANSCRIPT: the session of that transcript
#   2. CLAUDE_CODE_SESSION_ID, which Claude Code sets in the model's
#      shell, with a warning on stderr when the pid file disagrees
#   3. Claude Code's pid file, ~/.claude/sessions/$CLAUDE_PID.json,
#      key sessionId. Not a documented interface.
#   4. the newest transcript (handoff_newest_transcript), with a
#      warning on stderr: it may be another session's
# Prints nothing when none names a session.
handoff_own_session() {
    if [ -n "${HANDOFF_TRANSCRIPT:-}" ]; then
        handoff_session_of_transcript "$HANDOFF_TRANSCRIPT"
        return 0
    fi
    local pid_file pid_session=""
    pid_file="$HOME/.claude/sessions/${CLAUDE_PID:-}.json"
    if [ -n "${CLAUDE_PID:-}" ] && [ -f "$pid_file" ]; then
        pid_session=$(handoff_json_field sessionId "$(cat "$pid_file")")
    fi
    # DECISION:SCOPE — The variable comes before the pid file.
    # skills#268 question 4 measured it on cloud (CLI 2.1.325): it
    # equals the hook input's session_id and the transcript's file name
    # before and after a compaction and after a resume into a new
    # container. The hooks key the marker on session_id, so the variable
    # names the marker they read. The macOS half of that question is
    # unmeasured.
    if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
        if [ -n "$pid_session" ] && [ "$pid_session" != "$CLAUDE_CODE_SESSION_ID" ]; then
            echo "handing-off: CLAUDE_CODE_SESSION_ID=$CLAUDE_CODE_SESSION_ID" \
                 "and sessionId $pid_session in $pid_file disagree;" \
                 "taking CLAUDE_CODE_SESSION_ID" >&2
        fi
        printf '%s\n' "$CLAUDE_CODE_SESSION_ID"
        return 0
    fi
    if [ -n "$pid_session" ]; then
        printf '%s\n' "$pid_session"
        return 0
    fi
    local newest
    newest=$(handoff_newest_transcript)
    if [ -n "$newest" ]; then
        echo "handing-off: no CLAUDE_CODE_SESSION_ID or pid file names" \
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
    # bash 3.2, macOS's default, compares -nt in whole seconds, so two
    # transcripts written in the same second tie; the caller warns that
    # this pick is a guess anyway.
    local candidate newest=""
    while IFS= read -r candidate; do
        if [ -z "$newest" ] || [ "$candidate" -nt "$newest" ]; then
            newest=$candidate
        fi
    done < <(find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 \
                   -name '*.jsonl' -type f 2>/dev/null)
    printf '%s\n' "$newest"
}

# Print a transcript's context size: the token sum (prompt + cache
# reads + cache writes) of its last assistant message's usage, the
# measure compaction acts on. mark.sh records it; guard.sh compares
# against it.
#   $1  transcript path
# Prints nothing when the path is empty, names no file, the transcript
# holds no assistant usage yet, or its last usage carries no count.
handoff_context_tokens() {
    [ -n "$1" ] && [ -f "$1" ] || return 0
    # DECISION:ARCH — One measure replaces mark.sh's sed copy and
    # guard.sh's jq copy (skills#255). It stays jq-free, as mark.sh
    # required, and takes the guard's selection: assistant messages
    # only, since a user line can carry a subagent's usage in its tool
    # result. The grep matches "type":"assistant" anywhere on a line,
    # where jq read the top-level type only. In current transcripts only
    # top-level assistant lines carry it; subagents write their own
    # files. sed, not a JSON tool: the quoted key "input_tokens":
    # cannot match inside "cache_read_input_tokens", because the
    # opening quote only ever precedes the full key.
    local line in cr cc
    # Claude Code writes an API error as an assistant line with model
    # <synthetic> and all-zero usage; that line measures nothing.
    line=$(grep '"type": *"assistant"' "$1" | grep '"usage"' \
               | grep -v '"model": *"<synthetic>"' | tail -1 || true)
    [ -n "$line" ] || return 0
    in=$(printf '%s' "$line" | sed -n 's/.*"input_tokens":\([0-9]\{1,\}\).*/\1/p')
    cr=$(printf '%s' "$line" | sed -n 's/.*"cache_read_input_tokens":\([0-9]\{1,\}\).*/\1/p')
    cc=$(printf '%s' "$line" | sed -n 's/.*"cache_creation_input_tokens":\([0-9]\{1,\}\).*/\1/p')
    # No count read means no measure, never a size of 0: 0 would pass
    # every stale marker.
    if [ -z "$in$cr$cc" ]; then
        return 0
    fi
    printf '%s\n' $(( ${in:-0} + ${cr:-0} + ${cc:-0} ))
}

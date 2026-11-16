#!/usr/bin/env bash
# Write the freshness marker that hooks compare against.
#
# Usage: mark.sh <handoff-file> [published-url]
# Env:   HANDOFF_STATE      marker path (default
#                           ~/.claude/handoff-state/<session-id>.json,
#                           see state.sh)
#        HANDOFF_TRANSCRIPT transcript path; unset = this session's
#                           transcript (lookup order in state.sh,
#                           handoff_own_session)
#
# The marker records the context size at handoff time: the token sum
# (prompt + cache reads + cache writes) of the transcript's last
# assistant usage — the same measure compaction itself acts on. A hook
# judging freshness compares growth since then; age alone is wrong in
# both directions — an old handoff with nothing after it is still
# fresh, a recent one buried under heavy context growth since is not.
# Without a findable transcript (or one carrying no usage yet) the
# marker carries null and hooks fall back to age.
set -euo pipefail

handoff=${1:?usage: mark.sh <handoff-file> [published-url]}
url=${2:-}
if [ ! -s "$handoff" ]; then
    echo "mark.sh: handoff file missing or empty: $handoff" >&2
    exit 1
fi
# Absolute, always: verify.sh and check.sh read this path from another
# cwd, and a relative path made the first real run extract nothing —
# silently (skills#174). No realpath: not every consumer has GNU tools.
handoff="$(cd "$(dirname "$handoff")" && pwd)/$(basename "$handoff")"

# shellcheck source=original/handing-off/state.sh
. "$(dirname "${BASH_SOURCE[0]}")/state.sh"

session=$(handoff_own_session)
transcript=$(handoff_transcript_of_session "$session")
state=$(handoff_marker_path "$session")
if [ -z "$state" ]; then
    echo "mark.sh: no session to mark: CLAUDE_PID=${CLAUDE_PID:-unset}," \
         "CLAUDE_CODE_SESSION_ID=${CLAUDE_CODE_SESSION_ID:-unset}, no" \
         "transcript under $HOME/.claude/projects (lookup order:" \
         "handoff_own_session in state.sh); set HANDOFF_TRANSCRIPT" \
         "or HANDOFF_STATE" >&2
    exit 1
fi

[ -f "$transcript" ] || transcript=""
tokens=$(handoff_context_tokens "$transcript")
if [ -z "$tokens" ]; then
    tokens=null
    echo "mark.sh: no transcript usage found — hooks fall back to marker age" >&2
fi

handoff_state_set "$state" \
    written_at "$(date -u +%FT%TZ)" handoff_path "$handoff" \
    published_url "$url" transcript_path "$transcript" \
    context_tokens "$tokens"
echo "marker written: $state"

# The session's own marker supersedes its old shared one. Left in
# place, the old one would serve the session again once its own marker
# is deleted. With HANDOFF_STATE set, the shared path may be the marker
# just written, so it stays.
if [ -z "${HANDOFF_STATE:-}" ]; then
    legacy=$(handoff_legacy_marker "$session")
    if [ -n "$legacy" ]; then
        rm "$legacy"
        echo "old shared marker retired: $legacy"
    fi
fi

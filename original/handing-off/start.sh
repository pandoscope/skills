#!/usr/bin/env bash
# What an invocation of handing-off starts (skills#267).
#
# Usage: start.sh
# Env:   HANDOFF_STATE, HANDOFF_TRANSCRIPT as for mark.sh (state.sh)
#
# Prints "starts: <what>" and "draft: <path>", and exits 0. The phase
# in the session's state decides <what>:
#   (no phase)  run 1
#   listed      run 2
#   written     run 2 at step 5
#   complete    the /compact proposal again, while the marker is fresh
#               (marker.sh); run 1 once it is stale
# Exits 1 when no session is found or the phase is unknown.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=original/handing-off/state.sh
. "$here/state.sh"

session=$(handoff_own_session)
state=$(handoff_marker_path "$session")
if [ -z "$state" ]; then
    echo "start.sh: no session found (lookup order: handoff_own_session" \
         "in state.sh); set HANDOFF_TRANSCRIPT or HANDOFF_STATE" >&2
    exit 1
fi
draft=$(handoff_draft_path "$session")

phase=""
[ -f "$state" ] && phase=$(handoff_json_field phase "$(cat "$state")")
case "$phase" in
    "") starts="run 1" ;;
    listed) starts="run 2" ;;
    written) starts="run 2 at step 5" ;;
    complete)
        if handoff_marker_staleness "$state" \
               "$(handoff_transcript_of_session "$session")" > /dev/null; then
            starts="the /compact proposal again"
        else
            starts="run 1"
        fi ;;
    *) echo "start.sh: unknown phase $phase in $state" >&2
       exit 1 ;;
esac
echo "starts: $starts"
echo "draft: $draft"

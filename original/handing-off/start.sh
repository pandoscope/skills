#!/usr/bin/env bash
# What an invocation of handing-off starts (skills#267).
#
# Usage: start.sh
# Env:   HANDOFF_STATE, HANDOFF_TRANSCRIPT as for mark.sh (state.sh)
#
# Prints "starts: <what>" and "draft: <path>", and for run 1
# "previous: <path in the store> at <commit>" or "previous: none"; exits
# 0. Without a
# local state it first restores the pushed state (store.sh) and says
# so. The phase in the session's state decides <what>:
#   (no phase)  run 1
#   listed      run 2
#   written     run 2 at step 5
#   complete    the /compact proposal again, while a marker exists and
#               is fresh (marker.sh); run 1 otherwise
# A new item after complete reopens the run: phase.sh listed returns
# the phase to listed and drops the marker, so the next invocation
# starts run 2.
# Run 1 sets an earlier draft at the path aside, as <draft>.previous.md,
# a local working copy only.
# Exits 1 when no session is found or the phase is unknown; 3 when a
# store is configured but does not answer, so the restore cannot tell
# whether it holds a run.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=original/handing-off/state.sh
. "$here/state.sh"
# shellcheck source=original/handing-off/store.sh
. "$here/store.sh"

session=$(handoff_own_session)
state=$(handoff_marker_path "$session")
if [ -z "$state" ]; then
    echo "start.sh: no session found (lookup order: handoff_own_session" \
         "in state.sh); set HANDOFF_TRANSCRIPT or HANDOFF_STATE" >&2
    exit 1
fi
draft=$(handoff_draft_path "$session")
# The draft is written to this path next; its directory must exist.
mkdir -p "$(dirname "$draft")"

# A resume into a new container leaves no local state; the pushed state
# under the session id stands in for it. With none, run 1 starts.
if [ ! -f "$state" ]; then
    pull_status=0
    reason=$(handoff_store_pull "$session" "$state" "$draft" 2>&1) || pull_status=$?
    case "$pull_status" in
        0) echo "restored the phase $(handoff_json_field phase "$(cat "$state")")" \
                "and the draft from the store" ;;
        3) # Run 1 here would push over the interrupted run's draft.
           echo "start.sh: the store did not answer ($reason); stopping, so" \
                "that run 1 does not overwrite a run the store may hold." \
                "Retry once the store answers."
           exit 3 ;;
    esac
fi

phase=""
[ -f "$state" ] && phase=$(handoff_json_field phase "$(cat "$state")")
case "$phase" in
    "") starts="run 1" ;;
    listed) starts="run 2" ;;
    written) starts="run 2 at step 5" ;;
    complete)
        if handoff_has_marker "$state" && handoff_marker_staleness "$state" \
               "$(handoff_transcript_of_session "$session")" > /dev/null; then
            starts="the /compact proposal again"
        else
            starts="run 1"
        fi ;;
    *) echo "start.sh: unknown phase $phase in $state" >&2
       exit 1 ;;
esac
# Run 1 starts a new draft: an earlier cycle's ticked list and Persisted
# list would otherwise pass this cycle's checks.
if [ "$starts" = "run 1" ] && [ -f "$draft" ]; then
    mv -f "$draft" "${draft%.md}.previous.md"
    echo "set the earlier draft aside as ${draft%.md}.previous.md"
fi
echo "starts: $starts"
echo "draft: $draft"
# The previous handoff is the draft the store last took for this
# session, named by path and commit: the path alone is overwritten by
# this run, and a local copy is lost on a resume (review of skills#274,
# item 10).
if [ "$starts" = "run 1" ]; then
    root=${HANDOFF_STORE:-}
    [ -n "$root" ] || [ ! -f "$state" ] || root=$(handoff_json_field store_root "$(cat "$state")")
    [ -n "$root" ] || root=$(handoff_store_root 2>/dev/null || true)
    previous=""
    if [ -n "$root" ] && [ -d "$root/.git" ]; then
        file="$(handoff_store_dir "$session")/draft.md"
        sha=$(git -C "$root" log -1 --format=%h -- "$file" 2>/dev/null || true)
        [ -z "$sha" ] || previous="$file at $sha"
    fi
    echo "previous: ${previous:-none}"
fi

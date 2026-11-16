#!/usr/bin/env bash
# Record the phase a run of handing-off ends in, and push the run's
# state (skills#267).
#
# Usage: phase.sh <listed|written>
# Env:   HANDOFF_STATE, HANDOFF_TRANSCRIPT as for mark.sh (state.sh);
#        HANDOFF_STORE and the store lookup in store.sh
#
# Writes the phase and the draft's path into the session's state, scans
# the draft and the state (scan.sh), and pushes both to the store
# (store.sh). Exits 0 once the phase is recorded, whether or not a
# store took it; a run without a store says so in one line. Exits 1
# when the draft is missing, when "written" is asked while the list is
# not settled (list.sh), or when the scan finds a blocked term, in
# which case nothing is pushed. Exits 2 on a usage error.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=original/handing-off/state.sh
. "$here/state.sh"
# shellcheck source=original/handing-off/store.sh
. "$here/store.sh"

phase=${1:-}
case "$phase" in
    listed|written) ;;
    *) echo "usage: phase.sh <listed|written>" >&2; exit 2 ;;
esac

session=$(handoff_own_session)
state=$(handoff_marker_path "$session")
draft=$(handoff_draft_path "$session")
if [ -z "$state" ]; then
    echo "phase.sh: no session to record the phase for (lookup order:" \
         "handoff_own_session in state.sh); set HANDOFF_TRANSCRIPT or" \
         "HANDOFF_STATE" >&2
    exit 1
fi
if [ ! -s "$draft" ]; then
    echo "phase.sh: no handoff draft at $draft — write the draft there first" >&2
    exit 1
fi

# DECISION:SCOPE — The list check decides whether the list is settled,
# not the model's word (skills#267), so the phase that says the list is
# settled cannot be recorded past it.
if [ "$phase" = written ] && ! "$here/list.sh" "$draft"; then
    echo "phase.sh: the finish-first list is not settled; the phase" \
         "stays as it was. Report the open items and end the turn" >&2
    exit 1
fi
if [ "$phase" = listed ]; then
    # A new list starts a new cycle: an earlier cycle's marker would
    # pass the guard while this list is open.
    handoff_state_set "$state" phase "$phase" draft_path "$draft" \
        written_at "" written_epoch "" handoff_path "" published_url "" \
        transcript_path "" context_tokens ""
else
    handoff_state_set "$state" phase "$phase" draft_path "$draft"
fi
if ! "$here/scan.sh" "$draft" "$state"; then
    echo "phase.sh: the scan found a blocked term; nothing was pushed." \
         "Remove the term from the draft, then rerun phase.sh $phase" >&2
    exit 1
fi
if ! handoff_store_push "$session" "$state" "$draft"; then
    echo "handing-off: no store took this run's state; a resume into a" \
         "new container loses this run"
fi
echo "phase $phase recorded in $state"

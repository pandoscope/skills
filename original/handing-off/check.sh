#!/usr/bin/env bash
# The rung-1 half of handing-off's completion criteria: the marker was
# written by this run and names a real handoff. Everything below rung 1
# prints as the residue.
set -euo pipefail

state=${HANDOFF_STATE:-$HOME/.claude/handoff-state.json}

fail() {
    printf '\n⚠️  **HANDING-OFF: %s**  ⚠️\n\n    %s\n    %s\n\n' "$1" "$2" "$3"
    exit 1
}

[ -f "$state" ] || fail "NO FRESHNESS MARKER" \
    "no marker at $state — a compaction gate reading it treats the handoff as absent" \
    "run ./mark.sh <handoff-file> [url]"

handoff=$(sed -n 's/.*"handoff_path":"\([^"]*\)".*/\1/p' "$state")
if [ -z "$handoff" ] || [ ! -s "$handoff" ]; then
    fail "HANDOFF FILE MISSING OR EMPTY" \
        "the marker names '$handoff' but no such non-empty file exists" \
        "rewrite the handoff, then rerun ./mark.sh"
fi

# Age here means "written by this handing-off run", nothing more —
# growth-based freshness across the session is the hooks' comparison.
age=$(( $(date +%s) - $(date -r "$state" +%s) ))
[ "$age" -le 900 ] || fail "MARKER PREDATES THIS RUN" \
    "the marker is ${age}s old — written by an earlier run, so this handoff was never marked" \
    "rerun ./mark.sh <handoff-file> [url] as this run's last step"

echo "machine checks pass: marker fresh, handoff file present"
cat <<'RESIDUE'
Residue — verify by reading, or hand to the human:
- the handoff is published and its URL recorded in the marker
- every open-state row carries a next action
- tickets and progress records the session touched are updated
- /compact focus proposals were printed for the user to choose
RESIDUE

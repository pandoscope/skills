#!/usr/bin/env bash
# The completion check of handing-off's second run: the hooks this
# skill ships are registered; the marker was written by this run, names
# a real handoff and is not older than it; the finish-first list is
# settled (list.sh); the Persisted list has an item; the run recorded
# the phase written. On a pass it sets
# the phase complete and pushes the state (store.sh). Everything a
# script cannot judge prints as the residue.
set -euo pipefail

skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=original/handing-off/state.sh
. "$skill_dir/state.sh"
# shellcheck source=original/handing-off/store.sh
. "$skill_dir/store.sh"
# With HANDOFF_STATE set, the marker needs no session, and the lookup
# would only print its newest-transcript warning.
session=""
if [ -n "${HANDOFF_STATE:-}" ]; then
    # The push still files the state under the session id.
    session=$(handoff_own_session 2>/dev/null)
else
    session=$(handoff_own_session)
fi
state=$(handoff_marker_to_read "$session")
settings=${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}

fail() {
    printf '\n⚠️  **HANDING-OFF: %s**  ⚠️\n\n    %s\n    %s\n\n' "$1" "$2" "$3"
    exit 1
}

# --- Registration: the skill ships the hooks, settings.json must
# reach them (skills#170). Checked by name, not by path, so a
# registration through any prefix (a manager's ~, an absolute install
# path) counts. Where nothing manages settings.json this check IS the
# installer; under a manager it only diagnoses — a merged-in entry
# would be erased by the manager's next wholesale rewrite, so the one
# honest move is naming what its template must carry.
verify_entry="{\"matcher\": \"compact\", \"hooks\": [{\"type\": \"command\", \"command\": \"$skill_dir/verify.sh\"}]}"
guard_entry="{\"hooks\": [{\"type\": \"command\", \"command\": \"$skill_dir/guard.sh\"}]}"
need_verify=1; need_guard=1
if [ -f "$settings" ]; then
    grep -q 'handing-off/verify\.sh' "$settings" && need_verify=0
    grep -q 'handing-off/guard\.sh' "$settings" && need_guard=0
fi
if [ "$need_verify" = 1 ] || [ "$need_guard" = 1 ]; then
    if [ -f "$settings" ] && grep -q '"managedBy"' "$settings"; then
        fail "HOOKS NOT REGISTERED UNDER A MANAGED settings.json" \
            "$settings is owned by a manager — an entry merged in here would be erased on its next rewrite" \
            "add to the manager's template: SessionStart += $verify_entry ; PreCompact += $guard_entry"
    fi
    command -v python3 >/dev/null || fail "HOOKS NOT REGISTERED, NO python3 TO MERGE" \
        "cannot edit $settings without python3" \
        "add by hand: SessionStart += $verify_entry ; PreCompact += $guard_entry"
    python3 - "$settings" "$skill_dir" "$need_verify" "$need_guard" <<'PY'
import json, os, sys
path, skill, need_verify, need_guard = sys.argv[1:5]
settings = json.load(open(path)) if os.path.isfile(path) else {}
hooks = settings.setdefault("hooks", {})
if need_verify == "1":
    hooks.setdefault("SessionStart", []).append(
        {"matcher": "compact",
         "hooks": [{"type": "command", "command": skill + "/verify.sh"}]})
if need_guard == "1":
    hooks.setdefault("PreCompact", []).append(
        {"hooks": [{"type": "command", "command": skill + "/guard.sh"}]})
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
with open(path, "w") as f:
    json.dump(settings, f, indent=4)
    f.write("\n")
PY
    echo "hooks registered into $settings — REGISTRATION IS CAPTURED AT" \
         "CLI STARTUP, so it protects the NEXT session: the compaction" \
         "this handoff prepares still runs without gate or verification." \
         "Tell the user."
else
    echo "hooks registered: verify.sh + guard.sh reachable from $settings"
fi

handoff_has_marker "$state" || fail "NO FRESHNESS MARKER" \
    "no marker for this session at ${state:-(no session found)} — a compaction gate reading it treats the handoff as absent" \
    "run ./mark.sh <handoff-file> [url]"

handoff=$(handoff_json_field handoff_path "$(cat "$state")")
if [ -z "$handoff" ] || [ ! -s "$handoff" ]; then
    fail "HANDOFF FILE MISSING OR EMPTY" \
        "the marker names '$handoff' but no such non-empty file exists" \
        "rewrite the handoff, then rerun ./mark.sh"
fi

# Age here means "written by this handing-off run", nothing more —
# growth-based freshness across the session is the hooks' comparison.
marked=$(handoff_marker_epoch "$state")
age=$(( $(date +%s) - marked ))
[ "$age" -le 900 ] || fail "MARKER PREDATES THIS RUN" \
    "the marker is ${age}s old — written by an earlier run, so this handoff was never marked" \
    "rerun ./mark.sh <handoff-file> [url] as this run's last step"
[ "$(date -r "$handoff" +%s)" -le "$marked" ] || fail "HANDOFF CHANGED AFTER THE MARKER" \
    "$handoff changed after the marker was written, so the marker does not cover it" \
    "rerun ./mark.sh <handoff-file> [url], then this check"

# --- Run 2's criteria (skills#267): the list check decides, never the
# model's word that the work is done.
if ! list_report=$("$skill_dir/list.sh" "$handoff"); then
    printf '%s\n' "$list_report"
    fail "FINISH-FIRST LIST NOT SETTLED" \
        "the list check names the open items above" \
        "settle them, or end the turn with the phase listed (./phase.sh listed)"
fi
# The Persisted list is read as list.sh reads the finish-first list
# (review of skills#274, round two, D7): fenced blocks are example text,
# only a heading of the same or a higher level ends the section, and
# any bullet or numbered item counts.
persisted=$(awk '
    { sub(/\r$/, "") }
    /^[[:space:]]*(```|~~~)/ { fenced = !fenced; next }
    fenced { next }
    /^#+[[:space:]]/ {
        level = index($0, " ") - 1
        if ($0 ~ /^#+[[:space:]]+Persisted[[:space:]]*$/) { p = 1; p_level = level; next }
        if (p && level <= p_level) p = 0
        next
    }
    p && /^[[:space:]]*([-*+]|[0-9]+[.)])[[:space:]]+[^[:space:]]/ { n++ }
    END { print n + 0 }' "$handoff")
[ "$persisted" -gt 0 ] || fail "NO PERSISTED LIST" \
    "$handoff has no \"Persisted\" heading with an item under it" \
    "record the sweep's findings there, or the single item \"none\""

# The phase table reaches complete only from written, and phase.sh
# written is where the open-state table is checked (review of
# skills#274, round three, E4).
case "$(handoff_json_field phase "$(cat "$state")")" in
    written|complete) ;;
    *) fail "PHASE NOT WRITTEN" \
        "the run has not recorded the phase written, so its open state is unchecked" \
        "write the open state into the draft, run ./phase.sh written, then rerun check.sh" ;;
esac

# The scan comes before the phase: a state recorded complete passes the
# guard and makes the next invocation propose /compact.
draft=$(handoff_json_field draft_path "$(cat "$state")")
if ! scan_report=$(handoff_store_scan "$session" "$state" "$draft" 2>&1); then
    printf '%s\n' "$scan_report"
    fail "BLOCKED TERM IN THE STATE OR THE DRAFT" \
        "the outgoing scan names its hits above; nothing was recorded or pushed" \
        "remove the terms, rerun ./mark.sh, then this check"
fi
handoff_state_set "$state" phase complete
if ! handoff_store_push "$session" "$state" "$draft"; then
    echo "handing-off: no store took this run's state; a resume into a" \
         "new container loses this run"
fi

echo "machine checks pass: marker fresh, handoff file present, list settled," \
     "Persisted list present; phase complete"
cat <<'RESIDUE'
Residue — verify by reading, or hand to the human:
- the handoff is published and its location recorded in the marker: its path in the store, never a URL of the store
- every open-state row carries a next action
- exactly one /compact command was printed for the user to run
RESIDUE

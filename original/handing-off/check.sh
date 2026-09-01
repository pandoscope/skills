#!/usr/bin/env bash
# The rung-1 half of handing-off's completion criteria: the hooks this
# skill ships are registered, and the marker was written by this run
# and names a real handoff. Everything below rung 1 prints as the
# residue.
set -euo pipefail

skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
state=${HANDOFF_STATE:-$HOME/.claude/handoff-state.json}
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

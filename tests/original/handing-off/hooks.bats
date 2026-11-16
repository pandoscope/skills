#!/usr/bin/env bats
# The hooks the skill ships (skills#170): verify.sh (SessionStart
# source=compact), guard.sh (PreCompact), and check.sh's registration
# installer.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  export HANDOFF_STATE="$TMP/state.json"
  export HANDOFF_TRANSCRIPT="$TMP/transcript.jsonl"
  export CLAUDE_SETTINGS="$TMP/settings.json"
  {
    echo '{"type":"user"}'
    echo '{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_creation_input_tokens":2000,"cache_read_input_tokens":640000,"output_tokens":10}}}'
  } > "$TMP/transcript.jsonl"
  cat > "$TMP/handoff.md" <<'MD'
# Handoff

## Open state

| Item | State | Next |
| --- | --- | --- |
| repo!12 fix | green, awaiting merge | merge it |
| repo#34 linter | designed, parked | grill the open questions |

## Gotchas
MD
}

teardown() { rm -rf "$TMP"; }

# --- verify.sh -----------------------------------------------------

@test "verify without a marker reports the unguarded compaction" {
  run "$SKILL/verify.sh" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"no handoff marker"* ]]
  [[ "$output" == *"reconstructed now"* ]]
}

@test "verify lifts the open-state rows verbatim and demands a restatement" {
  "$SKILL/mark.sh" "$TMP/handoff.md" "https://example.com/h" > /dev/null
  run "$SKILL/verify.sh" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"$TMP/handoff.md (published: https://example.com/h)"* ]]
  [[ "$output" == *"| repo!12 fix | green, awaiting merge | merge it |"* ]]
  [[ "$output" == *"| repo#34 linter | designed, parked | grill the open questions |"* ]]
  [[ "$output" != *"| Item | State | Next |"* ]]
  # Once each: awk's exit still runs END, which re-printed every row
  # on the first real handoff (skills#174).
  [ "$(printf '%s\n' "$output" | grep -c '^| repo!12 fix')" -eq 1 ]
  [[ "$output" == *"Restate this list"* ]]
  [[ "$output" == *"mark which item you are starting on"* ]]
}

@test "verify skips a table whose header is not the open-state one" {
  cat > "$TMP/handoff.md" <<'MD'
| Key | Value |
| --- | --- |
| a | b |

| Item | State | Next |
| --- | --- | --- |
| the real row | open | continue |
MD
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  run "$SKILL/verify.sh" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"| the real row | open | continue |"* ]]
  [[ "$output" != *"| a | b |"* ]]
}

@test "verify degrades to the pointer when the handoff has no table" {
  printf 'just prose\n' > "$TMP/handoff.md"
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  run "$SKILL/verify.sh" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"Read it unless its content is already in context"* ]]
  [[ "$output" != *"Restate"* ]]
}

# --- guard.sh ------------------------------------------------------

@test "guard blocks compaction without a marker" {
  run "$SKILL/guard.sh" < /dev/null
  [ "$status" -eq 2 ]
  [[ "$output" == *"COMPACTION BLOCKED: no handoff marker"* ]]
}

@test "guard passes on a fresh marker and blocks after context growth" {
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  run "$SKILL/guard.sh" < /dev/null
  [ "$status" -eq 0 ]
  echo '{"type":"assistant","message":{"usage":{"input_tokens":700005,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}' \
    >> "$TMP/transcript.jsonl"
  run "$SKILL/guard.sh" < /dev/null
  [ "$status" -eq 2 ]
  [[ "$output" == *"marker is stale"* ]]
}

@test "PRECOMPACT_GUARD=off waves compaction through" {
  run env PRECOMPACT_GUARD=off "$SKILL/guard.sh" < /dev/null
  [ "$status" -eq 0 ]
}

# --- check.sh registration -----------------------------------------

@test "check installs both registrations into an absent settings.json and warns" {
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REGISTRATION IS CAPTURED AT CLI STARTUP"* ]]
  grep -q "handing-off/verify.sh" "$CLAUDE_SETTINGS"
  grep -q "handing-off/guard.sh" "$CLAUDE_SETTINGS"
  python3 -c "import json;json.load(open('$CLAUDE_SETTINGS'))"
}

@test "check is quiet-green once registered, and preserves foreign keys" {
  printf '{"env": {"KEEP": "me"}, "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "x.sh"}]}]}}\n' > "$CLAUDE_SETTINGS"
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REGISTRATION IS CAPTURED"* ]]
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks registered: verify.sh + guard.sh reachable"* ]]
  [[ "$output" != *"REGISTRATION IS CAPTURED"* ]]
  grep -q '"KEEP": "me"' "$CLAUDE_SETTINGS"
  grep -q '"x.sh"' "$CLAUDE_SETTINGS"
}

@test "check refuses to edit a managed settings.json and names the entries" {
  printf '{"managedBy": "meta/environment/setup.sh", "hooks": {}}\n' > "$CLAUDE_SETTINGS"
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MANAGED settings.json"* ]]
  [[ "$output" == *"verify.sh"* ]]
  [[ "$output" == *"guard.sh"* ]]
  grep -q '"hooks": {}' "$CLAUDE_SETTINGS"
}

# --- mark.sh path handling (skills#174) ---------------------------

@test "a relative handoff path is stored absolute, so verify reads it from any cwd" {
  cd "$TMP"
  run "$SKILL/mark.sh" handoff.md
  [ "$status" -eq 0 ]
  grep -q "\"handoff_path\":\"$TMP/handoff.md\"" "$HANDOFF_STATE"
  cd /
  run "$SKILL/verify.sh" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"| repo!12 fix | green, awaiting merge | merge it |"* ]]
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
}

@test "guard still sees growth after a synthetic assistant line with zero usage" {
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  echo '{"type":"assistant","message":{"usage":{"input_tokens":700005,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}' \
    >> "$TMP/transcript.jsonl"
  echo '{"type":"assistant","message":{"model":"<synthetic>","usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}' \
    >> "$TMP/transcript.jsonl"
  run "$SKILL/guard.sh" < /dev/null
  [ "$status" -eq 2 ]
  [[ "$output" == *"marker is stale"* ]]
}

@test "verify run by hand in a terminal does not wait for hook input" {
  script -qec true /dev/null > /dev/null 2>&1 || skip "needs util-linux script for a terminal"
  # A pipe that stays open stands in for a person who types nothing.
  run bash -c "sleep 15 | timeout 5 script -qec '$SKILL/verify.sh' /dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no handoff marker"* ]]
}

# --- a state without a marker (skills#267) --------------------------
# Run 1 of handing-off leaves a state with a phase and no marker.

@test "guard blocks compaction on a state that holds a phase but no marker" {
  echo '{"phase":"listed","draft_path":"/x/draft.md"}' > "$HANDOFF_STATE"
  run "$SKILL/guard.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"COMPACTION BLOCKED: no handoff marker"* ]]
}

@test "verify reports a state that holds a phase but no marker as unguarded" {
  echo '{"phase":"listed","draft_path":"/x/draft.md"}' > "$HANDOFF_STATE"
  run "$SKILL/verify.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"no handoff marker"* ]]
}

@test "check fails on a state that holds a phase but no marker" {
  echo '{"phase":"listed","draft_path":"/x/draft.md"}' > "$HANDOFF_STATE"
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"NO FRESHNESS MARKER"* ]]
}

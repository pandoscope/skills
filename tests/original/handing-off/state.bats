#!/usr/bin/env bats
# The per-session state file (skills#267): one writer, state.sh's
# handoff_state_set, escapes every value and replaces the file in one
# step; mark.sh and the phase writers go through it.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  export HANDOFF_STATE="$TMP/state.json"
  export HANDOFF_TRANSCRIPT="$TMP/transcript.jsonl"
  echo '{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}' \
    > "$TMP/transcript.jsonl"
}

teardown() { rm -rf "$TMP"; }

@test "a state file with a double quote in the handoff path reads back unchanged" {
  dir="$TMP/a\"b"
  mkdir -p "$dir"
  echo "a handoff" > "$dir/handoff.md"
  run "$SKILL/mark.sh" "$dir/handoff.md"
  [ "$status" -eq 0 ]
  jq -e . "$HANDOFF_STATE" > /dev/null
  . "$SKILL/state.sh"
  [ "$(handoff_json_field handoff_path "$(cat "$HANDOFF_STATE")")" = "$dir/handoff.md" ]
}

@test "marking keeps the phase and the draft path of the state" {
  echo '{"phase":"written","draft_path":"/x/draft.md"}' > "$HANDOFF_STATE"
  echo "a handoff" > "$TMP/handoff.md"
  run "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"phase":"written"' "$HANDOFF_STATE"
  grep -q '"draft_path":"/x/draft.md"' "$HANDOFF_STATE"
  grep -q '"handoff_path":"'"$TMP"'/handoff.md"' "$HANDOFF_STATE"
}

@test "the state writer refuses an unknown field, a missing value, a bad number and a control character" {
  . "$SKILL/state.sh"
  run handoff_state_set "$HANDOFF_STATE" colour red
  [ "$status" -eq 1 ]; [[ "$output" == *"unknown field colour"* ]]
  run handoff_state_set "$HANDOFF_STATE" phase
  [ "$status" -eq 1 ]; [[ "$output" == *"field phase has no value"* ]]
  run handoff_state_set "$HANDOFF_STATE" context_tokens 12k
  [ "$status" -eq 1 ]; [[ "$output" == *"needs digits or null"* ]]
  run handoff_state_set "$HANDOFF_STATE" phase $'a\tb'
  [ "$status" -eq 1 ]; [[ "$output" == *"control character"* ]]
  [ ! -e "$HANDOFF_STATE" ]
}

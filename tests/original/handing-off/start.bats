#!/usr/bin/env bats
# start.sh (skills#267): the phase in the per-session state decides
# what an invocation starts. With no local state, the pushed state
# under the session id is restored first.

load store_helper

setup() { store_setup; }

teardown() { rm -rf "$TMP"; }

usage_line() {
  echo "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":$1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}" \
    >> "$HANDOFF_TRANSCRIPT"
}

@test "an invocation with neither local nor pushed state starts run 1" {
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
  [[ "$output" == *"draft: $TMP/state/s1.draft.md"* ]]
}

@test "an invocation in the phase listed starts run 2" {
  "$SKILL/phase.sh" listed > /dev/null
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 2"* ]]
  [[ "$output" != *"step 5"* ]]
}

@test "an invocation in the phase written starts run 2 at step 5" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/phase.sh" written > /dev/null
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 2 at step 5"* ]]
}

@test "an invocation in the phase complete proposes /compact again while the marker is fresh" {
  usage_line 100000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  . "$SKILL/state.sh"
  handoff_state_set "$HANDOFF_STATE" phase complete
  usage_line 120000
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: the /compact proposal again"* ]]
}

@test "an invocation in the phase complete starts run 1 when the marker is stale" {
  usage_line 100000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  . "$SKILL/state.sh"
  handoff_state_set "$HANDOFF_STATE" phase complete
  usage_line 200000
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
}

@test "an invocation in a state without a phase starts run 1" {
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
}

@test "an unknown phase is an error that names it" {
  echo '{"phase":"swept"}' > "$HANDOFF_STATE"
  run "$SKILL/start.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown phase swept"* ]]
}

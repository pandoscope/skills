#!/usr/bin/env bats
# The post-compaction verification clears the phase (skills#267), in
# the local state and in the pushed state, so the next invocation
# starts run 1.

load store_helper

setup() { store_setup; }

teardown() { rm -rf "$TMP"; }

@test "verify clears the phase in the local state and in the pushed state" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"COMPACTION JUST COMPLETED. The latest handoff"* ]]
  ! grep -q '"phase"' "$HANDOFF_STATE" || false
  grep -q '"handoff_path"' "$HANDOFF_STATE"
  ! remote_file handoffs/sessions/s1/state.json | grep -q '"phase"' || false
  run "$SKILL/start.sh"
  [[ "$output" == *"starts: run 1"* ]]
}

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

@test "the cleared state in the store still names the draft by its store path" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}' > /dev/null
  remote_file handoffs/sessions/s1/state.json | grep -q '"draft_path":"handoffs/sessions/s1/draft.md"'
}

# --- review of #274 -----------------------------------------------------

@test "verify clears the phase of a state that holds no marker" {
  "$SKILL/phase.sh" listed > /dev/null
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"no handoff marker"* ]]
  ! grep -q '"phase"' "$HANDOFF_STATE" || false
  run "$SKILL/start.sh"
  [[ "$output" == *"starts: run 1"* ]]
}

@test "verify prints its context first and waits a bounded time for the push" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  printf '#!/bin/sh\nsleep 6\n' > "$TMP/remote.git/hooks/pre-receive"
  chmod +x "$TMP/remote.git/hooks/pre-receive"
  export HANDOFF_PUSH_WAIT=1
  start=$(date +%s)
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$(( $(date +%s) - start ))" -lt 4 ]
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == *"COMPACTION JUST COMPLETED"* ]]
  [[ "$output" == *"did not finish within 1s"* ]]
}

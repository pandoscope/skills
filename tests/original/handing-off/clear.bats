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
  ! grep -q '"handoff_path"' "$HANDOFF_STATE" || false
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

@test "after a resume into a fresh home, verify restores the state from the store and lifts the rows" {
  cat >> "$TMP/state/s1.draft.md" <<'MD'

## Open state

| Item | State | Next |
| --- | --- | --- |
| repo#1 fix | open | merge it |
MD
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  # A resume into a new container loses everything under the home.
  rm "$HANDOFF_STATE" "$TMP/state/s1.draft.md"
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"| repo#1 fix | open | merge it |"* ]]
  [ -f "$TMP/state/s1.draft.md" ]
  ! grep -q '"phase"' "$HANDOFF_STATE" || false
}

@test "verify reads the handoff from the store clone when the local draft is gone" {
  sed -i 's/| repo#1 fix | open | merge it |/| repo#2 docs | open | write them |/' "$TMP/state/s1.draft.md"
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  rm "$TMP/state/s1.draft.md"
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"| repo#2 docs | open | write them |"* ]]
  [ -f "$TMP/state/s1.draft.md" ]
}

@test "the hooks find a store that was named only in the run's shell" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  # The hook runs in another process: HANDOFF_STORE is not set there.
  run env -u HANDOFF_STORE "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"no store took"* ]]
  ! remote_file handoffs/sessions/s1/state.json | grep -q '"phase"' || false
  ! remote_file handoffs/sessions/s1/state.json | grep -q '"store_root"' || false
}

@test "a restore that runs past the wait writes nothing later (D6)" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  rm "$HANDOFF_STATE" "$TMP/state/s1.draft.md"
  # A git on PATH whose fetch takes three seconds.
  mkdir -p "$TMP/bin"
  real=$(command -v git)
  printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = fetch ] && sleep 3; done\nexec "%s" "$@"\n' "$real" > "$TMP/bin/git"
  chmod +x "$TMP/bin/git"
  export HANDOFF_PUSH_WAIT=1
  PATH="$TMP/bin:$PATH" run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  sleep 4
  [ ! -e "$HANDOFF_STATE" ]
}

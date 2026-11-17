#!/usr/bin/env bats
# What reaches the store (skills#267): every push goes through the
# outgoing scan, the phase complete is recorded only once the scan
# passed, and the pushed state carries no local absolute path.

load store_helper

setup() {
  store_setup
  cat > "$TMP/state/s1.draft.md" <<'MD'
# Handoff

## Finish first

- [x] model: write the tickets

## Open state

| Item | State | Next |
| --- | --- | --- |
| repo#1 fix | open | merge it |

## Persisted

- none
MD
  export CLAUDE_SETTINGS="$TMP/settings.json"
}

teardown() { rm -rf "$TMP"; }

@test "a scan hit in check.sh leaves the phase short of complete and pushes nothing" {
  "$SKILL/phase.sh" written > /dev/null
  export PUSH_BLOCKLIST="Acme Corp"
  echo "- [x] model: tell Acme Corp" >> "$TMP/state/s1.draft.md"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED TERM"* ]]
  [[ "$output" != *"Acme"* ]]
  ! grep -q '"phase":"complete"' "$HANDOFF_STATE" || false
  ! remote_file handoffs/sessions/s1/state.json | grep -q '"phase":"complete"' || false
  run "$SKILL/start.sh"
  [[ "$output" != *"the /compact proposal again"* ]]
}

@test "check.sh with HANDOFF_STATE set pushes the phase complete" {
  "$SKILL/phase.sh" written > /dev/null
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  remote_file handoffs/sessions/s1/state.json | grep -q '"phase":"complete"'
}

@test "the pushed state carries no local absolute path" {
  "$SKILL/phase.sh" written > /dev/null
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/check.sh" > /dev/null
  pushed=$(remote_file handoffs/sessions/s1/state.json)
  [[ "$pushed" != *"$TMP"* ]]
  [[ "$pushed" == *'"handoff_path":"handoffs/sessions/s1/draft.md"'* ]]
}

@test "a blocked term in a local directory name does not stop the run" {
  mkdir -p "$TMP/AcmeCorp"
  export HANDOFF_STATE="$TMP/AcmeCorp/s1.json"
  cp "$TMP/state/s1.draft.md" "$TMP/AcmeCorp/s1.draft.md"
  export PUSH_BLOCKLIST="AcmeCorp"
  "$SKILL/phase.sh" written > /dev/null
  "$SKILL/mark.sh" "$TMP/AcmeCorp/s1.draft.md" > /dev/null
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  remote_file handoffs/sessions/s1/state.json | grep -q '"phase":"complete"'
}

@test "verify.sh pushes nothing that holds a blocked term" {
  "$SKILL/phase.sh" written > /dev/null
  export SESSION_MEMORY_URL="https://forge.example/acme/memory-store"
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" "$SESSION_MEMORY_URL/blob/main/h.md" > /dev/null
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"the value of SESSION_MEMORY_URL"* ]]
  ! remote_file handoffs/sessions/s1/state.json | grep -q "memory-store" || false
}

@test "a new item after complete reopens the run" {
  "$SKILL/phase.sh" written > /dev/null
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/check.sh" > /dev/null
  grep -q '"phase":"complete"' "$HANDOFF_STATE"
  sed -i 's/^- \[x\] model: write the tickets$/&\n- [ ] model: file the follow-up ticket/' "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  grep -q '"phase":"listed"' "$HANDOFF_STATE"
  ! grep -q '"handoff_path"' "$HANDOFF_STATE" || false
  run "$SKILL/guard.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  run "$SKILL/start.sh"
  [[ "$output" == *"starts: run 2"* ]]
  remote_file handoffs/sessions/s1/state.json | grep -q '"phase":"listed"'
}

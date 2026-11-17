#!/usr/bin/env bats
# A compaction ends a handoff's cycle (skills#267, review of #274 on
# 2026-11-17, items 1 and 2): the next compaction is blocked until a
# new handoff is marked, whichever trigger starts it, and no later
# compaction restates the old handoff as current.

load store_helper

setup() {
  store_setup
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  cat >> "$TMP/state/s1.draft.md" <<'MD'

## Open state

| Item | State | Next |
| --- | --- | --- |
| repo#1 fix | open | merge it |
MD
}

teardown() { rm -rf "$TMP"; }

# usage <tokens>: an assistant line that measures the context at that size.
usage() {
  printf '{"type":"assistant","message":{"usage":{"input_tokens":%s,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}\n' "$1" \
    >> "$HANDOFF_TRANSCRIPT"
}

# boundary <seconds from now>: the record a compaction leaves in the
# transcript.
boundary() {
  printf '{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","timestamp":"%s","compactMetadata":{"trigger":"auto"}}\n' \
    "$(date -u -d "@$(( $(date +%s) + $1 ))" +%Y-%m-%dT%H:%M:%S.000Z)" >> "$HANDOFF_TRANSCRIPT"
}

@test "after a compaction, the guard blocks the next one, manual or auto, while run 1 is under way" {
  usage 600000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  boundary 2
  "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}' > /dev/null
  usage 30000
  "$SKILL/start.sh" > /dev/null
  run "$SKILL/guard.sh" <<< '{"session_id":"s1","trigger":"auto"}'
  [ "$status" -eq 2 ]
  run "$SKILL/guard.sh" <<< '{"session_id":"s1","trigger":"manual"}'
  [ "$status" -eq 2 ]
}

@test "the guard blocks a marker older than a compaction, even when verify did not run" {
  usage 600000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  boundary 2
  usage 30000
  run "$SKILL/guard.sh" <<< '{"session_id":"s1","trigger":"auto"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"compaction"* ]]
}

@test "a marker written after the last compaction still passes the guard" {
  boundary -60
  usage 30000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  run "$SKILL/guard.sh" <<< '{"session_id":"s1","trigger":"auto"}'
  [ "$status" -eq 0 ]
}

@test "the state verify pushes after a compaction carries no marker, so a restored state passes nothing" {
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  "$SKILL/phase.sh" written > /dev/null
  "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}' > /dev/null
  ! remote_file handoffs/sessions/s1/state.json | grep -q '"handoff_path"' || false
  ! grep -q '"handoff_path"' "$HANDOFF_STATE" || false
  rm "$HANDOFF_STATE"
  "$SKILL/start.sh" > /dev/null
  run "$SKILL/guard.sh" <<< '{"session_id":"s1","trigger":"auto"}'
  [ "$status" -eq 2 ]
}

@test "a second compaction restates no table from the first one's handoff" {
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [[ "$output" == *"| repo#1 fix | open | merge it |"* ]]
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"| repo#1 fix |"* ]]
  [[ "$output" == *"no handoff marker"* ]]
}

@test "verify restates no table from a handoff that predates an earlier compaction" {
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  boundary 2
  boundary 4
  run "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"| repo#1 fix |"* ]]
  [[ "$output" == *"predates an earlier compaction"* ]]
}

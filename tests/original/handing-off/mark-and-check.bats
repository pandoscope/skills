#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  export HANDOFF_STATE="$TMP/state.json"
  export CLAUDE_SETTINGS="$TMP/settings.json"
  export HANDOFF_TRANSCRIPT="$TMP/transcript.jsonl"
  echo "a handoff" > "$TMP/handoff.md"
  {
    echo '{"type":"user"}'
    echo '{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_creation_input_tokens":2000,"cache_read_input_tokens":640000,"output_tokens":10}}}'
  } > "$TMP/transcript.jsonl"
}

teardown() { rm -rf "$TMP"; }

@test "mark then check passes, marker carries url and context tokens" {
  run "$SKILL/mark.sh" "$TMP/handoff.md" "https://example.com/h"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":642005' "$HANDOFF_STATE"
  grep -q '"published_url":"https://example.com/h"' "$HANDOFF_STATE"
  run "$SKILL/check.sh"
  [ "$status" -eq 0 ]
}

@test "the last usage wins, not an earlier one" {
  echo '{"type":"assistant","message":{"usage":{"input_tokens":1,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4}}}' \
    >> "$TMP/transcript.jsonl"
  run "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":6' "$HANDOFF_STATE"
}

@test "mark without a findable transcript records null and warns" {
  run env HANDOFF_TRANSCRIPT="$TMP/nope.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":null' "$HANDOFF_STATE"
  [[ "$output" == *"fall back to marker age"* ]]
}

@test "a transcript with no usage yet records null and warns" {
  echo '{"type":"user"}' > "$TMP/transcript.jsonl"
  run "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":null' "$HANDOFF_STATE"
  [[ "$output" == *"fall back to marker age"* ]]
}

@test "mark refuses a missing or empty handoff file" {
  : > "$TMP/handoff.md"
  run "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 1 ]
}

@test "check fails loudly without a marker" {
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"NO FRESHNESS MARKER"* ]]
}

@test "check fails when the marker predates the run" {
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  touch -d '30 minutes ago' "$HANDOFF_STATE"
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MARKER PREDATES THIS RUN"* ]]
}

@test "check fails when the marked handoff disappeared" {
  "$SKILL/mark.sh" "$TMP/handoff.md" > /dev/null
  rm "$TMP/handoff.md"
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MISSING OR EMPTY"* ]]
}

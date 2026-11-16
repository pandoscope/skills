#!/usr/bin/env bats
# The outgoing scan (skills#267): scan.sh looks for the values of the
# store URL variables and the terms in PUSH_BLOCKLIST, and names a hit
# by its source, never by its value.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  unset SESSION_MEMORY_URL DECISION_MEMORY_URL EVIDENCE_MEMORY_URL PUSH_BLOCKLIST
  printf '# Handoff\n\nnothing to hide\n' > "$TMP/draft.md"
  printf '{"phase":"listed"}\n' > "$TMP/state.json"
}

teardown() { rm -rf "$TMP"; }

@test "the scan fails on a draft that holds a store URL and names the variable, not the value" {
  export SESSION_MEMORY_URL="https://forge.example/acme/memory-store"
  echo "see $SESSION_MEMORY_URL/blob/main/x.md" >> "$TMP/draft.md"
  run "$SKILL/scan.sh" "$TMP/draft.md" "$TMP/state.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *"$TMP/draft.md holds the value of SESSION_MEMORY_URL"* ]]
  [[ "$output" != *"memory-store"* ]]
  [[ "$output" != *"state.json holds"* ]]
}

@test "the scan names a PUSH_BLOCKLIST hit by its position, not its value" {
  export PUSH_BLOCKLIST="Acme Corp|secret-host.internal|"
  echo "deploy to secret-host.internal" >> "$TMP/draft.md"
  run "$SKILL/scan.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"$TMP/draft.md holds PUSH_BLOCKLIST term 2"* ]]
  [[ "$output" != *"secret-host"* ]]
  [[ "$output" != *"term 1"* ]]
}

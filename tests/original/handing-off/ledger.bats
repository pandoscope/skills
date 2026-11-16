#!/usr/bin/env bats
# The ledger steps (skills#267): run 1 reads the thread ledger's view,
# run 2 writes one event per finish-first item that carries a thread
# slug. Without a ledger, each step says in one line that it skipped.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  cat > "$TMP/draft.md" <<'MD'
# Handoff

## Finish first

- [x] model: merge the fix (thread: fix-auth)
- [x] model: correct the README (dropped: a ticket covers it) (thread: readme)
- [x] model: run the probes (postponed until: the probe ticket closes) (thread: probes)
- [x] principal: detach the second repository

## Open state
MD
}

teardown() { rm -rf "$TMP"; }

@test "without a ledger, run 1's ledger step prints one line that it skipped" {
  export HANDOFF_LEDGER="$TMP/no-ledger.mjs"
  run "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == *"skips its ledger step"* ]]
}

@test "without a ledger, run 2's ledger step prints one line that it skipped" {
  export HANDOFF_LEDGER="$TMP/no-ledger.mjs"
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == *"skips its ledger step"* ]]
}

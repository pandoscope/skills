#!/usr/bin/env bats
# The list check (skills#267): list.sh decides whether the
# finish-first list in a handoff draft is settled.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
}

teardown() { rm -rf "$TMP"; }

draft() {
  { echo "# Handoff"; echo; echo "## Finish first"; echo; cat; echo; echo "## Open state"; } > "$TMP/draft.md"
}

@test "the list check passes when every item is ticked" {
  draft <<'MD'
- [x] model: write the tickets
- [x] principal: detach the second repository
- [x] model: correct the README (dropped: a ticket covers it)
- [x] model: run the probes (postponed until: the probe ticket closes)
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"settled"* ]]
}

@test "the list check fails on an unticked item and names it" {
  draft <<'MD'
- [x] model: write the tickets
- [ ] principal: confirm the edit to the body of ticket 12
- [ ] model: tick the [x] boxes in the README
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unticked: principal: confirm the edit to the body of ticket 12"* ]]
  [[ "$output" == *"unticked: model: tick the [x] boxes in the README"* ]]
  [[ "$output" != *"write the tickets"* ]]
}

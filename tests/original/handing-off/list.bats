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

@test "the list check fails on an item without an owner and names it" {
  draft <<'MD'
- [x] write the tickets
- [x] reviewer: read the diff
- [x] model: run the suite
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no owner: write the tickets"* ]]
  [[ "$output" == *"unknown owner reviewer: reviewer: read the diff"* ]]
  [[ "$output" != *"run the suite"* ]]
}

@test "the list check fails on a postponed item without a trigger and names it" {
  draft <<'MD'
- [x] model: run the probes (postponed)
- [x] model: rerun the suite (postponed until: )
- [x] model: write the ADR (postponed until: the ticket closes)
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"postponed without trigger: model: run the probes (postponed)"* ]]
  [[ "$output" == *"postponed without trigger: model: rerun the suite (postponed until: )"* ]]
  [[ "$output" != *"write the ADR"* ]]
}

@test "the list check fails on a draft without a finish-first list" {
  printf '# Handoff\n\n## Open state\n' > "$TMP/draft.md"
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no \"Finish first\" heading"* ]]
}

@test "the list check refuses a draft that does not exist" {
  run "$SKILL/list.sh" "$TMP/none.md"
  [ "$status" -eq 2 ]
  [[ "$output" == *"no draft at $TMP/none.md"* ]]
}

# --- what the list check cannot parse fails, never passes (review of #274)

@test "the list check fails on a list line that is not a checkbox item" {
  draft <<'MD'
- [x] model: write the tickets
- write the README
- [] model: empty box
-[ ] model: no space
1. [ ] model: numbered
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a checkbox item: - write the README"* ]]
  [[ "$output" == *"not a checkbox item: - [] model: empty box"* ]]
  [[ "$output" == *"not a checkbox item: -[ ] model: no space"* ]]
  [[ "$output" == *"not a checkbox item: 1. [ ] model: numbered"* ]]
}

@test "the list check reads plus bullets and nested items as checkbox items" {
  draft <<'MD'
+ [x] model: write the tickets
- [x] model: run the suite
  - [ ] model: the slow target
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unticked: model: the slow target"* ]]
  [[ "$output" == *"1 of 3 items open"* ]]
}

@test "items under a lower sub-heading stay in the list" {
  draft <<'MD'
### model

- [ ] model: write the tickets
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unticked: model: write the tickets"* ]]
}

@test "a fenced block inside the list neither ends it nor counts as items" {
  draft <<'MD'
- [x] model: run the script

```sh
# a comment, not a heading
- [ ] not an item
```

- [ ] model: read its output
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unticked: model: read its output"* ]]
  [[ "$output" != *"not an item"* ]]
}

@test "a fenced example of the heading is not the list" {
  printf '# Handoff\n\n```markdown\n## Finish first\n\n- [x] model: x\n```\n' > "$TMP/draft.md"
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no \"Finish first\" heading"* ]]
}

@test "the list check reads a draft with CRLF line ends" {
  printf '# Handoff\r\n\r\n## Finish first\r\n\r\n- [x] model: write the tickets\r\n- [ ] principal: confirm\r\n' > "$TMP/draft.md"
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unticked: principal: confirm"* ]]
  [[ "$output" == *"1 of 2 items open"* ]]
}

@test "an empty finish-first list is settled" {
  printf '# Handoff\n\n## Finish first\n\n## Open state\n' > "$TMP/draft.md"
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"settled: 0 items"* ]]
}

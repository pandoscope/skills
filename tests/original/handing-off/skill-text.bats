#!/usr/bin/env bats
# What SKILL.md asks the model to do, where a script cannot check the
# model's reply (skills#267).

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL_MD="$REPO_ROOT/original/handing-off/SKILL.md"
}

# The run 2 step that proposes /compact, from its number to the next.
compact_step() {
  awk '/^## Run 2/ { r = 1; next } /^## / { r = 0 }
       r && /^[0-9]+\. / { s = ($0 ~ /\/compact/) }
       r && s' "$SKILL_MD"
}

@test "run 2 proposes exactly one /compact command" {
  step=$(compact_step)
  [ -n "$step" ]
  [[ "$step" == *"exactly one \`/compact <focus line>\` command"* ]]
  [[ "$step" != *"one to three"* ]]
  [[ "$step" != *"candidate"* ]]
}

@test "run 2's ledger step passes the session's identity" {
  run2=$(awk '/^## Run 2/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$run2" == *'`./ledger.sh events --session-url <this session'"'"'s URL> <draft>`'* ]]
}

@test "the skill says that a handoff completes no thread" {
  grep -q "A handoff completes no thread" "$SKILL_MD"
}

@test "the session check comes at the start, and no step deletes a state file (item 9)" {
  start=$(awk '/^## Start/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$start" == *"newest transcript"* ]]
  [[ "$start" == *"HANDOFF_TRANSCRIPT"* ]]
  ! grep -qi "delete the state file" "$SKILL_MD" || false
}

@test "a second handoff starts from the current state and links the previous one in the store (item 10)" {
  ! grep -q '\.previous\.md' "$SKILL_MD" || false
  grep -q "starts from the current state" "$SKILL_MD"
  grep -q '`previous:`' "$SKILL_MD"
}

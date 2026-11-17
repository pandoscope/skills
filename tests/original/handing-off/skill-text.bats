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

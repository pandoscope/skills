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

@test "the handoff names the skills and tools to load again after a compaction (item 11)" {
  open_state=$(awk '/^## Open state/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$open_state" == *"load again"* ]]
}

@test "run 1 ends by saying that run 2 starts with a new invocation of the skill (item 12)" {
  last=$(awk '/^## Run 1/ { r = 1; next } /^## / { r = 0 }
              r && /^[0-9]+\. / { s = $0; next } r && /^   / { s = s "\n" $0 } END { print s }' "$SKILL_MD")
  [[ "$last" == *"new invocation of this skill"* ]]
  run2=$(awk '/^## Run 2/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$run2" == *"new invocation of this skill"* ]]
}

@test "the draft line names the path to write the draft to (item 13)" {
  start=$(awk '/^## Start/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$start" == *'`draft:` with the path to write the handoff draft to'* ]]
}

@test "the skill says where this session's URL comes from (item 16)" {
  grep -q "This session's URL is" "$SKILL_MD"
  grep -q "Claude-Session" "$SKILL_MD"
}

@test "the skill does not use the platform's task list (item 17)" {
  grep -q "does not use the platform's task list" "$SKILL_MD"
}

@test "run 2's publish step publishes, as the ticket's run 2 does, and adds no comments (item 18)" {
  run2=$(awk '/^## Run 2/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$run2" == *"Publish the draft"* ]]
  [[ "$run2" != *"comment on the tickets"* ]]
}

@test "run 2 relays the line that no store took a push (item 20)" {
  run2=$(awk '/^## Run 2/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$run2" == *"no store took"* ]]
}

@test "run 2 lists every named action and where each went, before the /compact command (item 22)" {
  run2=$(awk '/^## Run 2/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  step=$(printf '%s\n' "$run2" | awk '/^[0-9]+\. / { s = ($0 ~ /List every action you named/) } s')
  [ -n "$step" ]
  for place in "done" "on the finish-first list" "in the open-state table" "handed to the principal"; do
    [[ "$step" == *"$place"* ]]
  done
  [[ "$step" == *"the run reopens"* ]]
  named=$(printf '%s\n' "$run2" | grep -n "List every action you named" | cut -d: -f1)
  compact=$(printf '%s\n' "$run2" | grep -n "exactly one" | cut -d: -f1)
  [ "$named" -lt "$compact" ]
}

@test "the skill says that its scripts run from its own directory (item 23)" {
  start=$(awk '/^## Start/ { r = 1; next } /^## / { r = 0 } r' "$SKILL_MD")
  [[ "$start" == *"skill's directory"* ]]
}

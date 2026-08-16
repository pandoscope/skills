#!/usr/bin/env bats
# The token budget SKILL.md must hold, and the approval that lets a
# skill exceed it. Budget applies to SKILL.md alone: disclosed sibling
# files are paid only by the runs that read them.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  CHECK="$REPO_ROOT/derived/writing-skills/check.sh"
  SKILL=$(mktemp -d)/skill
  mkdir -p "$SKILL"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$SKILL/check.sh"
  chmod +x "$SKILL/check.sh"
}

teardown() { rm -rf "$(dirname "$SKILL")"; }

# Writes SKILL.md: frontmatter, the check.sh invocation every skill
# needs to pass the wiring check, then $1 bytes of filler body.
mkskill() {
  local bytes="$1" extra="${2:-}"
  {
    printf -- '---\nname: t\ndescription: t\n%s\n---\n\n# T\n\nRun check.sh.\n' "$extra"
    head -c "$bytes" < /dev/zero | tr '\0' 'x'
    printf '\n'
  } > "$SKILL/SKILL.md"
}

@test "a skill under the token budget passes" {
  mkskill 1000
  run "$CHECK" "$SKILL"
  [ "$status" -eq 0 ]
}

@test "a skill over the budget without approval fails, naming the count" {
  mkskill 8000
  run "$CHECK" "$SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"token"* ]]
  [[ "$output" == *"approval"* ]]
}

@test "an over-budget skill passes when the principal approved a ceiling above it" {
  mkskill 8000 'metadata.token-budget-approved: 4000'
  run "$CHECK" "$SKILL"
  [ "$status" -eq 0 ]
}

@test "growth past the approved ceiling fails again" {
  mkskill 8000 'metadata.token-budget-approved: 1200'
  run "$CHECK" "$SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"1200"* ]]
}

@test "the approved ceiling is reported so the exception stays visible" {
  mkskill 8000 'metadata.token-budget-approved: 4000'
  run "$CHECK" "$SKILL"
  [[ "$output" == *"4000"* ]]
}

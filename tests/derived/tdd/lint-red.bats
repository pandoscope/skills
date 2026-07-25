#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  PATH="${BATS_TEST_DIRNAME/#$REPO_ROOT\/tests/$REPO_ROOT}:$PATH"
  REPO=$(mktemp -d)
  cd "$REPO"
  git init -q
  git config user.email t@t && git config user.name t
  git commit -q --allow-empty -m "root"   # so HEAD~1 exists
}

teardown() { rm -rf "$REPO"; }

# helper: make a commit with given message and files
mkcommit() {
  local msg="$1"; shift
  for spec in "$@"; do
    local path="${spec%%=*}" content="${spec#*=}"
    mkdir -p "$(dirname "$path")"
    printf '%s\n' "$content" > "$path"
  done
  git add -A && git commit -qm "$msg"
}

@test "red commit with marker in test file passes" {
  mkcommit "test(red): retry behavior" \
    "src/retry.test.ts=test.fails('retries', () => {})"
  run lint-red.sh commit HEAD
  [ "$status" -eq 0 ]
}

@test "red commit touching production file fails" {
  mkcommit "test(red): sneaky" \
    "src/retry.test.ts=test.fails('x', () => {})" \
    "src/retry.ts=export const x = 1"
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
  [[ "$output" == *"non-test file"* ]]
}

@test "red commit without marker fails" {
  mkcommit "test(red): forgot marker" \
    "src/retry.test.ts=test('retries', () => {})"
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
}

@test "feat commit introducing marker fails" {
  mkcommit "feat: impl" \
    "src/retry.test.ts=it.fails('x', () => {})"
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
}

@test "tree mode catches lingering marker" {
  printf '%s\n' '@pytest.mark.xfail(strict=True)' > test_foo.py
  run lint-red.sh tree
  [ "$status" -eq 1 ]
}

# --- regression tests: bugs in the pre-merge script -------------------------

@test "BUG1: feat commit introducing jest it.failing marker fails" {
  # old MARKERS only matched '\.fails\(' (vitest); jest's .failing( slipped through
  mkcommit "feat: impl" \
    "src/retry.test.ts=it.failing('x', () => {})"
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
  [[ "$output" == *"outside test(red)"* ]]
}

@test "BUG1b: red commit whose only marker is test.failing passes" {
  # complement: jest marker must also SATISFY the marker-required check
  mkcommit "test(red): jest style" \
    "src/retry.test.ts=test.failing('retries', () => {})"
  run lint-red.sh commit HEAD
  [ "$status" -eq 0 ]
}

@test "BUG2: commit mode on root commit does not crash" {
  # old script: git diff "\$ref~1" explodes when ref has no parent.
  # Build a fresh repo whose ROOT commit is a red commit (setup() pre-creates
  # a root, so use a separate repo).
  ROOT_REPO=$(mktemp -d)
  cd "$ROOT_REPO"
  git init -q
  git config user.email t@t && git config user.name t
  mkdir -p src
  printf '%s\n' "test.fails('x', () => {})" > src/a.test.ts
  git add -A && git commit -qm "test(red): first behavior"
  run lint-red.sh commit HEAD
  cd "$REPO" && rm -rf "$ROOT_REPO"
  [ "$status" -eq 0 ]
}

@test "BUG3: red commit with Go marker but no red-tests CI job fails" {
  # old script had no CI-job-presence check; build-tagged tests are
  # invisible to the normal suite without the inverse job
  mkcommit "test(red): go thing" \
    "pkg/thing_test.go=//go:build red

package pkg

func TestRedThing(t *testing.T) {}"
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
  [[ "$output" == *"red-tests"* ]]
}

@test "BUG3b: same commit passes once red-tests job exists" {
  # CI config must land in its OWN commit — a red commit may only touch
  # test files, so adding ci.yml inside it would (correctly) fail
  mkcommit "ci: add red-tests job" \
    ".forgejo/workflows/ci.yml=red-tests:"
  mkcommit "test(red): go thing" \
    "pkg/thing_test.go=//go:build red

package pkg

func TestRedThing(t *testing.T) {}"
  run lint-red.sh commit HEAD
  [ "$status" -eq 0 ]
}

@test "BUG4: Go red-tagged test without TestRed prefix fails" {
  # marker + wrong name = excluded from normal suite AND unmatched by
  # inverse job's -run '^TestRed' → silently never executed anywhere
  mkcommit "ci: add red-tests job" \
    ".forgejo/workflows/ci.yml=red-tests:"
  mkcommit "test(red): invisible go test" \
    "pkg/thing_test.go=//go:build red

package pkg

func TestThing(t *testing.T) {}"
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
  [[ "$output" == *"TestRed"* ]]
}

@test "BUG4b: Rust red-ignored test without red_ prefix fails" {
  # marker + wrong name = unmatched by inverse job's 'cargo test red_'
  mkcommit "ci: add red-tests job" \
    ".forgejo/workflows/ci.yml=red-tests:"
  mkcommit "test(red): invisible rust test" \
    'tests/thing.rs=#[ignore = "red"]
#[test]
fn wrong_name() { assert!(false) }'
  run lint-red.sh commit HEAD
  [ "$status" -eq 1 ]
  [[ "$output" == *"red_"* ]]
}

@test "BUG4c: Rust red-ignored test with red_ prefix passes" {
  mkcommit "ci: add red-tests job" \
    ".forgejo/workflows/ci.yml=red-tests:"
  mkcommit "test(red): proper rust test" \
    'tests/thing.rs=#[ignore = "red"]
#[test]
fn red_thing() { assert!(false) }'
  run lint-red.sh commit HEAD
  [ "$status" -eq 0 ]
}

@test "BUG5: staged mode exists and rejects marker outside red commit" {
  # old script's header claimed pre-commit support via --cached but had no
  # such mode — 'staged' didn't exist at all
  mkdir -p src
  printf '%s\n' "it.fails('x', () => {})" > src/a.test.ts
  git add -A
  printf '%s\n' "feat: sneaky" > msgfile
  COMMIT_MSG_FILE=msgfile run lint-red.sh staged
  [ "$status" -eq 1 ]
  [[ "$output" == *"outside test(red)"* ]]
}

@test "BUG5b: staged mode passes a proper red commit-in-progress" {
  mkdir -p src
  printf '%s\n' "test.fails('retries', () => {})" > src/a.test.ts
  git add -A
  printf '%s\n' "test(red): retry behavior" > msgfile
  COMMIT_MSG_FILE=msgfile run lint-red.sh staged
  [ "$status" -eq 0 ]
}

@test "BUG6: unknown mode exits nonzero instead of silently passing" {
  # old script: case falls through with no default → 'lint-red: OK', exit 0.
  # A typo'd mode name in prek/CI config would disable enforcement silently.
  run lint-red.sh bogus-mode
  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown mode"* ]]
}

@test "BUG7: tree mode ignores markers inside documentation" {
  # Generated repos vendor this skill at .agents/skills/tdd/SKILL.md, whose
  # marker table contains every marker string. Tree mode grepped the whole
  # tree, so the merge gate failed on every repo that vendored the skill.
  mkcommit "docs: vendored skill" \
    ".agents/skills/tdd/SKILL.md=| Python (pytest) | \`@pytest.mark.xfail(strict=True)\` | yes |"
  run lint-red.sh tree
  [ "$status" -eq 0 ]
}

@test "BUG7b: tree mode still catches a real marker in a test file" {
  mkcommit "test: lingering" \
    "src/thing.test.ts=test.fails('nope', () => {})"
  run lint-red.sh tree
  [ "$status" -eq 1 ]
}

#!/usr/bin/env bats
# writing-prose check.sh: F rules fail the run, H rules print candidates.
# Test names carry the tier and rule id ("F filler ...", "H hedging ..."):
# the coverage test reads them to prove every F rule has a failing and a
# passing case, and every H rule a candidate case.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  CHECK="$REPO_ROOT/original/writing-prose/check.sh"
  TMP=$(mktemp -d)
}

teardown() { rm -rf "$TMP"; }

# Writes stdin to $TMP/$1 and prints the path.
text() {
  cat > "$TMP/$1"
  printf '%s\n' "$TMP/$1"
}

@test "an unknown surface is a usage error" {
  f=$(printf 'Plain text.\n' | text a.md)
  run "$CHECK" novel "$f"
  [ "$status" -eq 2 ]
  [[ "$output" == *"surface"* ]]
}

@test "F filler fails on a filler word, naming file, line and rule" {
  f=$(printf 'First line.\nThe hook just runs.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"a.md:2: F filler"* ]]
}

@test "F filler passes clean text and ignores code" {
  f=$(printf 'The hook runs.\nIt calls `just build`.\n\n```sh\njust test\n```\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
  [[ "$output" != *"F filler"* ]]
}

@test "F pleasantry fails on an opener or offer" {
  f=$(printf 'Sure! The hook runs.\nHappy to help with that.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"a.md:1: F pleasantry"* ]]
  [[ "$output" == *"a.md:2: F pleasantry"* ]]
}

@test "F pleasantry passes 'make sure' and 'be sure'" {
  f=$(printf 'Make sure the hook runs.\nBe sure to pin it.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
}

@test "F store-id fails on a decision record id" {
  f=$(printf 'Ruled in 20260729T120404Z-comments-state-present.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"F store-id"* ]]
}

@test "F store-id passes plain dates and times" {
  f=$(printf 'Released 2026-07-29 at 12:04 UTC.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
}

@test "F tracker-placeholder fails on an angle placeholder in tracker text" {
  f=$(printf 'Run it on decisions/<id>.json.\n' | text t.md)
  run "$CHECK" tracker "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"F tracker-placeholder"* ]]
}

@test "F tracker-placeholder passes guillemets, code spans and HTML tags" {
  f=$(printf 'Run it on decisions/«id».json.\nOr `decisions/<id>.json`.\nLine<br>break.\n' | text t.md)
  run "$CHECK" ticket "$f"
  [[ "$output" != *"tracker-placeholder"* ]]
}

@test "F code-placeholder fails on a guillemet in a code comment" {
  f=$(printf 'x = 1  # not this\n# Reads decisions/«id».json.\n' | text c.py)
  run "$CHECK" comment "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"c.py:2: F code-placeholder"* ]]
}

@test "F code-placeholder passes angle placeholders in comments" {
  f=$(printf '# Reads decisions/<id>.json.\n' | text c.py)
  run "$CHECK" comment "$f"
  [ "$status" -eq 0 ]
}

@test "F commit-link fails on a bare or backticked commit hash in tracker text" {
  f=$(printf 'Fixed in 9020b19.\nSee `1ea7679`.\n' | text t.md)
  run "$CHECK" tracker "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"t.md:1: F commit-link"* ]]
  [[ "$output" == *"t.md:2: F commit-link"* ]]
}

@test "F commit-link passes linked hashes and owner/repo@sha" {
  f=$(printf 'Fixed in [9020b19](https://github.com/o/r/commit/9020b19abc).\nAlso o/r@1ea7679.\nThe word deadbeef and 1234567 are no hashes.\n' | text t.md)
  run "$CHECK" tracker "$f"
  [[ "$output" != *"commit-link"* ]]
}

@test "F ungrilled fails on a ticket that never states its grilling" {
  f=$(printf '## What to build\n\nA check.\n' | text t.md)
  run "$CHECK" ticket "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"F ungrilled"* ]]
}

@test "F ungrilled passes a ticket that says it was not grilled" {
  f=$(printf 'Not grilled. Scoped in chat.\n\n## What to build\n\nA check.\n' | text t.md)
  run "$CHECK" ticket "$f"
  [[ "$output" != *"ungrilled"* ]]
}

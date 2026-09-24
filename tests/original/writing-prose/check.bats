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

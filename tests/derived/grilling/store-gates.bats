#!/usr/bin/env bats
# The store-backed gates: resolve-never-clone discovery, verbatim
# citations, and the refusal to run ahead of an unmerged session.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/derived/grilling"
  RESOLVE="$SKILL/resolve-store.sh"
  TMP=$(mktemp -d)
  STORE="$TMP/decision-memory"
  # A store the harness would have cloned: a git repo with an origin/main.
  mkdir -p "$STORE"
  git init -q -b main "$STORE"
  git -C "$STORE" config user.email t@t
  git -C "$STORE" config user.name t
  printf 'Prefers machine checks over model checks wherever feasible.\nBuilds only what a concrete case demands.\n' > "$STORE/preferences.txt"
  mkdir -p "$STORE/decisions"
  git -C "$STORE" add -A
  git -C "$STORE" commit -qm seed
  git -C "$STORE" update-ref refs/remotes/origin/main HEAD
  export DECISION_MEMORY_URL="https://example.invalid/decision-memory.git"
  export DECISION_MEMORY_ROOT="$STORE"
}

teardown() { rm -rf "$TMP"; }

# The fixture session with its two placeholder rule names rewritten to
# the given strings everywhere they appear -- citations, lineage and
# answer state stay consistent, so only the citation text varies.
mksession() {
  node -e '
    const fs = require("fs");
    const [fixture, out, ...prefs] = process.argv.slice(1);
    let text = fs.readFileSync(fixture, "utf8");
    const placeholders = JSON.parse(text).preferences;
    placeholders.forEach((name, i) => {
      text = text.split(JSON.stringify(name)).join(JSON.stringify(prefs[i]));
    });
    fs.writeFileSync(out, text);
  ' "$REPO_ROOT/tests/derived/grilling/fixtures/session.json" "$TMP/s.json" "$@"
}

@test "the store resolves to the harness clone, never a fresh one" {
  run "$RESOLVE" path
  [ "$status" -eq 0 ]
  [ "$output" = "$STORE" ]
}

@test "an unnamed store names the fix instead of cloning" {
  unset DECISION_MEMORY_URL DECISION_MEMORY_ROOT
  run "$RESOLVE" path
  [ "$status" -ne 0 ]
  [[ "$output" == *"unset"* ]]
}

@test "a missing clone tells the user to add the store as a session source" {
  unset DECISION_MEMORY_ROOT
  export HOME="$TMP"
  run "$RESOLVE" path
  [ "$status" -ne 0 ]
  [[ "$output" == *"session sources"* || "$output" == *"SESSION_ROOT"* ]]
}

@test "preferences are emitted verbatim for mechanical injection" {
  run "$RESOLVE" preferences
  [ "$status" -eq 0 ]
  [[ "$output" == *"Prefers machine checks over model checks wherever feasible."* ]]
}

@test "a settled store reports no unmerged records" {
  run "$RESOLVE" unmerged
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "records on an unmerged branch are reported" {
  git -C "$STORE" checkout -q -b session/1
  echo '{}' > "$STORE/decisions/20260815T000000Z-x.json"
  git -C "$STORE" add -A
  git -C "$STORE" commit -qm "decision(x): x"
  run "$RESOLVE" unmerged
  [ "$status" -eq 0 ]
  [[ "$output" == *"decisions/20260815T000000Z-x.json"* ]]
}

@test "check.sh accepts citations that are verbatim store lines" {
  mksession "Prefers machine checks over model checks wherever feasible." \
            "Builds only what a concrete case demands."
  run "$SKILL/check.sh" "$TMP/s.json"
  [ "$status" -eq 0 ]
}

@test "check.sh rejects a citation missing the line's trailing period" {
  mksession "Prefers machine checks over model checks wherever feasible" \
            "Builds only what a concrete case demands."
  run "$SKILL/check.sh" "$TMP/s.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *"verbatim"* || "$output" == *"DOES NOT MATCH THE STORE"* ]]
}

@test "check.sh fails while a previous session's records are unmerged" {
  mksession "Prefers machine checks over model checks wherever feasible." \
            "Builds only what a concrete case demands."
  git -C "$STORE" checkout -q -b session/1
  echo '{}' > "$STORE/decisions/20260815T000000Z-x.json"
  git -C "$STORE" add -A
  git -C "$STORE" commit -qm "decision(x): x"
  run "$SKILL/check.sh" "$TMP/s.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *"NOT MERGED"* ]]
}

@test "an unresolved store skips the store checks out loud, without failing" {
  unset DECISION_MEMORY_URL DECISION_MEMORY_ROOT
  run "$SKILL/check.sh" "$REPO_ROOT/tests/derived/grilling/fixtures/session.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"RECORDING SKIPPED"* ]]
}

# The loud shape is the convention, so it is pinned rather than trusted:
# a failure nobody notices is a failure that did not happen. Asserted
# against the raw stream -- bats trims $output, and the blank lines
# around the banner are half of what makes it pop.
@test "failures are loud: warning banner, bold headline, blank lines around" {
  unset DECISION_MEMORY_URL DECISION_MEMORY_ROOT
  run bash -c '"$1" path 2>"$2"' _ "$RESOLVE" "$TMP/err"
  [ "$status" -ne 0 ]
  grep -Fq '⚠️  **GRILLING: NO DECISION STORE IS NAMED**  ⚠️' "$TMP/err"
  banner=$(grep -Fn '⚠️  **GRILLING' "$TMP/err" | head -1 | cut -d: -f1)
  [ -z "$(sed -n "$((banner - 1))p" "$TMP/err")" ]
  [ -z "$(sed -n "$((banner + 1))p" "$TMP/err")" ]
  # The fix is indented under the banner, not jammed against it.
  [[ "$(sed -n "$((banner + 2))p" "$TMP/err")" == "    "* ]]
}

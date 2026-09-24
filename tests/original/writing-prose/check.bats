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

@test "without --before the run says which rules it skipped" {
  f=$(printf 'The hook runs.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"skipped code-exact"* ]]
  [[ "$output" == *"skipped reflow"* ]]
}

@test "F code-exact fails when a rewrite changes a code block" {
  old=$(printf 'Run this:\n\n```sh\nmake test\n```\n' | text old.md)
  f=$(printf 'Run:\n\n```sh\nmake tests\n```\n' | text a.md)
  run "$CHECK" markdown "$f" --before "$old"
  [ "$status" -eq 1 ]
  [[ "$output" == *"a.md:3: F code-exact"* ]]
}

@test "F code-exact passes when only prose changed" {
  old=$(printf 'Run this now:\n\n```sh\nmake test\n```\n' | text old.md)
  f=$(printf 'Run:\n\n```sh\nmake test\n```\n' | text a.md)
  run "$CHECK" markdown "$f" --before "$old"
  [ "$status" -eq 0 ]
}

@test "F reflow fails on a paragraph rewrapped without a word changed" {
  old=$(printf 'The hook runs first. It reads\nthe order and exits.\n' | text old.md)
  f=$(printf 'The hook runs first.\nIt reads the order and exits.\n' | text a.md)
  run "$CHECK" markdown "$f" --before "$old"
  [ "$status" -eq 1 ]
  [[ "$output" == *"a.md:1: F reflow"* ]]
}

@test "F reflow passes an edited paragraph and a style commit's rewrap" {
  old=$(printf 'The hook runs first. It reads\nthe order and exits.\n' | text old.md)
  f=$(printf 'The hook runs first.\nIt reads the order, then exits.\n' | text a.md)
  run "$CHECK" markdown "$f" --before "$old"
  [ "$status" -eq 0 ]
  g=$(printf 'The hook runs first.\nIt reads the order and exits.\n' | text b.md)
  run "$CHECK" markdown "$g" --before "$old" --style
  [ "$status" -eq 0 ]
}

# H rules print a candidate and never fail the run on their own.
candidate() {
  local surface=$1 id=$2 line=$3 content=$4
  f=$(printf '%b' "$content" | text x.md)
  run "$CHECK" "$surface" "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"x.md:$line: H $id"* ]]
}

@test "H hedging flags hedges and signposts" { candidate markdown hedging 1 'Note that the hook might run twice.\n'; }
@test "H not-just flags the not-just-but escalation" { candidate markdown not-just 1 'It is not only a bug but a design flaw.\n'; }
@test "H ai-pattern flags stock rhetorical frames" { candidate markdown ai-pattern 1 'Not because it fails, but because it drifts.\n'; }
@test "H abbreviation flags an unknown abbreviation once" { candidate markdown abbreviation 1 'The QZX runs. The QZX stops.\n'; }
@test "H one-fact flags a clause-dense sentence" { candidate markdown one-fact 1 'The hook reads the order, checks the clone, switches the ref, and exits.\n'; }
@test "H actor-subject flags a config as subject" { candidate markdown actor-subject 1 'The config decides which clone runs.\n'; }
@test "H verb-distance flags a subject held apart from its verb" { candidate markdown verb-distance 1 'The hook, between the two steps, runs.\n'; }
@test "H relative-clause flags a reduced relative" { candidate markdown relative-clause 1 'Each clone named in the block switches.\n'; }
@test "H event-noun flags a nominalized event" { candidate markdown event-noun 1 'The creation of the branch happens first.\n'; }
@test "H present-tense flags history in prose" { candidate markdown present-tense 1 'The hook no longer reads the file.\n'; }
@test "H removed-mention flags a removal note" { candidate markdown removed-mention 1 'The flag was removed in 2.0.\n'; }
@test "H non-requirement flags a stated non-requirement" { candidate markdown non-requirement 1 'Key order does not matter.\n'; }
@test "H pitch flags value words" { candidate markdown pitch 1 'A powerful, seamless check.\n'; }
@test "H drifting-ref flags a count tied to position" { candidate markdown drifting-ref 1 'The seven examples above show it.\n'; }
@test "H line-ref flags a line-number reference" { candidate markdown line-ref 1 'See check.awk:42 for the rule.\n'; }
@test "H glossary-marking flags a plain mention after the term's link" { candidate markdown glossary-marking 2 'The [drift](drift.md) check runs.\nIt reports drift per file.\n'; }
@test "H sembr flags two sentences on one line" { candidate markdown sembr 1 'The hook runs. It exits.\n'; }
@test "H hard-wrap flags a wrapped tracker paragraph" { candidate tracker hard-wrap 1 'The hook runs first and\nthen exits.\n'; }
@test "H ticket-code flags a path in a ticket" { candidate ticket ticket-code 2 'Not grilled.\nEdit original/writing-prose/check.awk.\n'; }

@test "H sembr stays quiet on lines a rewrite left unchanged" {
  old=$(printf 'The hook runs. It exits.\n' | text old.md)
  f=$(printf 'The hook runs. It exits.\n\nA new line.\n' | text a.md)
  run "$CHECK" markdown "$f" --before "$old"
  [[ "$output" != *"H sembr"* ]]
}

@test "H glossary-marking passes bold later mentions" {
  f=$(printf 'The [drift](drift.md) check runs.\nIt reports **drift** per file.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"glossary-marking"* ]]
}

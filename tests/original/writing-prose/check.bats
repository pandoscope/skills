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

@test "H ticket-code skips a path inside a link" {
  f=$(printf 'The [check](https://github.com/o/r/blob/main/review/policy.mjs#L3) denies it.\n' | text t.md)
  run "$CHECK" ticket "$f"
  [[ "$output" != *"ticket-code"* ]]
}

@test "F relative-link fails on a relative link in tracker text" {
  f=$(printf 'See [the check](original/review/policy.mjs).\nAnd [root](/docs/a.md).\n' | text t.md)
  run "$CHECK" tracker "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"t.md:1: F relative-link"* ]]
  [[ "$output" == *"t.md:2: F relative-link"* ]]
}

@test "F relative-link passes absolute, anchor and code links in tracker text" {
  f=$(printf 'See [it](https://github.com/o/r/blob/main/a.md), [below](#spec) and `[x](y.md)`.\n' | text t.md)
  run "$CHECK" tracker "$f"
  [ "$status" -eq 0 ]
}

@test "F pinned-anchor fails on a line anchor on a branch link in tracker text" {
  f=$(printf 'See [check](https://github.com/o/r/blob/main/a.mjs#L319-L331).\n' | text t.md)
  run "$CHECK" tracker "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"t.md:1: F pinned-anchor"* ]]
}

@test "F pinned-anchor passes a line anchor on a commit link in tracker text" {
  f=$(printf 'See [check](https://github.com/o/r/blob/bad438c5ac69e01eebef31f27bd0c0552e0dc524/a.mjs#L319-L331) and [file](https://github.com/o/r/blob/main/a.mjs).\n' | text t.md)
  run "$CHECK" tracker "$f"
  [ "$status" -eq 0 ]
}

@test "H repo-link flags an absolute repository link in markdown" {
  f=$(printf 'See [the check](https://github.com/o/r/blob/main/a.mjs).\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"a.md:1: H repo-link"* ]]
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
@test "H end-weight flags two clauses trailing the main clause" { candidate markdown end-weight 1 'The hook exits early because the clone is dirty, which the log reports when the run ends.\n'; }
@test "H end-weight leaves one trailing reason" {
  f=$(printf 'The hook exits early because the clone is dirty.\n' | text x.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"end-weight"* ]]
}
@test "H end-weight counts per sentence, not per line" {
  f=$(printf 'The hook exits early when the clone is dirty. It logs the result because the caller reads it.\n' | text x.md)
  run "$CHECK" tracker "$f"
  [[ "$output" != *"end-weight"* ]]
}
@test "H actor-subject flags a config as subject" { candidate markdown actor-subject 1 'The config decides which clone runs.\n'; }
@test "H verb-distance flags a subject held apart from its verb" { candidate markdown verb-distance 1 'The hook, between the two steps, runs.\n'; }
@test "H relative-clause flags a reduced relative" { candidate markdown relative-clause 1 'Each clone named in the block switches.\n'; }
@test "H event-noun flags a nominalized event" { candidate markdown event-noun 1 'The creation of the branch happens first.\n'; }
@test "H present-tense flags history in prose" { candidate markdown present-tense 1 'The hook no longer reads the file.\n'; }
@test "H removed-mention flags a removal note" { candidate markdown removed-mention 1 'The flag was removed in 2.0.\n'; }
@test "H non-requirement flags a stated non-requirement" { candidate markdown non-requirement 1 'Key order does not matter.\n'; }
@test "H pitch flags value words" { candidate markdown pitch 1 'A powerful, seamless check.\n'; }
@test "H drifting-ref flags a count tied to position" { candidate markdown drifting-ref 1 'The seven examples above show it.\n'; }
@test "H drifting-ref flags a count that the list after it states" { candidate markdown drifting-ref 1 'The composer writes six keys to the answers file: `detected` and `order`.\n'; }
@test "H drifting-ref leaves a count that no list restates" {
  f=$(printf 'The loop retries three times.\nCheck 3 fires: the ledger has no event.\n' | text x.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"drifting-ref"* ]]
}
@test "H line-ref flags a line-number reference" { candidate markdown line-ref 1 'See check.awk:42 for the rule.\n'; }
@test "H glossary-marking flags a plain mention after the term's link" { candidate markdown glossary-marking 2 'The [drift](drift.md) check runs.\nIt reports drift per file.\n'; }
@test "H sembr flags two sentences on one line" { candidate markdown sembr 1 'The hook runs. It exits.\n'; }
@test "H hard-wrap flags a wrapped tracker paragraph" { candidate tracker hard-wrap 1 'The hook runs first and\nthen exits.\n'; }
@test "H only-place flags only before a verb" { candidate markdown only-place 1 'The script only reports owners.\n'; }

@test "H only-place flags only before an irregular past" { candidate markdown only-place 1 'They only ran in CI.\n'; }

@test "H only-place passes only before what it limits" {
  f=$(printf 'The policy allows redirects only to `/dev/null`.\nGive each instance only its deltas.\nThe behaviour-only findings are correct.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"only-place"* ]]
}

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

# Rule ids with their tier from the rules files: "F filler", "M referent".
rules_ids() {
  sed -n 's/^- `\([a-z-]*\)` \[\([FHM]\)\] .*/\2 \1/p' "$REPO_ROOT"/original/writing-prose/rules/*.md | sort
}

@test "every rule id appears once across the rules files" {
  run bash -c "$(declare -f rules_ids); REPO_ROOT=$REPO_ROOT; rules_ids | awk '{print \$2}' | sort | uniq -d"
  [ -n "$(rules_ids)" ]
  [ -z "$output" ]
}

@test "the check implements exactly the F and H rules of the rules files" {
  run "$CHECK" --list
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | sort)" = "$(rules_ids | grep -v '^M ')" ]
}

@test "every F rule has a failing and a passing test, every H rule a candidate test" {
  for id in $(rules_ids | sed -n 's/^F //p'); do
    grep -q "@test \"F $id fails" "$BATS_TEST_FILENAME" || { echo "no failing test for $id"; return 1; }
    grep -q "@test \"F $id passes" "$BATS_TEST_FILENAME" || { echo "no passing test for $id"; return 1; }
  done
  for id in $(rules_ids | sed -n 's/^H //p'); do
    grep -q "@test \"H $id flags" "$BATS_TEST_FILENAME" || { echo "no candidate test for $id"; return 1; }
  done
}

@test "a run ends with the M rules of its surface as residue" {
  f=$(printf 'The hook runs.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"M referent:"* ]]
  [[ "$output" != *"M chat-sentences"* ]]
  run "$CHECK" chat "$f"
  [[ "$output" == *"M chat-sentences:"* ]]
  [[ "$output" != *"M referent"* ]]
}

@test "--rules names the rules files a surface reads" {
  run "$CHECK" --rules skill
  [ "$status" -eq 0 ]
  [[ "$output" == *"rules/shared.md"* ]]
  [[ "$output" == *"rules/skill.md"* ]]
  [[ "$output" != *"rules/tracker.md"* ]]
}

@test "--rules gives the argued register to docs and tickets, not to instruction files" {
  for surface in markdown ticket tracker; do
    run "$CHECK" --rules "$surface"
    [[ "$output" == *"rules/argued.md"* ]] || { echo "$surface lacks argued.md"; return 1; }
  done
  for surface in skill primed comment commit; do
    run "$CHECK" --rules "$surface"
    [[ "$output" != *"rules/argued.md"* ]] || { echo "$surface reads argued.md"; return 1; }
  done
}

@test "the skill passes the writing-skills check" {
  run "$REPO_ROOT/derived/writing-skills/check.sh" "$REPO_ROOT/original/writing-prose"
  [ "$status" -eq 0 ]
}

@test "frontmatter is not judged as prose" {
  f=$(printf -- '---\nname: x\ndescription: >\n  Rules per surface, and the loop\n  that checks them.\n---\n\n# X\n' | text SKILL.md)
  run "$CHECK" skill "$f"
  [[ "$output" != *"H sembr"* ]]
}

@test "commit messages may state history" {
  f=$(printf 'fix: restore the check\n\nThe hook no longer read the file; the flag was removed in 2.0.\n' | text msg)
  run "$CHECK" commit "$f"
  [[ "$output" != *"H present-tense"* ]]
  [[ "$output" != *"H removed-mention"* ]]
}

@test "a quoted word is a mention, not a use" {
  f=$(printf 'Cut filler words such as "just" and "really".\nCut openers like “sure”.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [ "$status" -eq 0 ]
  [[ "$output" != *"F filler"* ]]
  [[ "$output" != *"F pleasantry"* ]]
}

@test "H abbreviation stays quiet on an all-caps phrase" {
  f=$(printf 'ACTIVE EVERY RESPONSE once triggered.\nPut notes in the BREAKING CHANGE footer.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"H abbreviation"* ]]
}

@test "F code-placeholder passes a guillemet that is no placeholder" {
  f=$(printf 'if (s ~ /[«»]/) exit 1  # matches either guillemet\n' | text c.awk)
  run "$CHECK" comment "$f"
  [[ "$output" != *"code-placeholder"* ]]
}

@test "H long-line flags a long prose line with no clause boundary" {
  long='The runner reads every numbered file in the checked out steps directory of the environment repository in file name order today.'
  candidate markdown long-line 1 "$long\n"
}

@test "H long-line stays quiet on a long line that is mostly a link" {
  f=$(printf 'See [the steps](https://github.com/pandoscope/meta/blob/main/environment/hooks/session-start.d/README.md#the-numbered-steps-and-their-order).\n' | text a.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"H long-line"* ]]
}

@test "F reflow fails on a rewrapped comment block" {
  old=$(printf 'x=1\n# The hook runs first. It reads\n# the order and exits.\ny=2\n' | text old.sh)
  f=$(printf 'x=1\n# The hook runs first.\n# It reads the order and exits.\ny=2\n' | text a.sh)
  run "$CHECK" comment "$f" --before "$old"
  [ "$status" -eq 1 ]
  [[ "$output" == *"a.sh:2: F reflow"* ]]
}

@test "F reflow passes an edited comment block and code-only changes" {
  old=$(printf 'x=1\n# The hook runs first. It reads\n# the order and exits.\ny=2\n' | text old.sh)
  f=$(printf 'x=3\n# The hook runs first.\n# It reads the order, then exits.\ny=4\n' | text a.sh)
  run "$CHECK" comment "$f" --before "$old"
  [ "$status" -eq 0 ]
}

@test "H sembr flags two sentences on one comment line" {
  f=$(printf 'x=1\n# The hook runs. It exits.\n' | text a.sh)
  run "$CHECK" comment "$f"
  [[ "$output" == *"a.sh:2: H sembr"* ]]
}

@test "--rules gives comments the layout rules and Markdown keeps them" {
  run "$CHECK" --rules comment
  [[ "$output" == *"rules/layout.md"* ]]
  run "$CHECK" --rules markdown
  [[ "$output" == *"rules/layout.md"* ]]
  run "$CHECK" --rules tracker
  [[ "$output" != *"rules/layout.md"* ]]
}

@test "H sembr stays quiet on a break before a conjunction" {
  f=$(printf 'The runner always exits 0\nand names the step that failed,\nor the file it did not run.\nIt logs what it saw\nso the next reader can check it.\n' | text a.md)
  run "$CHECK" markdown "$f"
  [[ "$output" != *"H sembr"* ]]
}

@test "H sembr still flags a break inside a clause" {
  candidate markdown sembr 2 'The hook reads the\norder file.\n'
}

@test "--fix puts one sentence per line in a comment and keeps code lines" {
  f=$(printf '%s\n' 'x = 1  // trailing stays' '// The hook runs first. It reads the guard after' '// the checks, so cycleOf bounds it. cycleOf counts.' 'y = 2' | text a.mjs)
  run "$CHECK" comment "$f" --fix
  run cat "$f"
  [ "${lines[0]}" = 'x = 1  // trailing stays' ]
  [ "${lines[1]}" = '// The hook runs first.' ]
  [ "${lines[2]}" = '// It reads the guard after the checks, so cycleOf bounds it.' ]
  [ "${lines[3]}" = '// cycleOf counts.' ]
  [ "${lines[4]}" = 'y = 2' ]
}

@test "--fix breaks a long sentence at the clause boundary nearest its middle" {
  long='The renderer replaces every store URL on the page with a placeholder before it writes, so an old event renders clean, and check 7 still scans the page for a miss.'
  f=$(printf '%s\n' "$long" | text a.md)
  run "$CHECK" markdown "$f" --fix
  run cat "$f"
  [ "$output" = $'The renderer replaces every store URL on the page with a placeholder before it writes,\nso an old event renders clean, and check 7 still scans the page for a miss.' ]
}

@test "--fix leaves lists, code blocks and e.g. alone" {
  f=$(printf '%s\n' '- One item. Two sentences.' '' '```' 'Code here. Stays.' '```' '' 'Use a tool, e.g. Foo. Then stop.' | text a.md)
  run "$CHECK" markdown "$f" --fix
  run cat "$f"
  [ "$output" = $'- One item. Two sentences.\n\n```\nCode here. Stays.\n```\n\nUse a tool, e.g. Foo.\nThen stop.' ]
}

@test "--fix with --before rewrites only paragraphs the change touched" {
  old=$(printf '%s\n' 'First para wraps' 'mid clause here.' '' 'Second para wraps' 'mid clause too.' | text old.md)
  f=$(printf '%s\n' 'First para wraps' 'mid clause here.' '' 'Second para now wraps' 'mid clause too.' | text a.md)
  run "$CHECK" markdown "$f" --fix --before "$old"
  [[ "$output" != *"F reflow"* ]]
  run cat "$f"
  [ "$output" = $'First para wraps\nmid clause here.\n\nSecond para now wraps mid clause too.' ]
}

@test "--fix refuses a surface without layout rules" {
  f=$(printf 'One. Two.\n' | text a.txt)
  run "$CHECK" commit "$f" --fix
  [ "$status" -eq 2 ]
}

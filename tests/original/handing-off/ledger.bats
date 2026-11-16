#!/usr/bin/env bats
# The ledger steps (skills#267): run 1 reads the thread ledger's view,
# run 2 writes one event per finish-first item that carries a thread
# slug. Without a ledger, each step says in one line that it skipped.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  cat > "$TMP/draft.md" <<'MD'
# Handoff

## Finish first

- [x] model: merge the fix (thread: fix-auth)
- [x] model: correct the README (dropped: a ticket covers it) (thread: readme)
- [x] model: run the probes (postponed until: the probe ticket closes) (thread: probes)
- [x] principal: detach the second repository

## Open state
MD
}

teardown() { rm -rf "$TMP"; }

@test "without a ledger, run 1's ledger step prints one line that it skipped" {
  export HANDOFF_LEDGER="$TMP/no-ledger.mjs"
  run "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == *"skips its ledger step"* ]]
}

@test "without a ledger, run 2's ledger step prints one line that it skipped" {
  export HANDOFF_LEDGER="$TMP/no-ledger.mjs"
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == *"skips its ledger step"* ]]
}

# fake_ledger: a ledger that renders a fixed view and logs each append
# as one line of arguments in $TMP/appends.
fake_ledger() {
  cat > "$TMP/ledger.mjs" <<'JS'
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "render") {
  fs.writeFileSync(args[args.indexOf("--out") + 1], "# Threads\n\n- fix-auth: open\n");
} else if (args[0] === "append") {
  fs.appendFileSync(process.env.APPENDS, JSON.stringify(args.slice(1)) + "\n");
}
JS
  export HANDOFF_LEDGER="$TMP/ledger.mjs"
  export APPENDS="$TMP/appends"
}

@test "with a ledger, run 1's ledger step prints the view" {
  fake_ledger
  run "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [[ "$output" == *"- fix-auth: open"* ]]
}

@test "with a ledger, run 2 writes one event for each item that carries a thread slug" {
  fake_ledger
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$APPENDS")" -eq 3 ]
  grep -qx '\["--ev","completed","--thread","fix-auth"\]' "$APPENDS"
  grep -qx '\["--ev","dropped","--thread","readme","--note","a ticket covers it"\]' "$APPENDS"
  grep -qx '\["--ev","parked","--thread","probes","--trigger","the probe ticket closes"\]' "$APPENDS"
}

@test "a ledger that refuses an event fails the step with its error" {
  fake_ledger
  cat > "$TMP/ledger.mjs" <<'JS'
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "render") fs.writeFileSync(args[args.indexOf("--out") + 1], "# Threads\n");
else { console.error("illegal transition for \"readme\""); process.exit(1); }
JS
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"illegal transition"* ]]
}

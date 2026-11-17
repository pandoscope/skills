#!/usr/bin/env bats
# The ledger steps (skills#267): run 1 reads the thread ledger's view,
# run 2 writes one event per finish-first item that carries a thread
# slug. Without a ledger, each step says in one line that it skipped.

bats_require_minimum_version 1.5.0

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
  run --separate-stderr "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [ "$output" = "handing-off: no thread ledger available; this run skips its ledger step" ]
  [[ "$stderr" == *"no ledger at $TMP/no-ledger.mjs"* ]]
}

@test "without a ledger, run 2's ledger step prints one line that it skipped" {
  export HANDOFF_LEDGER="$TMP/no-ledger.mjs"
  run --separate-stderr "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$output" = "handing-off: no thread ledger available; this run skips its ledger step" ]
  [[ "$stderr" == *"no ledger at $TMP/no-ledger.mjs"* ]]
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
  export LEDGER_SESSION_URL="https://claude.ai/code/session_01Test"
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

# --- against the real ledger (review of #274) ---------------------------
# real_ledger: a session-memory store the thread ledger of this repo
# writes to, with the draft's three threads opened.
real_ledger() {
  unset HANDOFF_LEDGER
  export HOME="$TMP/home"
  mkdir -p "$HOME/.claude"
  git init -q --bare -b main "$TMP/session-memory.git"
  git clone -q "$TMP/session-memory.git" "$TMP/sm" 2> /dev/null
  git -C "$TMP/sm" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  git -C "$TMP/sm" push -q origin main
  export SESSION_MEMORY_URL="$TMP/session-memory.git" SESSION_MEMORY_ROOT="$TMP/sm"
  export LEDGER_SESSION_URL="https://claude.ai/code/session_01Test"
  LEDGER="$REPO_ROOT/original/thread-ledger/ledger.mjs"
  for thread in fix-auth readme probes; do
    node "$LEDGER" append --ev opened --thread "$thread" --title "$thread" --ticket o/r#1 > /dev/null 2>&1
  done
}

thread_state() { node "$LEDGER" state 2> /dev/null | jq -r --arg t "$1" '.[] | select(.thread == $t) | .state'; }

@test "run 2 writes its events to the real ledger" {
  real_ledger
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(thread_state fix-auth)" = completed ]
  [ "$(thread_state readme)" = dropped ]
  [ "$(thread_state probes)" = parked ]
}

@test "a second pass of run 2 writes no event twice" {
  real_ledger
  "$SKILL/ledger.sh" events "$TMP/draft.md" > /dev/null
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ledger: 0 events written"* ]]
  [ "$(thread_state fix-auth)" = completed ]
}

@test "without a session identity, run 2 skips its ledger step in one line" {
  real_ledger
  unset LEDGER_SESSION_URL
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == *"skips its ledger step"* ]]
  [ "$(thread_state fix-auth)" = opened ]
}

@test "a dropped item without a reason writes no event and is named" {
  real_ledger
  sed -i 's/(dropped: a ticket covers it)/(dropped)/' "$TMP/draft.md"
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"dropped without a reason: model: correct the README (dropped) (thread: readme)"* ]]
  [ "$(thread_state readme)" = opened ]
}

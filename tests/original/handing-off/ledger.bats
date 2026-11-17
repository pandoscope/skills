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
} else if (args[0] === "state") {
  const anchor = (session) => ({ anchor: { session } });
  console.log(JSON.stringify([
    { thread: "fix-auth", state: "opened", events: [{ ev: "opened", title: "Fix auth", ticket: "o/r#1", ...anchor("session_01Test") }] },
    { thread: "other-work", state: "progress", events: [{ ev: "opened", title: "Other", ...anchor("session_01Other") }] },
    { thread: "done-thing", state: "completed", events: [{ ev: "opened", title: "Done", ...anchor("session_01Test") }] },
  ]));
} else if (args[0] === "append") {
  fs.appendFileSync(process.env.APPENDS, JSON.stringify(args.slice(1)) + "\n");
}
JS
  export HANDOFF_LEDGER="$TMP/ledger.mjs"
  export APPENDS="$TMP/appends"
  export LEDGER_SESSION_URL="https://claude.ai/code/session_01Test"
}

@test "run 1's ledger step prints only this session's open threads (item 8)" {
  fake_ledger
  run "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [ "$output" = "- fix-auth: opened — Fix auth (o/r#1)" ]
}

@test "run 1's ledger step takes the session's identity as an argument (item 8)" {
  fake_ledger
  unset LEDGER_SESSION_URL
  run "$SKILL/ledger.sh" view --session-url https://claude.ai/code/session_01Other
  [ "$status" -eq 0 ]
  [ "$output" = "- other-work: progress — Other" ]
}

@test "without a session identity, run 1's ledger step skips in one line (item 8)" {
  fake_ledger
  unset LEDGER_SESSION_URL
  run "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == *"skips its ledger step"* ]]
}

@test "with a ledger, run 2 writes an event for each dropped or postponed item with a thread slug" {
  fake_ledger
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$APPENDS")" -eq 2 ]
  grep -qx '\["--ev","dropped","--thread","readme","--note","a ticket covers it","--session-url","https://claude.ai/code/session_01Test"\]' "$APPENDS"
  grep -qx '\["--ev","parked","--thread","probes","--trigger","the probe ticket closes","--session-url","https://claude.ai/code/session_01Test"\]' "$APPENDS"
}

@test "run 2 appends no completion: a handoff does not end a thread" {
  fake_ledger
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  ! grep -q '"completed"' "$APPENDS" || false
  [[ "$output" == *"fix-auth stays open"* ]]
}

@test "run 2 passes the session's identity it was given to the ledger" {
  fake_ledger
  unset LEDGER_SESSION_URL
  run "$SKILL/ledger.sh" events --session-url https://claude.ai/code/session_01Given "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(grep -c '"--session-url","https://claude.ai/code/session_01Given"\]$' "$APPENDS")" -eq 2 ]
}

@test "a ledger that refuses an event fails the step with its error" {
  fake_ledger
  cat > "$TMP/ledger.mjs" <<'JS'
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "state") console.log("[]");
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

@test "run 2 writes its events to the real ledger and leaves a done item's thread open" {
  real_ledger
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(thread_state fix-auth)" = opened ]
  [ "$(thread_state readme)" = dropped ]
  [ "$(thread_state probes)" = parked ]
}

@test "with the identity passed and none in the environment, run 2 writes to the real ledger" {
  real_ledger
  unset LEDGER_SESSION_URL
  run "$SKILL/ledger.sh" events --session-url https://claude.ai/code/session_01Test "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(thread_state readme)" = dropped ]
  [ "$(thread_state probes)" = parked ]
}

@test "a second pass of run 2 writes no event twice" {
  real_ledger
  "$SKILL/ledger.sh" events "$TMP/draft.md" > /dev/null
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ledger: 0 events written"* ]]
  [ "$(thread_state readme)" = dropped ]
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

@test "run 1's view of the real ledger leaves out another session's threads (item 8)" {
  real_ledger
  node "$LEDGER" append --session-url https://claude.ai/code/session_01Other --ev opened \
    --thread elsewhere --title elsewhere --ticket o/r#2 > /dev/null 2>&1
  run "$SKILL/ledger.sh" view
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 3 ]
  [[ "$output" == *"- fix-auth: opened"* ]]
  [[ "$output" != *"elsewhere"* ]]
}

@test "a dropped item without a reason writes no event and is named" {
  real_ledger
  sed -i 's/(dropped: a ticket covers it)/(dropped)/' "$TMP/draft.md"
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"dropped without a reason: model: correct the README (dropped) (thread: readme)"* ]]
  [ "$(thread_state readme)" = opened ]
}

@test "run 2 writes parked for a postponed item in any letter case (item 5)" {
  fake_ledger
  sed -i 's/(postponed until:/(Postponed until:/' "$TMP/draft.md"
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  grep -q '"--ev","parked","--thread","probes","--trigger","the probe ticket closes"' "$APPENDS"
}

@test "an item on a thread parked in an earlier cycle gets its event (D8)" {
  real_ledger
  node "$LEDGER" append --ev parked --thread readme --trigger "an earlier cycle" > /dev/null 2>&1
  node "$LEDGER" append --ev blocked --thread probes --on external --what "a review" > /dev/null 2>&1
  [ "$(thread_state readme)" = parked ]
  [ "$(thread_state probes)" = blocked ]
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(thread_state readme)" = dropped ]
  [ "$(thread_state probes)" = parked ]
}

@test "run 2 reads the finish-first list by the rules of the list check (D3)" {
  fake_ledger
  cat > "$TMP/draft.md" <<'MD'
# Handoff

## Finish first

- [x] model: merge the fix (thread: fix-auth)

### From the ledger

- [x] model: run the probes (postponed until: the probe ticket closes) (thread: probes)

```markdown
- [x] model: an example (dropped: only an example) (thread: example)
```

## Open state
MD
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 0 ]
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  grep -q '"--ev","parked","--thread","probes"' "$APPENDS"
  ! grep -q '"example"' "$APPENDS" || false
}

@test "an item on a thread completed or dropped earlier gets its event (discovery of round two)" {
  real_ledger
  node "$LEDGER" append --ev completed --thread readme > /dev/null 2>&1
  node "$LEDGER" append --ev dropped --thread probes --note "an earlier cycle" > /dev/null 2>&1
  [ "$(thread_state readme)" = completed ]
  [ "$(thread_state probes)" = dropped ]
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  [ "$(thread_state readme)" = dropped ]
  [ "$(thread_state probes)" = parked ]
}

@test "a note with whitespace after its bracket gets its event, as the list check reads it (E3)" {
  fake_ledger
  sed -i 's/(postponed until:/( postponed until:/; s/(dropped:/( dropped:/' "$TMP/draft.md"
  run "$SKILL/list.sh" "$TMP/draft.md"
  [ "$status" -eq 0 ]
  run "$SKILL/ledger.sh" events "$TMP/draft.md"
  [ "$status" -eq 0 ]
  grep -q '"--ev","parked","--thread","probes","--trigger","the probe ticket closes"' "$APPENDS"
  grep -q '"--ev","dropped","--thread","readme","--note","a ticket covers it"' "$APPENDS"
}

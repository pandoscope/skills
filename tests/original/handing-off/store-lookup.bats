#!/usr/bin/env bats
# The store lookup without HANDOFF_STORE (skills#267): store.sh finds
# the session-memory clone the way the thread ledger finds it. Real
# clones of a bare remote stand in for the store; resolveRoot of the
# ledger, run on the same setup, is the authority the lookup mirrors.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  LEDGER_IO="$REPO_ROOT/original/thread-ledger/store/io.mjs"
  TMP=$(mktemp -d)
  unset HANDOFF_STORE SESSION_MEMORY_ROOT DECISION_MEMORY_URL EVIDENCE_MEMORY_URL PUSH_BLOCKLIST
  export HOME="$TMP/home"
  mkdir -p "$HOME/.claude"
  export HANDOFF_TRANSCRIPT="$TMP/s1.jsonl"
  echo '{"type":"user"}' > "$HANDOFF_TRANSCRIPT"
  export HANDOFF_STATE="$TMP/state/s1.json"
  mkdir -p "$TMP/state"
  printf '# Handoff\n\n## Finish first\n\n- [ ] model: x\n' > "$TMP/state/s1.draft.md"
  # The remote is named like the real store, so the harness clone's
  # directory name comes from the URL as it does in a session.
  git init -q --bare -b main "$TMP/remote/session-memory.git"
  export SESSION_MEMORY_URL="$TMP/remote/session-memory.git"
}

teardown() { rm -rf "$TMP"; }

# clone_at <dir>: a clone of the store remote with one commit on main.
clone_at() {
  git clone -q "$SESSION_MEMORY_URL" "$1" 2> /dev/null
  git -C "$1" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  git -C "$1" push -q origin main
}

# ledger_root: the clone the thread ledger's resolveRoot picks.
ledger_root() {
  node --input-type=module -e "
    import { resolveRoot } from '$LEDGER_IO';
    process.stdout.write(resolveRoot(undefined));"
}

# store_root: the clone store.sh picks.
store_root() {
  bash -c '. "$1/state.sh"; . "$1/store.sh"; handoff_store_root' _ "$SKILL"
}

@test "without HANDOFF_STORE, the push lands in the harness clone the session env names" {
  clone_at "$TMP/root/session-memory"
  echo "SESSION_ROOT=$TMP/root" > "$HOME/.claude/session.env"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  [[ "$output" != *"loses this run"* ]]
  git -C "$SESSION_MEMORY_URL" show main:handoffs/sessions/s1/state.json | grep -q '"phase":"listed"'
  [ "$(store_root)" = "$(ledger_root)" ]
}

@test "SESSION_MEMORY_ROOT outranks the harness clone, as it does for the ledger" {
  clone_at "$TMP/root/session-memory"
  echo "SESSION_ROOT=$TMP/root" > "$HOME/.claude/session.env"
  clone_at "$TMP/explicit"
  export SESSION_MEMORY_ROOT="$TMP/explicit"
  [ "$(store_root)" = "$TMP/explicit" ]
  [ "$(store_root)" = "$(ledger_root)" ]
}

@test "with SESSION_MEMORY_URL set and no clone anywhere, the run says the store is missing" {
  [ ! -d /workspace/session-memory/.git ] || skip "this machine has a clone at the ledger's default root"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  [[ "$output" == *"no session-memory clone was found"* ]]
  [[ "$output" == *"a resume into a new container loses this run"* ]]
}

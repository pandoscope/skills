# Shared setup of the tests that push to or restore from a store
# (skills#267): a bare remote with one commit, a clone of it named by
# HANDOFF_STORE, and session s1 with its state and draft under
# $TMP/state.

# store_isolate: no store of the person running the tests is reachable,
# neither through the store variables nor through a clone under HOME
# (review of #274, item 3). Needs TMP.
store_isolate() {
  unset SESSION_MEMORY_URL SESSION_MEMORY_ROOT DECISION_MEMORY_URL EVIDENCE_MEMORY_URL \
    PUSH_BLOCKLIST HANDOFF_STORE
  export HOME="$TMP/home"
  mkdir -p "$HOME"
}

store_setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  store_isolate
  export HANDOFF_TRANSCRIPT="$TMP/s1.jsonl"
  echo '{"type":"user"}' > "$HANDOFF_TRANSCRIPT"
  export HANDOFF_STATE="$TMP/state/s1.json"
  git init -q --bare -b main "$TMP/remote.git"
  git clone -q "$TMP/remote.git" "$TMP/store" 2> /dev/null
  git -C "$TMP/store" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  git -C "$TMP/store" push -q origin main
  export HANDOFF_STORE="$TMP/store"
  mkdir -p "$TMP/state"
  cat > "$TMP/state/s1.draft.md" <<'MD'
# Handoff

## Finish first

- [ ] model: write the tickets
MD
}

remote_file() { git -C "$TMP/remote.git" show "main:$1"; }

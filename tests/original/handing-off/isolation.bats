#!/usr/bin/env bats
# The suite pushes to no store it did not create (review of #274 on
# 2026-11-17, item 3): mark-and-check.bats and hooks.bats kept the real
# HOME and SESSION_MEMORY_URL, and session.bats the store variables, so
# check.sh pushed to the session-memory store of whoever ran the tests. Here the environment names a decoy
# store, and the three files must leave it untouched.

setup() {
  TMP=$(mktemp -d)
  export HOME="$TMP/home"
  mkdir -p "$HOME"
  git init -q --bare -b main "$TMP/decoy.git"
  git clone -q "$TMP/decoy.git" "$TMP/decoy" 2> /dev/null
  git -C "$TMP/decoy" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  git -C "$TMP/decoy" push -q origin main
  export SESSION_MEMORY_URL="$TMP/decoy.git" SESSION_MEMORY_ROOT="$TMP/decoy"
  unset HANDOFF_STORE
}

teardown() { rm -rf "$TMP"; }

@test "the hook, check and session tests push nothing to a store the environment names" {
  run bats "$BATS_TEST_DIRNAME/mark-and-check.bats" "$BATS_TEST_DIRNAME/hooks.bats" \
    "$BATS_TEST_DIRNAME/session.bats"
  [ "$status" -eq 0 ]
  [ "$(git -C "$TMP/decoy.git" rev-list --count main)" -eq 1 ]
}

#!/usr/bin/env bats
# phase.sh (skills#267): a run ends by recording its phase in the
# per-session state and pushing the draft and the state to the store.

load store_helper

setup() { store_setup; }

teardown() { rm -rf "$TMP"; }

@test "run 1 leaves a draft with a finish-first list, the phase listed, and no marker" {
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  . "$SKILL/state.sh"
  state=$(cat "$HANDOFF_STATE")
  [ "$(handoff_json_field phase "$state")" = listed ]
  [ "$(handoff_json_field draft_path "$state")" = "$TMP/state/s1.draft.md" ]
  [ -z "$(handoff_json_field handoff_path "$state")" ]
  remote_file handoffs/sessions/s1/draft.md | grep -q -- "- \[ \] model: write the tickets"
  pushed=$(remote_file handoffs/sessions/s1/state.json)
  [ "$(handoff_json_field phase "$pushed")" = listed ]
  [ "$(handoff_json_field draft_path "$pushed")" = handoffs/sessions/s1/draft.md ]
}

@test "with no store available, run 1 completes and prints the one-line warning" {
  export HANDOFF_STORE="$TMP/no-such-clone"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c 'a resume into a new container loses this run')" -eq 1 ]
  grep -q '"phase":"listed"' "$HANDOFF_STATE"
}

@test "a scan hit pushes nothing" {
  export PUSH_BLOCKLIST="Acme Corp"
  echo "- [x] model: tell Acme Corp" >> "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 1 ]
  [[ "$output" == *"PUSH_BLOCKLIST term 1"* ]]
  [[ "$output" == *"nothing was pushed"* ]]
  [[ "$output" != *"Acme"* ]]
  ! remote_file handoffs/sessions/s1/state.json || false
}

@test "the phase written waits for a settled list" {
  run "$SKILL/phase.sh" written
  [ "$status" -eq 1 ]
  [[ "$output" == *"unticked: model: write the tickets"* ]]
  ! grep -q '"phase":"written"' "$HANDOFF_STATE" || false
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" written
  [ "$status" -eq 0 ]
  [ "$(remote_file handoffs/sessions/s1/state.json | grep -c '"phase":"written"')" -eq 1 ]
}

@test "a push rejected for another writer's commit rebases and lands" {
  git clone -q "$TMP/remote.git" "$TMP/other" 2> /dev/null
  git -C "$TMP/other" -c user.name=t -c user.email=t@t commit -q --allow-empty -m other
  git -C "$TMP/other" push -q origin main
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  [[ "$output" != *"loses this run"* ]]
  remote_file handoffs/sessions/s1/state.json > /dev/null
  git -C "$TMP/remote.git" log --format=%s main | grep -q '^other$'
}

@test "phase.sh refuses a run without a draft" {
  rm "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 1 ]
  [[ "$output" == *"no handoff draft at $TMP/state/s1.draft.md"* ]]
}

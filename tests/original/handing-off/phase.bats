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

@test "recording listed drops the marker of an earlier cycle" {
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  grep -q '"handoff_path"' "$HANDOFF_STATE"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  for field in handoff_path written_at written_epoch context_tokens published_url transcript_path; do
    ! grep -q "\"$field\"" "$HANDOFF_STATE" || false
  done
  grep -q '"phase":"listed"' "$HANDOFF_STATE"
}

@test "a refused store commit leaves nothing staged in the store" {
  printf '#!/bin/sh\nexit 1\n' > "$TMP/store/.git/hooks/pre-commit"
  chmod +x "$TMP/store/.git/hooks/pre-commit"
  run "$SKILL/phase.sh" listed
  [[ "$output" == *"loses this run"* ]]
  git -C "$TMP/store" diff --cached --quiet
}

@test "a push the remote keeps refusing ends after three attempts with the warning" {
  printf '#!/bin/sh\nexit 1\n' > "$TMP/remote.git/hooks/pre-receive"
  chmod +x "$TMP/remote.git/hooks/pre-receive"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  [[ "$output" == *"failed after 3 attempts"* ]]
  [[ "$output" == *"loses this run"* ]]
}

@test "uncommitted work in the store clone stays out of the push" {
  echo scratch > "$TMP/store/scratch.txt"
  run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  ! git -C "$TMP/remote.git" show main:scratch.txt 2> /dev/null || false
  [ -e "$TMP/store/scratch.txt" ]
}

@test "a store clone that is behind fetches and rebases before it pushes (D5)" {
  git clone -q "$TMP/remote.git" "$TMP/other" 2> /dev/null
  git -C "$TMP/other" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "another writer"
  git -C "$TMP/other" push -q origin main
  # A git on PATH that logs each push, then runs the real one.
  mkdir -p "$TMP/bin"
  real=$(command -v git)
  printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = push ] && echo push >> "%s"; done\nexec "%s" "$@"\n' \
    "$TMP/pushes" "$real" > "$TMP/bin/git"
  chmod +x "$TMP/bin/git"
  PATH="$TMP/bin:$PATH" run "$SKILL/phase.sh" listed
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$TMP/pushes")" -eq 1 ]
  remote_file handoffs/sessions/s1/state.json | grep -q '"phase":"listed"'
}

@test "the phase written requires the open-state table in the draft (D13)" {
  printf '# Handoff\n\n## Finish first\n\n- [x] model: write the tickets\n' > "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" written
  [ "$status" -eq 1 ]
  [[ "$output" == *"no open-state table"* ]]
  ! grep -q '"phase":"written"' "$HANDOFF_STATE" 2> /dev/null || false
  printf '\n## Open state\n\n| Item | State | Next |\n| --- | --- | --- |\n| repo#1 fix | open | merge it |\n' \
    >> "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" written
  [ "$status" -eq 0 ]
  grep -q '"phase":"written"' "$HANDOFF_STATE"
}

@test "a table whose header lacks Item and Next is no open-state table, whatever its rows say (E2)" {
  printf '# Handoff\n\n## Finish first\n\n- [x] model: write the tickets\n\n## Open state\n\n| Ticket | State |\n| --- | --- |\n| the next item | open |\n' \
    > "$TMP/state/s1.draft.md"
  run "$SKILL/phase.sh" written
  [ "$status" -eq 1 ]
  [[ "$output" == *"no open-state table"* ]]
}

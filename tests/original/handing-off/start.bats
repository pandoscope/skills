#!/usr/bin/env bats
# start.sh (skills#267): the phase in the per-session state decides
# what an invocation starts. With no local state, the pushed state
# under the session id is restored first.

load store_helper

setup() { store_setup; }

teardown() { rm -rf "$TMP"; }

usage_line() {
  echo "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":$1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}" \
    >> "$HANDOFF_TRANSCRIPT"
}

@test "an invocation with neither local nor pushed state starts run 1" {
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
  [[ "$output" == *"draft: $TMP/state/s1.draft.md"* ]]
}

@test "an invocation in the phase listed starts run 2" {
  "$SKILL/phase.sh" listed > /dev/null
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 2"* ]]
  [[ "$output" != *"step 5"* ]]
}

@test "an invocation in the phase written starts run 2 at step 5" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/phase.sh" written > /dev/null
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 2 at step 5"* ]]
}

@test "an invocation in the phase complete proposes /compact again while the marker is fresh" {
  usage_line 100000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  . "$SKILL/state.sh"
  handoff_state_set "$HANDOFF_STATE" phase complete
  usage_line 120000
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: the /compact proposal again"* ]]
}

@test "an invocation in the phase complete starts run 1 when the marker is stale" {
  usage_line 100000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  . "$SKILL/state.sh"
  handoff_state_set "$HANDOFF_STATE" phase complete
  usage_line 200000
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
}

@test "an invocation in a state without a phase starts run 1" {
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
}

@test "an unknown phase is an error that names it" {
  echo '{"phase":"swept"}' > "$HANDOFF_STATE"
  run "$SKILL/start.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown phase swept"* ]]
}

@test "with the local state deleted, an invocation restores the phase and the draft from the store" {
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/phase.sh" written > /dev/null
  cp "$TMP/state/s1.draft.md" "$TMP/draft.expected"
  rm "$HANDOFF_STATE" "$TMP/state/s1.draft.md"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"restored the phase written and the draft"* ]]
  [[ "$output" == *"starts: run 2 at step 5"* ]]
  cmp "$TMP/draft.expected" "$TMP/state/s1.draft.md"
  . "$SKILL/state.sh"
  [ "$(handoff_json_field draft_path "$(cat "$HANDOFF_STATE")")" = "$TMP/state/s1.draft.md" ]
}

@test "a restored marker keeps its token count" {
  usage_line 100000
  "$SKILL/mark.sh" "$TMP/state/s1.draft.md" > /dev/null
  sed -i 's/- \[ \]/- [x]/' "$TMP/state/s1.draft.md"
  "$SKILL/phase.sh" written > /dev/null
  . "$SKILL/state.sh"
  handoff_state_set "$HANDOFF_STATE" phase complete
  . "$SKILL/store.sh"
  handoff_store_push s1 "$HANDOFF_STATE" "$TMP/state/s1.draft.md"
  rm "$HANDOFF_STATE"
  usage_line 120000
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: the /compact proposal again"* ]]
  grep -q '"context_tokens":100000' "$HANDOFF_STATE"
}

# --- review of #274 -----------------------------------------------------

@test "an unreachable store is no empty store: the invocation stops and says so" {
  git -C "$TMP/store" remote set-url origin "$TMP/gone.git"
  run "$SKILL/start.sh"
  [ "$status" -eq 3 ]
  [[ "$output" == *"the store did not answer"* ]]
  [[ "$output" != *"starts:"* ]]
}

@test "the phase complete without a marker starts run 1" {
  echo '{"phase":"complete"}' > "$HANDOFF_STATE"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
}

@test "run 1 sets an earlier cycle's draft aside" {
  echo '{"handoff_path":"/x.md","written_epoch":1}' > "$HANDOFF_STATE"
  run "$SKILL/start.sh"
  [[ "$output" == *"starts: run 1"* ]]
  [[ "$output" == *"set the earlier draft aside as $TMP/state/s1.draft.previous.md"* ]]
  [ ! -e "$TMP/state/s1.draft.md" ]
  grep -q "write the tickets" "$TMP/state/s1.draft.previous.md"
}

@test "start.sh makes the directory of the draft it names" {
  export HANDOFF_STATE="$TMP/fresh/dir/s1.json"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"draft: $TMP/fresh/dir/s1.draft.md"* ]]
  [ -d "$TMP/fresh/dir" ]
}

@test "run 1 names the previous handoff by its path and commit in the store (item 10)" {
  "$SKILL/phase.sh" listed > /dev/null
  sha=$(git -C "$TMP/remote.git" log -1 --format=%h main -- handoffs/sessions/s1/draft.md)
  # The compaction cleared the phase; a resume into a new container
  # loses the local draft and its set-aside copy alike.
  "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}' > /dev/null
  rm -f "$TMP/state/s1.draft.md" "$TMP/state/s1.draft.previous.md"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"starts: run 1"* ]]
  [[ "$output" == *"previous: handoffs/sessions/s1/draft.md at $sha"* ]]
}

@test "the first run 1 of a session names no previous handoff (item 10)" {
  run "$SKILL/start.sh"
  [[ "$output" == *"previous: none"* ]]
}

@test "restoring a state with no phase says so, with no blank where the phase goes (item 14)" {
  "$SKILL/phase.sh" listed > /dev/null
  "$SKILL/verify.sh" <<< '{"session_id":"s1","source":"compact"}' > /dev/null
  rm "$HANDOFF_STATE"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" != *"the phase  and"* ]]
  [[ "$output" == *"restored the state, with no phase, and the draft from the store"* ]]
  [[ "$output" == *"starts: run 1"* ]]
}

@test "a restored run without its draft starts over at run 1 and says why (item 15)" {
  "$SKILL/phase.sh" listed > /dev/null
  git -C "$TMP/store" rm -q handoffs/sessions/s1/draft.md
  git -C "$TMP/store" -c user.name=t -c user.email=t@t commit -q -m "drop the draft"
  git -C "$TMP/store" push -q origin main
  rm "$HANDOFF_STATE" "$TMP/state/s1.draft.md"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"the store holds the phase listed but no draft"* ]]
  [[ "$output" == *"starts: run 1"* ]]
  ! grep -q '"phase"' "$HANDOFF_STATE" || false
}

@test "a restored complete without its draft starts over at run 1 and says why (E6)" {
  "$SKILL/phase.sh" listed > /dev/null
  printf '{"phase":"complete","handoff_path":"handoffs/sessions/s1/draft.md","written_epoch":%s}\n' \
    "$(date +%s)" > "$TMP/store/handoffs/sessions/s1/state.json"
  git -C "$TMP/store" rm -q handoffs/sessions/s1/draft.md
  git -C "$TMP/store" -c user.name=t -c user.email=t@t commit -q -am "complete without its draft"
  git -C "$TMP/store" push -q origin main
  rm "$HANDOFF_STATE" "$TMP/state/s1.draft.md"
  run "$SKILL/start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"the store holds the phase complete but no draft"* ]]
  [[ "$output" == *"starts: run 1"* ]]
  ! grep -q '"handoff_path"' "$HANDOFF_STATE" || false
}

#!/usr/bin/env bats
# Which session's transcript and marker the scripts pick, on a machine
# where many sessions and their subagents write transcripts
# (skills#245, skills#255). HOME is a scratch directory, so the
# session variables of whatever session runs this suite stay out.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME" && git rev-parse --show-toplevel)"
  SKILL="$REPO_ROOT/original/handing-off"
  TMP=$(mktemp -d)
  export HOME="$TMP/home"
  unset HANDOFF_STATE HANDOFF_TRANSCRIPT CLAUDE_PID CLAUDE_CODE_SESSION_ID
  PROJECTS="$HOME/.claude/projects/-work-repo"
  mkdir -p "$PROJECTS"
  echo "a handoff" > "$TMP/handoff.md"
}

teardown() { rm -rf "$TMP"; }

# transcript <path> <context-tokens>: one assistant turn of that size.
transcript() {
  mkdir -p "$(dirname "$1")"
  printf '{"type":"assistant","message":{"usage":{"input_tokens":%s,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}\n' \
    "$2" > "$1"
}

@test "mark finds the newest transcript among thousands without dying of SIGPIPE" {
  for i in $(seq 3000); do : > "$PROJECTS/older-session-$i.jsonl"; done
  touch -d '1 hour ago' "$PROJECTS"/*.jsonl
  transcript "$PROJECTS/live.jsonl" 1234
  run env HANDOFF_STATE="$TMP/state.json" "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q "\"transcript_path\":\"$PROJECTS/live.jsonl\"" "$TMP/state.json"
  grep -q '"context_tokens":1234' "$TMP/state.json"
}

@test "mark skips a subagent's transcript that was written last" {
  transcript "$PROJECTS/main.jsonl" 100
  touch -d '1 minute ago' "$PROJECTS/main.jsonl"
  transcript "$PROJECTS/main/subagents/agent-a1.jsonl" 5
  run env HANDOFF_STATE="$TMP/state.json" "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q "\"transcript_path\":\"$PROJECTS/main.jsonl\"" "$TMP/state.json"
  grep -q '"context_tokens":100' "$TMP/state.json"
}

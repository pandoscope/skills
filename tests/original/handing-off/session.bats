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

@test "each session's mark writes its own marker, named by the session" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  transcript "$PROJECTS/session-b.jsonl" 1000
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-b.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  grep -q '"context_tokens":200000' "$HOME/.claude/handoff-state/session-a.json"
  grep -q '"context_tokens":1000' "$HOME/.claude/handoff-state/session-b.json"
}

# hook_input <session-id>: the hook input Claude Code sends, naming the
# session and its transcript.
hook_input() {
  printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"PreCompact"}\n' \
    "$1" "$PROJECTS/$1.jsonl"
}

@test "guard judges a session by its own marker, not the last one written" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  transcript "$PROJECTS/session-b.jsonl" 1000
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-b.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  run "$SKILL/guard.sh" < <(hook_input session-a)
  [ "$status" -eq 0 ]
}

@test "guard takes the session from transcript_path when the input has no session_id" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  transcript "$PROJECTS/session-b.jsonl" 1000
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-b.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  run "$SKILL/guard.sh" <<< "{\"transcript_path\":\"$PROJECTS/session-a.jsonl\"}"
  [ "$status" -eq 0 ]
}

@test "verify injects the compacted session's handoff, not the last one marked" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  transcript "$PROJECTS/session-b.jsonl" 1000
  echo "handoff of a" > "$TMP/a.md"
  echo "handoff of b" > "$TMP/b.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/a.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-b.jsonl" "$SKILL/mark.sh" "$TMP/b.md"
  run "$SKILL/verify.sh" < <(hook_input session-a)
  [ "$status" -eq 0 ]
  [[ "$output" == *"The latest handoff is $TMP/a.md"* ]]
}

# pid_file <pid> <session-id>: Claude Code's record of a running session.
pid_file() {
  mkdir -p "$HOME/.claude/sessions"
  printf '{"pid":%s,"sessionId":"%s","cwd":"/work/repo","kind":"interactive"}\n' \
    "$1" "$2" > "$HOME/.claude/sessions/$1.json"
}

@test "mark takes its session from the pid file, not the newest transcript" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  touch -d '1 minute ago' "$PROJECTS/session-a.jsonl"
  transcript "$PROJECTS/session-b.jsonl" 1000
  pid_file 4242 session-a
  run env CLAUDE_PID=4242 "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":200000' "$HOME/.claude/handoff-state/session-a.json"
  [ ! -e "$HOME/.claude/handoff-state/session-b.json" ]
}

@test "mark takes its session from CLAUDE_CODE_SESSION_ID when no pid file names one" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  touch -d '1 minute ago' "$PROJECTS/session-a.jsonl"
  transcript "$PROJECTS/session-b.jsonl" 1000
  run env CLAUDE_CODE_SESSION_ID=session-a "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":200000' "$HOME/.claude/handoff-state/session-a.json"
  [ ! -e "$HOME/.claude/handoff-state/session-b.json" ]
}

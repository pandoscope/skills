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

@test "mark takes its session from CLAUDE_CODE_SESSION_ID, not the newest transcript" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  touch -d '1 minute ago' "$PROJECTS/session-a.jsonl"
  transcript "$PROJECTS/session-b.jsonl" 1000
  run env CLAUDE_CODE_SESSION_ID=session-a "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  grep -q '"context_tokens":200000' "$HOME/.claude/handoff-state/session-a.json"
  [ ! -e "$HOME/.claude/handoff-state/session-b.json" ]
}

@test "CLAUDE_CODE_SESSION_ID outranks the pid file, with a warning when they disagree" {
  transcript "$PROJECTS/session-a.jsonl" 200000
  transcript "$PROJECTS/session-b.jsonl" 1000
  pid_file 4242 session-a
  run env CLAUDE_PID=4242 CLAUDE_CODE_SESSION_ID=session-b "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  [ -e "$HOME/.claude/handoff-state/session-b.json" ]
  [ ! -e "$HOME/.claude/handoff-state/session-a.json" ]
  [[ "$output" == *"CLAUDE_CODE_SESSION_ID=session-b"*"session-a"* ]]
}

@test "mark warns when it can only guess the newest transcript" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  run "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  [ -e "$HOME/.claude/handoff-state/session-a.json" ]
  [[ "$output" == *"newest transcript"*"$PROJECTS/session-a.jsonl"*"HANDOFF_TRANSCRIPT"* ]]
}

@test "check verifies its own session's marker" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  transcript "$PROJECTS/session-b.jsonl" 1000
  echo "handoff of b" > "$TMP/b.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  HANDOFF_TRANSCRIPT="$PROJECTS/session-b.jsonl" "$SKILL/mark.sh" "$TMP/b.md"
  rm "$TMP/b.md"
  run env HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"machine checks pass"* ]]
}

# legacy_marker <session-id>: the one shared marker mark.sh wrote
# before markers were per session.
legacy_marker() {
  printf '{"written_at":"%s","handoff_path":"%s","published_url":"","transcript_path":"%s","context_tokens":1000}\n' \
    "$(date -u +%FT%TZ)" "$TMP/handoff.md" "$PROJECTS/$1.jsonl" > "$HOME/.claude/handoff-state.json"
}

@test "an old shared marker still serves the session that wrote it" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  legacy_marker session-a
  run "$SKILL/guard.sh" < <(hook_input session-a)
  [ "$status" -eq 0 ]
  run env HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/check.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"machine checks pass"* ]]
}

@test "an old shared marker of another session serves no one else" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  transcript "$PROJECTS/session-b.jsonl" 1000
  legacy_marker session-b
  run "$SKILL/guard.sh" < <(hook_input session-a)
  [ "$status" -eq 2 ]
  [[ "$output" == *"no handoff marker"* ]]
  run "$SKILL/verify.sh" < <(hook_input session-a)
  [[ "$output" == *"no handoff marker"* ]]
}

# --- edges of the lookup -------------------------------------------

@test "mark fails when no session can be found" {
  run "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no session to mark"* ]]
}

@test "guard blocks a hook input that names no session" {
  run "$SKILL/guard.sh" <<< '{"hook_event_name":"PreCompact"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"the hook input names no session"* ]]
}

@test "verify reports an unguarded compaction for a hook input that names no session" {
  run "$SKILL/verify.sh" <<< '{"hook_event_name":"SessionStart"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"no handoff marker"* ]]
}

@test "check fails when no session can be found" {
  run "$SKILL/check.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no session found"* ]]
}

@test "HANDOFF_TRANSCRIPT outranks the pid file" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  transcript "$PROJECTS/session-b.jsonl" 1000
  pid_file 4242 session-b
  run env CLAUDE_PID=4242 HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  [ -e "$HOME/.claude/handoff-state/session-a.json" ]
  [ ! -e "$HOME/.claude/handoff-state/session-b.json" ]
}

@test "a pid file without a sessionId falls through to the newest transcript" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  mkdir -p "$HOME/.claude/sessions"
  echo '{"pid":4242}' > "$HOME/.claude/sessions/4242.json"
  run env CLAUDE_PID=4242 "$SKILL/mark.sh" "$TMP/handoff.md"
  [ "$status" -eq 0 ]
  [ -e "$HOME/.claude/handoff-state/session-a.json" ]
  [[ "$output" == *"newest transcript"* ]]
}

@test "a session's own marker outranks an old shared marker naming it" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  echo "the new handoff" > "$TMP/new.md"
  legacy_marker session-a
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/new.md"
  run "$SKILL/verify.sh" < <(hook_input session-a)
  [[ "$output" == *"The latest handoff is $TMP/new.md"* ]]
}

@test "HANDOFF_STATE outranks an old shared marker" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  legacy_marker session-a
  run env HANDOFF_STATE="$TMP/explicit.json" "$SKILL/guard.sh" < <(hook_input session-a)
  [ "$status" -eq 2 ]
  [[ "$output" == *"$TMP/explicit.json"* ]]
}

@test "marking retires the old shared marker of the same session" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  legacy_marker session-a
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  rm "$HOME/.claude/handoff-state/session-a.json"
  run "$SKILL/guard.sh" < <(hook_input session-a)
  [ "$status" -eq 2 ]
  [[ "$output" == *"no handoff marker"* ]]
}

@test "marking leaves another session's old shared marker in place" {
  transcript "$PROJECTS/session-a.jsonl" 1000
  transcript "$PROJECTS/session-b.jsonl" 1000
  legacy_marker session-b
  HANDOFF_TRANSCRIPT="$PROJECTS/session-a.jsonl" "$SKILL/mark.sh" "$TMP/handoff.md"
  [ -e "$HOME/.claude/handoff-state.json" ]
}

# A whole session runs with no identity, and two checks contradict

**Incident:** orchestrator session, 2026-08-15
(session_014CUXJh1hKmW4ccUwRQ1Ep1), ticket
[skills#142](https://github.com/pandoscope/skills/issues/142).
SessionStart said "LEDGER IDENTITY UNSET" once, on turn 1. Nothing
enforced it afterwards. The session worked all day identity-less: the
store held 13 conversations and no check could tell this session's
events from another's.

The contradiction is the kata's point. With `SESSION_URL` absent, the
append guard (correctly) refuses every write — while the Stop hook
blocks the turn *demanding* the very events the guard refuses. Both
checks are right in isolation; together they hand the agent a turn
that cannot end cleanly and never name the one action that would fix
it. Meanwhile the identity was derivable the whole time — the harness
hands every session its own conversation URL — so the block was pure
friction over information already present and unread.

## What the fixture freezes

A store with prior conversations, a `session.env` carrying no
`SESSION_URL` and no `SESSION_TITLE`, a turn summary declaring a
touched thread, and a harness-supplied URL available to derive.

## Expected

The identity check fires FIRST, on the first turn, and fails alone:
event-shaped checks report blocked-on-identity, never their own
failures. The verdict names exactly what to write and where — and when
the harness-supplied URL is present, the check derives it, confirms,
and passes without a human in the loop. Identity present → this kata
is silent.

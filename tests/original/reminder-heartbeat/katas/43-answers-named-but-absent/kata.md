# The answers file that is named before it exists

**Measured:** 2026-09-03, six Routine-fired sessions. The compose hook
exports `REINSET_ANSWERS` into the session environment before the
composer has run, and a session's first Stop can land before the file
does. Named-and-absent is the ordinary state, not a misconfiguration —
unlike `SESSION_MEMORY_ROOT`, whose set-and-missing is a crash.

## What the fixture freezes

A clean turn with `REINSET_ANSWERS` naming a path nothing wrote.

## Expected

Every check behaves as it does without the variable: the passed-tickets
check reports `unconfigured`, nothing is exempted, the turn seals.

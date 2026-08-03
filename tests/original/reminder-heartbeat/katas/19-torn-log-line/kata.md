# A half-written line in the log traps the session

Found by review (Fable, 2026-08-03) and measured. A store log with one
truncated line — an interrupted append, ordinary when several sessions
share a store — makes `readAll` throw. The throw happens inside
`context()`, before `run()` has looked at anything, so:

- the crash handler exits 2, correctly refusing to end a turn it could
  not check;
- **it exits 2 on the guarded fire too**, because `stop_hook_active` is
  read inside `run()`, which never got to execute;
- and **nothing reaches the compliance log**, because that write also
  lives past the throw.

Every Stop blocks. The loop guard, the one thing standing between a
reminder and a trap, is bypassed by the very path that most needs it —
and the trap is invisible to the log built to observe this mechanism.

The code comment asserting "the loop guard releases the next Stop
either way" was simply false, and this kata is why comments about
control flow do not substitute for a test of it.

## Expected

The unguarded fire blocks — a heartbeat that cannot check must not pass
the turn. The guarded fire releases it, and both leave a record saying
what happened.

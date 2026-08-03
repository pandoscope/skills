# The recorder is already open, so the command must not re-open it

`record.py open` mints a session branch off the default branch every
time it runs. Offering it unconditionally would, in the common case of
a session that already opened one, abandon the branch holding the
records committed so far — a reminder whose own command loses work.

The state file the recorder writes into its checkout is observable, so
the offer is derived from it rather than guessed. Same discipline as
check 3, which reads the transition table to pick a verb the recorder
will actually accept.

## What the fixture freezes

Kata 24's state plus `.recorder-session.json` in the store checkout.

## Expected

Check 4 fires with the same reason, minus the `open`.

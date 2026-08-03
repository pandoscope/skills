# No decision store is configured, and the log says so

A deployment without a decision store is legitimate — most repos have
none. What is not legitimate is filing that absence as a pass: the
compliance log exists to answer whether reminders change behaviour, and
a column where "checked and clean" and "never looked" share a value
cannot answer it.

Same rule as check 2 with no repo root, for the same reason.

## What the fixture freezes

A marked commit, with `DECISION_MEMORY_ROOT` left unset.

## Expected

The turn seals — an unconfigured check must not block — and the
compliance record carries `unconfigured` for check 4, never `pass`.

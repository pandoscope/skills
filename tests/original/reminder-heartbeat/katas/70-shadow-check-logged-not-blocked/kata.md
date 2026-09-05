# A shadow check is logged, never blocked on

**Rule (skills#192):** a check marked `shadow` in the check table runs
every turn and records its verdict, and a failure lands in the
compliance log as `shadow` rather than `fail`: the turn is not blocked,
the seal is granted, and the digest never counts it as fired. That is
the measurement arm for a new check — the driver lab refused correct
work three times before its checks were widened, so a check earns the
right to refuse by first showing, on real turns, what it would have
refused.

## What the fixture freezes

A green turn whose clone committed during the turn on `claude/kata`, a
branch outside the ticket pattern the clone's own
`.github/reference-keywords.json` carries. The commits are
conventional and no tracker body was posted.

## Expected

Exit 0, sealed, and a compliance record whose `branch-pattern` verdict
is `shadow` while the other two workflow checks pass. The seal's digest
counts nothing fired.

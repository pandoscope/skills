# The marker inside a kata fixture is test data

**Incident:** this session, 2026-08-05, blocking the turn that
merged #85 — the check's second false positive in two days (#86). The
line it found was a shell string literal in `katas/_lib.sh`, whose entire
purpose is to write a `DECISION` marker into a throwaway repo so that
check 4 can find it *there*. No decision was made about the fixture
file; the only record that would have cleared the block describes
reasoning nobody had.

The cost compounds: adding kata coverage for check 4 — the very thing
its earlier defects ask for — is exactly what trips it. A check that
blocks the turn extending its own test suite trains its reader to
dismiss it.

## The boundary

Everything under `tests/**/katas/**` is data staged for a test,
including the shell that stages it. The harness that runs the katas
sits outside that path, so a genuine decision about how katas run is
still markable and still owed a record — and a marker anywhere else in
`tests/` remains real, because test code makes real decisions.

## What the fixture freezes

A clone whose only commit this turn adds marker text inside a kata
fixture path, a decision-memory clone that gained no record, and a
store already carrying the turn's thread event.

## Expected

The turn seals. The marker is not this turn's debt — not anybody's —
so check 4 has nothing to chase and no record is demanded.

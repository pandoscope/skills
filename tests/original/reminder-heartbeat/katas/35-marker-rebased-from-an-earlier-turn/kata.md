# A marker landed by rebase, written in an earlier turn

**Incident:** orchestrator session, 2026-08-04. The turn that merged a
reviewed stack of four PRs was blocked on check 4:

```
Marked and unrecorded: 12 markers, first at
skills/original/thread-ledger/heartbeat.mjs (SCOPE).
```

All twelve markers were written on branches in earlier turns and seven
already had records. Every one of them read as *added this turn*.

## What the fixture freezes

One marker commit, **authored 20:50** — ten minutes before the turn
began at 21:00 — and **committed 21:04**, inside it. That is exactly
what a rebase leaves behind: the rewrite mints a fresh committer date
and preserves the author date.

`git log --since` filters the COMMITTER date, so the check saw this as
this turn's debt. The block then scaled with the size of the merge —
worst precisely when a session lands a large reviewed stack, which is
the moment it is least true that the markers are new.

Clearing it by writing records would have fabricated reconstructed
reasoning for decisions made in other turns and inflated the corpus the
diligence measure reads, so the block was left standing and the cause
diagnosed instead.

## Expected

Exit 0, one seal. Author date names the turn in which the reasoning was
available to write down, which is the check's entire premise.

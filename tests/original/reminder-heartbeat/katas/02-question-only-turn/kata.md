# Question-only turn

**Incident:** orchestrator session, 2026-07-28. The session's opening
turn — "Do you have access to the Pando kanban board?" — answered in
prose, with no repo touched and no thread moved.

This is the kata a reminder system dies without. A check that nags on a
turn which changed nothing trains its reader to dismiss it, and a
dismissed reminder is worse than no reminder: it costs attention on
every turn and buys compliance on none. The seal protocol has no
carve-out for idle turns, so the turn still ends sealed — a bare seal,
the mark alone with no thread events beside it.

## What the fixture freezes

A turn that declares no threads, over a store whose log is already
sealed at the previous turn, with a clone that is clean and pushed.

## Expected

Silence. Exit 0, no reason on stderr, one seal appended, and every
check's verdict in the compliance log so the quiet pass is recorded
rather than merely inferred.

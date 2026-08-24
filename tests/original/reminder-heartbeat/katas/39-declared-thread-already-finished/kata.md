# The declared thread was already finished

**Incident:** the other half of the #89 firing. When a declared thread
stands `completed` and nothing has touched it since the turn began, the
old block offered the only legal append — `reopened` — as its remedy. A
`reopened` that no resumed work caused is a false event written to
clear a check: the exact lie the ledger exists to prevent, proposed by
the mechanism guarding against it.

## The rule this pins

A block reason states a completion criterion and the exact command —
and the command must also be TRUE. From a terminal state there is no
honest append for a turn that changed nothing, so the remedy is the
declaration: the summary names a thread this turn did not actually
change, and that is what gets fixed.

## What the fixture freezes

A turn that declares one thread, whose `completed` predates the turn
boundary, with no event from anyone since.

## Expected

The block stands — the declaration is genuinely wrong — but the reason
tells the truth: fix the summary, and never append `reopened` to
satisfy a check.

> **Format v2 (skills#153):** threads are observed from the ledger, not
> declared, so the declared-thread scenario this kata was born from can
> no longer occur. The fixture stands as regression over the v2
> behavior its expected.json now asserts — the turn resolves on
> observation (and on the ticket declaration, where one is staged).

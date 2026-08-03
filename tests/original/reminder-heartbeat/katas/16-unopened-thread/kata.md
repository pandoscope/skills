# A declared thread the ledger has never heard of

Found by probing (2026-08-03). The turn declared a thread that was
never opened. Check 3 fired correctly — there is no event for it — and
handed over this command:

```text
ledger append --ev progress --thread ghost-thread --pct <n> --note "…"
```

which cannot work. Running it returns

```text
illegal transition for "ghost-thread": no prior event -> progress.
Legal from here: opened, reopened
```

A reason is a completion criterion plus **the exact command**. A
command that fails is worse than no command: the model runs it, gets an
error, and is left to improvise inside the one turn the hook allows it
— which is how an instruction-shaped reason starts a loop, arrived at
from the other direction.

## What the fixture freezes

A current summary declaring one thread that exists and one that never
did, with everything else in order.

## Expected

Check 3 fires for the unopened thread and offers `--ev opened`, which
is the transition the state machine actually permits from nothing.

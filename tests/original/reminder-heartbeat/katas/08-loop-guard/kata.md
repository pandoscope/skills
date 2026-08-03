# The hook has already blocked this turn

**Measured, 2026-08-03**, in the fire-test that proved the mechanism:
the first Stop of the session blocked at 14:26:53Z, and the next Stop
arrived at 14:26:59Z with `stop_hook_active` true and released the
turn. One block per turn is the contract, not an accident of timing.

Blocking again is how a Stop hook traps a session: the model acts on
the reason, the hook re-fires, the same reason comes back. The
community failure is documented and the guard against it is the first
thing the hook reads.

So the turn is allowed to end — and it ends **unsealed**, which is the
honest record. The bookkeeping was not finished; a seal would say it
was.

The guarded pass is also the only place compliance can be observed: it
runs every check again and records whether the model acted on the
reason it was just given. That record is what makes it possible to ask
whether reminders change behaviour at all, before any further check is
promoted to blocking.

## What the fixture freezes

The founding drift state, re-entered with `stop_hook_active` true and
the ledger still untouched — the model did not comply.

## Expected

Exit 0, nothing on stderr, no seal, and a compliance record naming
check 3 as what fired with the turn marked guarded.

# The window is the stretch, not the session

**Incident:** orchestrator session, 2026-08-04 — the session skills#69
was designed in. By its second green turn the compliance log held the
first turn's records too, and a digest computed over the whole log
would have re-billed turn one's tokens to every later seal, growing
without bound and drowning the number the principal actually reads:
what THIS stretch cost.

The store also already held 83 seals from before the field existed.
They stay valid, and they stay as they are — the digest is optional on
read, mandatory only on write.

## What the fixture freezes

A compliance log holding the previous turn's sealed record, a store
whose ledger carries that turn's digest-less seal, and a clean second
turn. The transcript's counters are cumulative across both turns.

## Expected

Exit 0, one seal whose digest covers ONE turn — and whose token cost is
the counter difference since the previous seal, not the transcript
total.

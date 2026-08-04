# The render workflow that failed 21 times out of 21

**Incident:** 2026-08-02. The store's workflow that renders `LEDGER.md`
had failed on every run since it was created — 21 of 21 — because it
sparse-checked-out the skill from a branch where the skill had never
existed. Nobody noticed for the whole of that time, because the agent
hand-rendered `LEDGER.md` at the end of every turn. The artifact was
always current, so the mechanism that was supposed to keep it current
could be entirely dead without producing a single visible symptom.

Absence and success looked identical, and this time the disguise was
manufactured by the very agent the automation was meant to relieve.

**Second incident, 2026-08-04.** The published artifact went 15 events
stale across every turn after a compaction, in the very session
building this hook — while all four mechanized checks held at 100%
eventual compliance. The republish was the one step living on priming
alone, and it drifted to zero the moment the habit fell out of
context. Two incidents, one shape: the unenforced step is the one that
dies, and it dies silently because the page still renders — it just
renders yesterday.

## What the fixture freezes

A turn whose built checks are all green, over a store whose newest
non-seal event postdates the rendered page named by
`LEDGER_RENDER_PATH`.

## What was undecided, now decided

The freshness stamp is the rendered file's own mtime against the
newest **non-seal** event. Publishing leaves no file evidence — the
Artifact call is a harness tool — so the verifiable half is the
render, and the block lands at the moment the republish is one step
away. Seals are excluded from the comparison because the hook writes
one after every green turn, after the render: counting them would put
every turn one render behind its own seal, forever.

## Expected

Check 5 fires with the render command, `--session-url` included so the
command works against a store holding several conversations.

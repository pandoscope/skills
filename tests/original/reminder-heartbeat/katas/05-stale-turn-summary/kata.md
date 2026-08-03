# Turn summary left over from the previous turn

The four-turns-of-drift class, aimed at the declaration itself.

That incident's whole damage came from a stale thing that presented as
a fresh one: the ledger page republished every turn with frozen content
while its relative times recomputed in the browser, so "6 back" became
"7 back" and staleness and freshness were indistinguishable. A summary
file left in place from an earlier turn does the same to check 1 —
present, well-formed, and describing a different turn — and every check
downstream would then diff against the wrong declaration.

Existence is therefore not the test. The file has to have been written
after the turn began, and the turn's beginning is the stamp of the
message the principal last typed.

## What the fixture freezes

A summary written at 11:04, naming the previous turn's thread, over a
turn that began at 11:30.

## Expected

Check 1 fires, exactly as it does for a missing file: the turn has not
described itself either way.

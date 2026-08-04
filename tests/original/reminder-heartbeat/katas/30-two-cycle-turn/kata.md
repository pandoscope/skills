# A turn that took two cycles, and what the second one cost

The friction case. The turn's first `Stop` blocked on check 3; the
model appended the missing event and finished again, and this is that
second `Stop`. Everything the reminder cost — the round-trip and the
tokens spent inside it — exists only in the difference between the two
compliance records.

## Why the record has to carry this, and not the report

The model name and the token counts live in the transcript, which is
local to one machine, discarded with the container, and rewritten by
compaction. A turn that ends without stamping them is a turn whose cost
can never be reconstructed, however good the analysis is later. The
report, by contrast, is a pure function over the accumulated log and
can be written at any time.

So the hook stamps, and stamps dumbly: **cumulative** counters rather
than per-cycle deltas. A monotone counter survives a missed `Stop`,
where a delta computed at write time would silently attribute one
cycle's work to another turn — and a change of mind about the metric
does not invalidate a corpus of raw counters.

## Cycle 1 is the counterfactual

This is the whole reason `cycle` is worth recording. At cycle 1 the
model has not been reminded this turn, so cycle-1 verdicts are what
this model does unprompted — the no-reminder baseline, free, with no
second arm to run. Every later cycle is the cost of correcting it.

## What the fixture freezes

A compliance log already holding this turn's first, blocking record; a
transcript carrying per-message `usage` and the model name; and a state
where the missing event has since been appended, so the second cycle
seals.

## Expected

Exit 0, one seal, and a second compliance record stamped `cycle: 2`
with the transcript's cumulative usage — the sum across all three
assistant messages, not the last one's.
